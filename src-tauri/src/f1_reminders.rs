//! Native F1 session reminders (opt-in, runs while the application runs,
//! including from the tray).
//!
//! Design points:
//! - One async loop: 5s startup delay, 60s cadence, transient errors back off
//!   exponentially up to 15 minutes, disabled config pauses for 2 seconds.
//! - Schedule comes from the shared Jolpica cache via `fetch_with_cache`;
//!   stale replies never drive notifications.
//! - The opt-in flags (`enabled && f1_reminders`) are re-checked immediately
//!   before each delivery, after the async fetch.
//! - Persistent de-dup lives in the shared SQLite cache under synthetic
//!   source `f1-reminders` (30-day prune), so restarts never replay a
//!   reminder. If a cache write fails, an in-memory set suppresses
//!   in-process duplicates.
//! - No std::sync::Mutex is held across an .await point.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;
use tokio::time::sleep;

use crate::bridge::{fetch_with_cache, AppStateInner};
#[cfg(test)]
use crate::cache::iso_utc_ms;
use crate::cache::now_ms;
use crate::poller::Poller;

const STARTUP_DELAY: Duration = Duration::from_secs(5);
const TICK: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);
const DELIVERY_RETRY: Duration = Duration::from_secs(5);

/// Reminder window: only sessions starting strictly in (0, 15 minutes].
#[cfg(test)]
const WINDOW_MS: i64 = 15 * 60 * 1000;
const DEDUP_SOURCE: &str = "f1-reminders";
const DEDUP_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const SCHEDULE_PATH: &str = "current.json?limit=100";

/// One upcoming session worth reminding about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reminder {
    /// Stable identity: `season|round|session` (survives schedule moves).
    pub key: String,
    pub title: String,
    pub body: String,
    pub start_ms: i64,
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Strict UTC datetime: `YYYY-MM-DD` + `HH:MM:SSZ`. Rejects impossible
/// dates (e.g. Feb 30, invalid leap days) and impossible times. Unknown or
/// malformed time is NEVER treated as midnight.
pub(crate) fn parse_utc_ms(date: &str, time: &str) -> Option<i64> {
    let d = date.trim();
    let t = time.trim();
    if d.len() != 10 || t.len() != 9 {
        return None;
    }
    let bytes = d.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i64 = d.get(0..4)?.parse().ok()?;
    let month: i64 = d.get(5..7)?.parse().ok()?;
    let day: i64 = d.get(8..10)?.parse().ok()?;
    let tb = t.as_bytes();
    if tb[2] != b':' || tb[5] != b':' || tb[8] != b'Z' {
        return None;
    }
    let hour: i64 = t.get(0..2)?.parse().ok()?;
    let minute: i64 = t.get(3..5)?.parse().ok()?;
    let second: i64 = t.get(6..8)?.parse().ok()?;
    if !(1..=12).contains(&month)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    let max_day = days_in_month(year, month)?;
    if day < 1 || day > max_day {
        return None;
    }
    // Days from civil (Howard Hinnant).
    let y_adj = if month <= 2 { year - 1 } else { year };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = y_adj - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some((days * 86_400 + hour * 3600 + minute * 60 + second) * 1000)
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> Option<i64> {
    Some(match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => return None,
    })
}

/// Canonical session id: SprintQualifying and SprintShootout are the same
/// session under different provider aliases (never both emitted).
fn canonical_session(raw: &str) -> Option<(&'static str, &'static str)> {
    match raw {
        "FirstPractice" => Some(("fp1", "Первая практика")),
        "SecondPractice" => Some(("fp2", "Вторая практика")),
        "ThirdPractice" => Some(("fp3", "Третья практика")),
        "Qualifying" => Some(("qualifying", "Квалификация")),
        "Sprint" => Some(("sprint", "Спринт")),
        "SprintQualifying" | "SprintShootout" => Some(("sprint-qualifying", "Спринт-квалификация")),
        _ => None,
    }
}

/// Session fields in a stable, race-weekend-logical order.
const SESSION_FIELDS: &[&str] = &[
    "FirstPractice",
    "SecondPractice",
    "ThirdPractice",
    "Qualifying",
    "SprintQualifying",
    "SprintShootout",
    "Sprint",
];

/// Pure helper: reminders for sessions starting in (0, 15 minutes] from
/// `now_ms`. Malformed dates/times are rejected; unknown time is skipped.
/// The race itself is included when it carries both date and time.
#[cfg(test)]
pub fn due_reminders(payload: &Value, now_ms: i64) -> Vec<Reminder> {
    due_with_lead(payload, now_ms, WINDOW_MS)
}
fn due_with_lead(payload: &Value, now_ms: i64, lead_ms: i64) -> Vec<Reminder> {
    let mut out: Vec<Reminder> = Vec::new();
    let Some(races) = payload
        .get("MRData")
        .and_then(|m| m.get("RaceTable"))
        .and_then(|r| r.get("Races"))
        .and_then(Value::as_array)
    else {
        return out;
    };
    for race in races {
        let season = str_field(race, "season").unwrap_or("").to_string();
        let round = str_field(race, "round").unwrap_or("").to_string();
        let race_name = str_field(race, "raceName")
            .unwrap_or("Гран-при")
            .to_string();
        if season.is_empty() || round.is_empty() {
            continue;
        }
        let mut seen: HashSet<&'static str> = HashSet::new();
        // The race session itself (requires an explicit UTC time).
        if let (Some(date), Some(time)) = (str_field(race, "date"), str_field(race, "time")) {
            if let Some(start) = parse_utc_ms(date, time) {
                push_due(
                    &mut out,
                    &mut seen,
                    "race",
                    "Гран-при",
                    &season,
                    &round,
                    &race_name,
                    start,
                    now_ms,
                    lead_ms,
                );
            }
        }
        for field in SESSION_FIELDS {
            let Some(node) = race.get(*field) else {
                continue;
            };
            let Some((sid, label)) = canonical_session(field) else {
                continue;
            };
            let (Some(date), Some(time)) = (str_field(node, "date"), str_field(node, "time"))
            else {
                continue;
            };
            let Some(start) = parse_utc_ms(date, time) else {
                continue;
            };
            push_due(
                &mut out, &mut seen, sid, label, &season, &round, &race_name, start, now_ms,
                lead_ms,
            );
        }
    }
    out.sort_by_key(|r| r.start_ms);
    out
}

#[allow(clippy::too_many_arguments)]
fn push_due(
    out: &mut Vec<Reminder>,
    seen: &mut HashSet<&'static str>,
    sid: &'static str,
    label: &'static str,
    season: &str,
    round: &str,
    race_name: &str,
    start_ms: i64,
    now_ms: i64,
    lead_ms: i64,
) {
    let delta = start_ms - now_ms;
    if delta <= 0 || delta > lead_ms {
        return;
    }
    if !seen.insert(sid) {
        return;
    }
    let mins = ((delta + 59_999) / 60_000).max(1);
    out.push(Reminder {
        key: format!("{season}|{round}|{sid}"),
        title: format!("F1: {label}"),
        body: format!("{race_name} · начнётся через {mins} мин."),
        start_ms,
    });
}

const RACE_DAYS: [&str; 7] = [
    "гоночный понедельник",
    "гоночный вторник",
    "гоночная среда",
    "гоночный четверг",
    "гоночная пятница",
    "гоночная суббота",
    "гоночное воскресенье",
];

/// Day phrase for the session start in the user's timezone.
fn race_day(start_ms: i64, timezone: &str) -> Option<&'static str> {
    use chrono::Datelike;
    let zone = timezone.parse::<chrono_tz::Tz>().unwrap_or(chrono_tz::UTC);
    let date = chrono::DateTime::from_timestamp_millis(start_ms)?.with_timezone(&zone);
    RACE_DAYS
        .get(date.weekday().num_days_from_monday() as usize)
        .copied()
}

/// Short printable address for the radio phrase (no control characters).
fn radio_address(name: &str) -> Option<String> {
    let clean: String = name.chars().filter(|c| !c.is_control()).take(24).collect();
    let clean = clean.trim().to_string();
    (!clean.is_empty()).then_some(clean)
}

/// SportsDesk-styled "team radio" text for a real session reminder. The key
/// is unchanged, so styling never creates extra duplicates. The phrases are
/// app styling, not real team recordings, and never announce a pit stop.
pub(crate) fn radio_styled(reminder: Reminder, timezone: &str, name: &str) -> Reminder {
    let sid = reminder.key.rsplit('|').next().unwrap_or("");
    let Some(label) = reminder.title.strip_prefix("F1: ") else {
        return reminder;
    };
    let Some((race, when)) = reminder.body.split_once(" · ") else {
        return reminder;
    };
    let tail = match sid {
        "fp1" | "fp2" | "fp3" => "Проверяем баланс машины.",
        "qualifying" | "sprint-qualifying" => "Нужен чистый круг.",
        "sprint" => "Короткая дистанция — без права на ошибку.",
        "race" => "Скоро погаснут огни.",
        _ => "Будь у экрана.",
    };
    let day = race_day(reminder.start_ms, timezone).unwrap_or("гоночный день");
    let address = radio_address(name)
        .map(|n| format!(", {n}"))
        .unwrap_or_default();
    let title = format!("📻 Радио SportsDesk · {label}");
    let body = format!("«Это {day}{address}. {label} {when} {tail}» · {race}");
    Reminder {
        title,
        body,
        ..reminder
    }
}

/// Delivery gate: opt-in flags are re-read immediately before each
/// notification, after the async fetch completed.
#[derive(Default)]
pub struct DeliveryGate {
    /// In-process fallback when a persistent dedup write fails.
    sent: HashSet<String>,
}

impl DeliveryGate {
    pub fn new() -> Self {
        Self {
            sent: HashSet::new(),
        }
    }

    /// True when this reminder has never been delivered (persistent row or
    /// in-memory suppression). Does not mark.
    pub fn can_send(&self, cache: &crate::cache::Cache, key: &str) -> bool {
        !self.sent.contains(key) && cache.get(DEDUP_SOURCE, key).is_none()
    }

    /// Mark delivered. Returns Err when the persistent write failed, in
    /// which case the caller must keep the in-memory suppression.
    pub fn mark(
        &mut self,
        cache: &crate::cache::Cache,
        key: &str,
        at_ms: i64,
    ) -> Result<(), String> {
        let payload = serde_json::json!({ "sentAt": at_ms });
        cache.put(DEDUP_SOURCE, key, &payload, at_ms)?;
        Ok(())
    }

    /// Called after a successful persistent write to drop the fallback entry.
    pub fn confirm(&mut self, key: &str) {
        self.sent.remove(key);
    }

    /// Called when the persistent write failed: suppress future in-process
    /// duplicates for this key.
    pub fn suppress(&mut self, key: &str) {
        self.sent.insert(key.to_string());
    }

    fn deliver(
        &mut self,
        cache: &crate::cache::Cache,
        key: &str,
        now: i64,
        send: impl FnOnce() -> bool,
    ) -> bool {
        if !self.can_send(cache, key) || !send() {
            return false;
        }
        match self.mark(cache, key, now) {
            Ok(()) => self.confirm(key),
            Err(_) => self.suppress(key),
        }
        true
    }
}

fn reminders_enabled(poller: &Poller) -> bool {
    let cfg = poller.config();
    cfg.enabled && cfg.f1_reminders && poller.delivery_allowed("reminder", &[])
}

/// One reminder cycle. On successful fetch, returns the earliest start time
/// whose OS delivery failed; the loop can retry it before that session starts.
async fn tick(
    app: &AppHandle,
    poller: &Poller,
    state: &Arc<AppStateInner>,
    gate: &mut DeliveryGate,
) -> Result<Option<i64>, crate::bridge::ApiFailure> {
    let reply = fetch_with_cache(
        state.clone(),
        "jolpica".to_string(),
        SCHEDULE_PATH.to_string(),
    )
    .await
    .map_err(|e| e.failure())?;
    if reply.stale {
        // Stale schedule must never drive notifications.
        return Err(reply
            .failure
            .unwrap_or_else(|| crate::bridge::BridgeError::Upstream.failure()));
    }
    let now = now_ms();
    crate::tray::update_f1(app, &reply.payload, &poller.config().timezone);
    let due = due_with_lead(&reply.payload, now, poller.config().policy.lead_ms());
    if due.is_empty() {
        return Ok(None);
    }
    state.cache.prune_source(DEDUP_SOURCE, now - DEDUP_TTL_MS);
    let mut failed_start: Option<i64> = None;
    for reminder in due {
        // The session preference controls the feed independently of OS delivery.
        if !poller.config().f1_reminders {
            break;
        }
        let cfg = poller.config();
        let reminder = if cfg.f1_radio {
            radio_styled(reminder, &cfg.timezone, &cfg.f1_radio_name)
        } else {
            reminder
        };
        let mut target = reminder.key.split('|');
        let season = target.next().map(str::to_owned);
        let round = target.next().map(str::to_owned);
        crate::event_center::record(
            app,
            &state.cache,
            &crate::event_center::Event {
                id: format!("f1|{}", reminder.key),
                sport: "f1".into(),
                kind: "reminder".into(),
                title: reminder.title.clone(),
                body: reminder.body.clone(),
                occurred_at: now,
                read: false,
                match_id: None,
                league_id: None,
                season,
                round,
            },
        );
        if !reminders_enabled(poller) || !gate.can_send(&state.cache, &reminder.key) {
            continue;
        }
        let delivered = gate.deliver(&state.cache, &reminder.key, now, || {
            reminders_enabled(poller)
                && app
                    .notification()
                    .builder()
                    .title(&reminder.title)
                    .body(&reminder.body)
                    .show()
                    .is_ok()
        });
        if !delivered {
            if reminders_enabled(poller) && gate.can_send(&state.cache, &reminder.key) {
                failed_start = Some(
                    failed_start.map_or(reminder.start_ms, |start| start.min(reminder.start_ms)),
                );
            }
            continue;
        }
        let _ = app.emit(
            "sportsdesk://f1-reminder",
            serde_json::json!({ "title": reminder.title, "body": reminder.body, "radio": cfg.f1_radio }),
        );
    }
    Ok(failed_start)
}

/// Retry a failed native delivery at most every five seconds, sooner when a
/// session is about to start. An upstream failure must not postpone that retry.
fn reminder_retry_delay(upstream_delay: Duration, failed_start: Option<i64>, now: i64) -> Duration {
    let Some(remaining) = failed_start
        .and_then(|start| start.checked_sub(now))
        .filter(|ms| *ms > 0)
    else {
        return upstream_delay;
    };
    let until_retry = Duration::from_millis((remaining / 2).max(1) as u64).min(DELIVERY_RETRY);
    upstream_delay.min(until_retry)
}

async fn wait_for_tick(pause: Duration, current: impl Fn() -> bool) {
    let until = tokio::time::Instant::now() + pause;
    while current() {
        let remaining = until.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        sleep(remaining.min(Duration::from_secs(2))).await;
    }
}

/// Public entry point (called from lib.rs). No OS app/window changes and no
/// notification permission requests: the existing global toggle is the
/// user's opt-in.
pub fn start(app: AppHandle, poller: Arc<Poller>, state: Arc<AppStateInner>) {
    tauri::async_runtime::spawn(async move {
        sleep(STARTUP_DELAY).await;
        let mut pause = TICK;
        let mut gate = DeliveryGate::new();
        let mut failed_start = None;
        loop {
            let revision = poller.revision();
            match tick(&app, &poller, &state, &mut gate).await {
                Ok(failed) => {
                    failed_start = failed;
                    pause = crate::poller::retry_delay(pause, TICK, MAX_BACKOFF, None);
                }
                Err(error) => {
                    pause = crate::poller::retry_delay(pause, TICK, MAX_BACKOFF, Some(&error));
                }
            }
            let now = now_ms();
            if failed_start.is_some_and(|start| start <= now) {
                failed_start = None;
            }
            let wait = reminder_retry_delay(pause, failed_start, now);
            wait_for_tick(wait, || poller.revision() == revision).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::Cache;

    #[test]
    fn failed_or_disabled_delivery_is_not_marked_and_success_is_sent_once() {
        let cache = Cache::open_in_memory();
        let mut gate = DeliveryGate::new();
        let key = "2026|1|race";
        assert!(!gate.deliver(&cache, key, 1, || false));
        assert!(gate.can_send(&cache, key));
        assert!(gate.deliver(&cache, key, 2, || true));
        assert!(!gate.deliver(&cache, key, 3, || panic!("duplicate delivery")));
    }

    #[test]
    fn failed_delivery_waits_the_short_interval_and_retries_before_start() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                tokio::time::pause();
                let cache = Cache::open_in_memory();
                let mut gate = DeliveryGate::new();
                let key = "2026|1|race";
                let now = base_now();
                let start = now + 4_000;
                assert!(!gate.deliver(&cache, key, now, || false));
                let delay = reminder_retry_delay(MAX_BACKOFF, Some(start), now);
                assert_eq!(delay, Duration::from_secs(2));
                let began = tokio::time::Instant::now();
                let waiting = tokio::spawn(wait_for_tick(delay, || true));
                tokio::task::yield_now().await;
                tokio::time::advance(Duration::from_millis(1_999)).await;
                assert!(!waiting.is_finished());
                tokio::time::advance(Duration::from_millis(1)).await;
                waiting.await.unwrap();
                let elapsed = began.elapsed();
                assert!(elapsed >= delay && elapsed <= delay + Duration::from_millis(2));
                assert!(now + (elapsed.as_millis() as i64) < start);
                assert!(gate.deliver(&cache, key, now + 2_000, || true));
                assert!(!gate.deliver(&cache, key, now + 3_000, || panic!("duplicate delivery")));
            });
    }

    fn base_now() -> i64 {
        // 2026-06-01T12:00:00Z
        parse_utc_ms("2026-06-01", "12:00:00Z").unwrap()
    }

    fn race_json(race: Value) -> Value {
        serde_json::json!({ "MRData": { "RaceTable": { "Races": [race] } } })
    }

    #[test]
    fn future_within_15min_is_due() {
        let now = base_now();
        let payload = race_json(serde_json::json!({
            "season": "2026", "round": "7", "raceName": "Гран-при Канады",
            "date": "2026-06-01", "time": "12:10:00Z"
        }));
        let due = due_reminders(&payload, now);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].key, "2026|7|race");
        assert!(due[0].body.contains("10 мин"));
    }

    #[test]
    fn boundary_exact_15min_included_and_past_excluded() {
        let now = base_now();
        let exact = race_json(serde_json::json!({
            "season": "2026", "round": "1", "raceName": "GP",
            "date": "2026-06-01", "time": "12:15:00Z"
        }));
        assert_eq!(due_reminders(&exact, now).len(), 1);
        let past = race_json(serde_json::json!({
            "season": "2026", "round": "1", "raceName": "GP",
            "date": "2026-06-01", "time": "11:59:00Z"
        }));
        assert!(due_reminders(&past, now).is_empty());
        let outside = race_json(serde_json::json!({
            "season": "2026", "round": "1", "raceName": "GP",
            "date": "2026-06-01", "time": "12:16:00Z"
        }));
        assert!(due_reminders(&outside, now).is_empty());
        let now_boundary = race_json(serde_json::json!({
            "season": "2026", "round": "1", "raceName": "GP",
            "date": "2026-06-01", "time": "12:00:00Z"
        }));
        assert!(due_reminders(&now_boundary, now).is_empty());
    }

    #[test]
    fn unknown_time_is_never_midnight() {
        let now = base_now();
        let payload = race_json(serde_json::json!({
            "season": "2026", "round": "2", "raceName": "GP",
            "date": "2026-06-01",
            "Qualifying": { "date": "2026-06-01" }
        }));
        assert!(due_reminders(&payload, now).is_empty());
        // Midnight of the same day would be in the past anyway; a next-day
        // date without time must also stay silent.
        let payload2 = race_json(serde_json::json!({
            "season": "2026", "round": "2", "raceName": "GP",
            "date": "2026-06-02"
        }));
        assert!(due_reminders(&payload2, now).is_empty());
    }

    #[test]
    fn invalid_dates_and_times_are_rejected() {
        let now = base_now();
        // Feb 30 is impossible.
        assert!(parse_utc_ms("2026-02-30", "12:00:00Z").is_none());
        // 2026 is not a leap year: Feb 29 invalid.
        assert!(parse_utc_ms("2026-02-29", "12:00:00Z").is_none());
        // 2024 is a leap year: Feb 29 valid.
        assert!(parse_utc_ms("2024-02-29", "12:00:00Z").is_some());
        // 1900 not leap, 2000 leap.
        assert!(parse_utc_ms("1900-02-29", "12:00:00Z").is_none());
        assert!(parse_utc_ms("2000-02-29", "12:00:00Z").is_some());
        // Invalid times.
        assert!(parse_utc_ms("2026-06-01", "24:00:00Z").is_none());
        assert!(parse_utc_ms("2026-06-01", "12:60:00Z").is_none());
        assert!(parse_utc_ms("2026-06-01", "12:00:60Z").is_none());
        assert!(parse_utc_ms("2026-06-01", "12:00:00").is_none());
        let payload = race_json(serde_json::json!({
            "season": "2026", "round": "3", "raceName": "GP",
            "date": "2026-06-01", "time": "12:10:00Z",
            "Qualifying": { "date": "2026-02-30", "time": "12:10:00Z" }
        }));
        let due = due_reminders(&payload, now);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].key, "2026|3|race");
    }

    #[test]
    fn regular_weekend_sessions_and_sprint_aliases() {
        let now = base_now();
        let payload = race_json(serde_json::json!({
            "season": "2026", "round": "4", "raceName": "Гран-при",
            "date": "2026-06-01", "time": "12:14:00Z",
            "FirstPractice": { "date": "2026-06-01", "time": "12:05:00Z" },
            "SecondPractice": { "date": "2026-06-01", "time": "12:15:00Z" },
            "ThirdPractice": { "date": "2026-06-01", "time": "12:06:00Z" },
            "Qualifying": { "date": "2026-06-01", "time": "12:07:00Z" },
            "Sprint": { "date": "2026-06-01", "time": "12:08:00Z" },
            "SprintQualifying": { "date": "2026-06-01", "time": "12:09:00Z" }
        }));
        let due = due_reminders(&payload, now);
        let keys: Vec<&str> = due.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys.len(), 7);
        assert!(keys.contains(&"2026|4|fp1"));
        assert!(keys.contains(&"2026|4|fp2"));
        assert!(keys.contains(&"2026|4|fp3"));
        assert!(keys.contains(&"2026|4|qualifying"));
        assert!(keys.contains(&"2026|4|sprint"));
        assert!(keys.contains(&"2026|4|sprint-qualifying"));
        assert!(keys.contains(&"2026|4|race"));
        // Sorted by start time.
        assert!(due.windows(2).all(|w| w[0].start_ms <= w[1].start_ms));

        // SprintShootout alias produces the same canonical session key.
        let alias = race_json(serde_json::json!({
            "season": "2026", "round": "5", "raceName": "GP",
            "date": "2026-06-01", "time": "14:00:00Z",
            "SprintShootout": { "date": "2026-06-01", "time": "12:09:00Z" }
        }));
        let due_alias = due_reminders(&alias, now);
        assert_eq!(due_alias.len(), 1);
        assert_eq!(due_alias[0].key, "2026|5|sprint-qualifying");

        // Both aliases present: only one reminder (no duplicate).
        let both = race_json(serde_json::json!({
            "season": "2026", "round": "6", "raceName": "GP",
            "date": "2026-06-01", "time": "14:00:00Z",
            "SprintQualifying": { "date": "2026-06-01", "time": "12:09:00Z" },
            "SprintShootout": { "date": "2026-06-01", "time": "12:09:00Z" }
        }));
        let due_both = due_reminders(&both, now);
        let sq: Vec<_> = due_both
            .iter()
            .filter(|r| r.key.ends_with("sprint-qualifying"))
            .collect();
        assert_eq!(sq.len(), 1);
    }

    #[test]
    fn persistent_dedup_and_in_memory_suppression() {
        let cache = Cache::open_in_memory();
        let mut gate = DeliveryGate::new();
        let key = "2026|7|race";
        let now = base_now();
        assert!(gate.can_send(&cache, key));
        gate.mark(&cache, key, now).expect("cache write");
        gate.confirm(key);
        assert!(!gate.can_send(&cache, key));
        // A fresh gate (restart) still sees the persistent row.
        let gate2 = DeliveryGate::new();
        assert!(!gate2.can_send(&cache, key));
        // Row older than 30 days is pruned.
        cache.prune_source(DEDUP_SOURCE, now + 1);
        assert!(gate2.can_send(&cache, key));
        // In-memory suppression when the persistent write fails.
        let mut gate3 = DeliveryGate::new();
        let bad = "bad|key";
        assert!(gate3.can_send(&cache, bad));
        // Simulate a failed write by using a poisoned payload path: mark with
        // an unserializable value is impossible with json!, so instead verify
        // suppress() directly drives can_send.
        gate3.suppress(bad);
        assert!(!gate3.can_send(&cache, bad));
    }

    #[test]
    fn radio_style_keeps_key_and_uses_local_day() {
        // 2026-11-06 is a Friday; 23:30 UTC is already Saturday in Yakutsk.
        let base = Reminder {
            key: "2026|21|fp1".into(),
            title: "F1: Первая практика".into(),
            body: "Гран-при Бразилии · начнётся через 10 мин.".into(),
            start_ms: parse_utc_ms("2026-11-06", "14:30:00Z").unwrap(),
        };
        let styled = radio_styled(base.clone(), "UTC", "Макс");
        assert_eq!(styled.key, base.key);
        assert_eq!(styled.start_ms, base.start_ms);
        assert!(styled.title.contains("Радио SportsDesk"));
        assert!(styled.body.contains("гоночная пятница, Макс."));
        assert!(styled.body.contains("начнётся через 10 мин."));
        assert!(styled.body.ends_with("Гран-при Бразилии"));
        assert!(!styled.body.to_lowercase().contains("box"));
        let late = Reminder {
            start_ms: parse_utc_ms("2026-11-06", "23:30:00Z").unwrap(),
            ..base.clone()
        };
        assert!(radio_styled(late, "Asia/Yakutsk", " \u{7} ")
            .body
            .contains("гоночная суббота. "));
        let odd = Reminder {
            title: "Другое".into(),
            ..base.clone()
        };
        assert_eq!(radio_styled(odd.clone(), "UTC", "Макс"), odd);
    }

    #[test]
    fn malformed_payload_yields_nothing() {
        assert!(due_reminders(&serde_json::json!({}), base_now()).is_empty());
        assert!(due_reminders(&serde_json::json!({ "MRData": {} }), base_now()).is_empty());
        let missing = race_json(serde_json::json!({ "season": "2026", "round": "1" }));
        assert!(due_reminders(&missing, base_now()).is_empty());
    }

    #[test]
    fn iso_helper_roundtrip_is_stable() {
        let ms = parse_utc_ms("2026-06-01", "12:00:00Z").unwrap();
        assert!(iso_utc_ms(ms).starts_with("2026-06-01T12:00:00"));
    }
}
