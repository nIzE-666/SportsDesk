//! «Пока вас не было»: восстановление итогов, пропущенных пока приложение
//! было закрыто или компьютер спал.
//!
//! - Курсоры покрытия лежат в отдельной таблице `sync_cursor` и не
//!   очищаются вместе с кешем API.
//! - Курсор источника продвигается только когда все запросы окна получены
//!   свежими и каждая запись в центр событий прошла успешно. После сетевой
//!   ошибки следующий проход повторяет тот же интервал.
//! - Идентификаторы событий совпадают с идентификаторами живого поллера
//!   (`football|end|<id>`), поэтому `INSERT OR IGNORE` защищает от дублей.
//! - Восстановленные события никогда не вызывают уведомлений, звуков или
//!   конфетти; авторы голов и минуты не придумываются.
//! - Никакой std::sync::Mutex не удерживается через .await.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::time::sleep;

use crate::bridge::{fetch_with_cache, AppState, AppStateInner};
use crate::cache::{iso_utc_ms, now_ms, Cache};
use crate::event_center::Event;
use crate::f1_reminders::parse_utc_ms;
use crate::poller::{
    canonical_status, favorite_ids, match_label, parse_time_ms, pitch_match, score_label,
    score_text, FlatMatch, PollConfig, Poller,
};

const MINUTE: i64 = 60 * 1000;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;
/// Глубина восстановления.
pub const WINDOW_MS: i64 = 72 * HOUR;
/// Разрыв, после которого считаем, что приложение не наблюдало события.
pub const GAP_MS: i64 = 20 * MINUTE;
/// Матч, начавшийся до границы окна, но закончившийся внутри неё.
const KICKOFF_LOOKBACK_MS: i64 = 3 * HOUR;
const F1_INTERVAL_MS: i64 = 15 * MINUTE;
const RETRY_MS: i64 = 5 * MINUTE;
const STARTUP_DELAY: Duration = Duration::from_secs(12);
const TICK: Duration = Duration::from_secs(60);
const MAX_ITEMS: usize = 60;
pub const FOOTBALL: &str = "football";
pub const F1: &str = "f1";
const SCHEDULE_PATH: &str = "current.json?limit=100";
pub const CHANGED_EVENT: &str = "sportsdesk://catchup-changed";

/// Интервал, который нужно восстановить.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub from: i64,
    pub to: i64,
    /// Отсутствие было дольше `WINDOW_MS`: начало не восстанавливается.
    pub truncated: bool,
}

/// Первый запуск (нет курсора) и короткие разрывы ничего не восстанавливают.
/// Часы, ушедшие назад, тоже (`now < cursor`).
pub fn plan_window(cursor: Option<i64>, now: i64, gap: i64) -> Option<Window> {
    let cursor = cursor?;
    if now - cursor < gap {
        return None;
    }
    let earliest = now - WINDOW_MS;
    Some(Window {
        from: cursor.max(earliest),
        to: now,
        truncated: cursor < earliest,
    })
}

/// UTC-даты для запросов `date/<day>`, включая запас на ранний старт матча.
pub fn utc_days(window: &Window) -> Vec<String> {
    let first = (window.from - KICKOFF_LOOKBACK_MS).div_euclid(DAY);
    let last = window.to.div_euclid(DAY);
    (first..=last)
        .map(|day| iso_utc_ms(day * DAY)[..10].to_string())
        .collect()
}

/// Матчи за несколько дней. Противоречивые дубли помечаются как неоднозначные.
#[derive(Debug, Default)]
pub struct DayScan {
    pub matches: HashMap<String, FlatMatch>,
    pub ambiguous: HashSet<String>,
    pub failed: bool,
}

impl DayScan {
    pub fn add_payload(&mut self, payload: &Value) {
        let data = payload.get("data").unwrap_or(payload);
        let Some(list) = data.get("matches").and_then(Value::as_array) else {
            self.failed = true;
            return;
        };
        for value in list {
            let Some(m) = pitch_match(value) else {
                continue;
            };
            if let Some(existing) = self.matches.get(&m.id) {
                if canonical_status(existing) != canonical_status(&m)
                    || score_text(&existing.home_score) != score_text(&m.home_score)
                    || score_text(&existing.away_score) != score_text(&m.away_score)
                {
                    self.ambiguous.insert(m.id.clone());
                }
            }
            self.matches.insert(m.id.clone(), m);
        }
    }
}

/// Результат одного прохода источника.
#[derive(Debug, Default)]
pub struct Outcome {
    pub events: Vec<Event>,
    pub incomplete: bool,
}

/// Завершённые матчи избранного, начавшиеся в `[from - 3 ч, to]`.
pub fn football_events(scan: &DayScan, cfg: &PollConfig, window: &Window) -> Outcome {
    let mut out = Outcome {
        incomplete: scan.failed,
        ..Default::default()
    };
    let mut ids: Vec<&String> = scan.matches.keys().collect();
    ids.sort();
    for id in ids {
        let m = &scan.matches[id];
        if favorite_ids(m, cfg).is_empty() {
            continue;
        }
        let (_, finished, _) = canonical_status(m);
        let Some(kickoff) = m.time.as_deref().and_then(parse_time_ms) else {
            if finished {
                out.incomplete = true;
            }
            continue;
        };
        if kickoff < window.from - KICKOFF_LOOKBACK_MS || kickoff > window.to {
            continue;
        }
        if scan.ambiguous.contains(id) {
            out.incomplete = true;
            continue;
        }
        if !finished {
            continue;
        }
        let has_score =
            !score_text(&m.home_score).is_empty() && !score_text(&m.away_score).is_empty();
        let body = if has_score {
            score_label(m)
        } else {
            out.incomplete = true;
            format!("{} · счёт недоступен", match_label(m))
        };
        out.events.push(Event {
            id: format!("football|end|{}", m.id),
            sport: "football".into(),
            kind: "end".into(),
            title: "Матч завершён".into(),
            body,
            occurred_at: kickoff,
            read: false,
            match_id: Some(m.id.clone()),
            league_id: None,
            season: None,
            round: None,
        });
    }
    out
}

/// Завершённая сессия Ф1, итоги которой нужно получить.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct F1Session {
    pub season: String,
    pub round: String,
    pub sid: &'static str,
    pub label: &'static str,
    pub race_name: String,
    pub ends_at: i64,
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Квалификации, спринты и гонки, расчётное окончание которых попало в
/// `(from, to]`. Практики пропускаются: у них нет итогов в Jolpica.
pub fn finished_sessions(schedule: &Value, window: &Window) -> Vec<F1Session> {
    let mut out = Vec::new();
    let races = schedule
        .pointer("/MRData/RaceTable/Races")
        .and_then(Value::as_array);
    for race in races.into_iter().flatten() {
        let (Some(season), Some(round)) = (text(race, "season"), text(race, "round")) else {
            continue;
        };
        let race_name = text(race, "raceName").unwrap_or("Гран-при");
        let parts: [(Option<&Value>, &'static str, &'static str, i64); 3] = [
            (
                race.get("Qualifying"),
                "qualifying",
                "Квалификация",
                90 * MINUTE,
            ),
            (race.get("Sprint"), "sprint", "Спринт", 90 * MINUTE),
            (Some(race), "race", "Гонка", 3 * HOUR),
        ];
        for (node, sid, label, duration) in parts {
            let Some(node) = node else {
                continue;
            };
            let (Some(date), Some(time)) = (text(node, "date"), text(node, "time")) else {
                continue;
            };
            let Some(start) = parse_utc_ms(date, time) else {
                continue;
            };
            let ends_at = start + duration;
            if ends_at > window.from && ends_at <= window.to {
                out.push(F1Session {
                    season: season.into(),
                    round: round.into(),
                    sid,
                    label,
                    race_name: race_name.into(),
                    ends_at,
                });
            }
        }
    }
    out.sort_by_key(|s| s.ends_at);
    out
}

pub fn results_path(session: &F1Session) -> String {
    let file = match session.sid {
        "race" => "results",
        "sprint" => "sprint",
        _ => "qualifying",
    };
    format!("{}/{}/{file}.json", session.season, session.round)
}

/// Итог сессии из ответа Jolpica. `None` — итогов пока нет.
pub fn result_event(session: &F1Session, payload: &Value) -> Option<Event> {
    let race = payload.pointer("/MRData/RaceTable/Races/0")?;
    let key = match session.sid {
        "race" => "Results",
        "sprint" => "SprintResults",
        _ => "QualifyingResults",
    };
    let first = race.get(key)?.as_array()?.first()?;
    let driver = first.get("Driver")?;
    let name = [text(driver, "givenName"), text(driver, "familyName")]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    if name.is_empty() {
        return None;
    }
    let who = match first.get("Constructor").and_then(|c| text(c, "name")) {
        Some(team) => format!("{name} ({team})"),
        None => name,
    };
    let body = if session.sid == "qualifying" {
        format!("{} · поул: {who}", session.race_name)
    } else {
        format!("{} · победитель: {who}", session.race_name)
    };
    Some(Event {
        id: format!(
            "f1|result|{}|{}|{}",
            session.season, session.round, session.sid
        ),
        sport: "f1".into(),
        kind: "result".into(),
        title: format!("{}: итоги", session.label),
        body,
        occurred_at: session.ends_at,
        read: false,
        match_id: None,
        league_id: None,
        season: Some(session.season.clone()),
        round: Some(session.round.clone()),
    })
}

/// Сводка «Пока вас не было», показываемая до закрытия пользователем.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub from: i64,
    pub to: i64,
    pub truncated: bool,
    pub football_incomplete: bool,
    pub f1_incomplete: bool,
    pub items: Vec<Event>,
}

pub fn merge_summary(
    existing: Option<Summary>,
    source: &str,
    window: &Window,
    inserted: Vec<Event>,
    incomplete: bool,
) -> Option<Summary> {
    if existing.is_none() && inserted.is_empty() && !incomplete {
        return None;
    }
    let mut summary = existing.unwrap_or(Summary {
        from: window.from,
        to: window.to,
        ..Default::default()
    });
    summary.from = summary.from.min(window.from);
    summary.to = summary.to.max(window.to);
    summary.truncated |= window.truncated;
    if source == FOOTBALL {
        summary.football_incomplete = incomplete;
    } else {
        summary.f1_incomplete = incomplete;
    }
    for event in inserted {
        if !summary.items.iter().any(|item| item.id == event.id) {
            summary.items.push(event);
        }
    }
    summary.items.sort_by(|a, b| {
        b.occurred_at
            .cmp(&a.occurred_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    summary.items.truncate(MAX_ITEMS);
    Some(summary)
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Applied {
    pub inserted: usize,
    pub summary_changed: bool,
    pub advanced: bool,
}

/// Записывает события (без уведомлений), продвигает курсор только при
/// полном успехе и, если нужно, дополняет сводку.
pub fn apply_outcome(
    cache: &Cache,
    source: &str,
    window: &Window,
    outcome: Outcome,
    to_summary: bool,
    now: i64,
) -> Applied {
    let mut incomplete = outcome.incomplete;
    let mut inserted = Vec::new();
    for event in outcome.events {
        match cache.insert_event(&event, now) {
            Ok(true) => inserted.push(event),
            Ok(false) => {}
            Err(_) => incomplete = true,
        }
    }
    let count = inserted.len();
    let advanced = !incomplete && cache.set_sync_cursor(source, window.to, now).is_ok();
    let mut summary_changed = false;
    if to_summary {
        let existing = cache
            .catchup_summary()
            .ok()
            .flatten()
            .and_then(|text| serde_json::from_str::<Summary>(&text).ok());
        if let Some(next) = merge_summary(existing, source, window, inserted, incomplete) {
            if let Ok(text) = serde_json::to_string(&next) {
                summary_changed = cache.set_catchup_summary(Some(&text), now).is_ok();
            }
        }
    }
    Applied {
        inserted: count,
        summary_changed,
        advanced,
    }
}

async fn football_outcome(
    state: &Arc<AppStateInner>,
    cfg: &PollConfig,
    window: &Window,
) -> Outcome {
    if cfg.favorite_teams.is_empty() && cfg.favorites.is_empty() {
        return Outcome::default();
    }
    let mut scan = DayScan::default();
    for day in utc_days(window) {
        match fetch_with_cache(
            state.clone(),
            "pitch".into(),
            format!("date/{day}?status=all"),
        )
        .await
        {
            Ok(reply) if !reply.stale => scan.add_payload(&reply.payload),
            _ => scan.failed = true,
        }
    }
    football_events(&scan, cfg, window)
}

async fn f1_outcome(state: &Arc<AppStateInner>, window: &Window) -> Outcome {
    let schedule =
        match fetch_with_cache(state.clone(), "jolpica".into(), SCHEDULE_PATH.into()).await {
            Ok(reply) if !reply.stale => reply.payload,
            _ => {
                return Outcome {
                    incomplete: true,
                    ..Default::default()
                }
            }
        };
    let mut out = Outcome::default();
    for session in finished_sessions(&schedule, window) {
        match fetch_with_cache(state.clone(), "jolpica".into(), results_path(&session)).await {
            Ok(reply) if !reply.stale => match result_event(&session, &reply.payload) {
                Some(event) => out.events.push(event),
                None => out.incomplete = true,
            },
            _ => out.incomplete = true,
        }
    }
    out
}

/// Пауза между повторами после неполного восстановления.
#[derive(Debug, Default)]
struct Backoff {
    football_after: i64,
    f1_after: i64,
}

fn poller_observing(poller: &Poller) -> bool {
    let feed = poller.live_feed();
    feed.fetched_at.is_some() && !feed.stale
}

async fn run_pass(
    app: &AppHandle,
    poller: &Arc<Poller>,
    state: &Arc<AppStateInner>,
    backoff: &mut Backoff,
    now: i64,
) {
    let cache = &state.cache;
    let mut events_changed = false;
    let mut summary_changed = false;

    // Футбол ждёт настоящей конфигурации: до неё избранное пустое, и курсор
    // ушёл бы вперёд без проверки.
    if poller.config_ready() {
        let cfg = poller.config();
        match cache.sync_cursor(FOOTBALL) {
            Ok(None) => {
                let _ = cache.set_sync_cursor(FOOTBALL, now, now);
            }
            Ok(Some(cursor)) => match plan_window(Some(cursor), now, GAP_MS) {
                Some(window) if now >= backoff.football_after => {
                    let outcome = football_outcome(state, &cfg, &window).await;
                    let applied = apply_outcome(cache, FOOTBALL, &window, outcome, true, now_ms());
                    events_changed |= applied.inserted > 0;
                    summary_changed |= applied.summary_changed;
                    backoff.football_after = if applied.advanced { 0 } else { now + RETRY_MS };
                }
                Some(_) => {}
                None => {
                    // Поллер сам видит завершения, пока лента свежая.
                    if poller_observing(poller) {
                        let _ = cache.set_sync_cursor(FOOTBALL, now, now);
                    }
                }
            },
            Err(_) => {}
        }
    }

    // Ф1: поллер итоги не записывает, поэтому проход идёт и во время работы.
    match cache.sync_cursor(F1) {
        Ok(None) => {
            let _ = cache.set_sync_cursor(F1, now, now);
        }
        Ok(Some(cursor)) => {
            if let Some(window) = plan_window(Some(cursor), now, F1_INTERVAL_MS) {
                if now >= backoff.f1_after {
                    let lagging = now - cursor >= GAP_MS;
                    let outcome = f1_outcome(state, &window).await;
                    let applied = apply_outcome(cache, F1, &window, outcome, lagging, now_ms());
                    events_changed |= applied.inserted > 0;
                    summary_changed |= applied.summary_changed;
                    backoff.f1_after = if applied.advanced { 0 } else { now + RETRY_MS };
                }
            }
        }
        Err(_) => {}
    }

    if events_changed {
        let _ = app.emit("sportsdesk://events-changed", ());
    }
    if summary_changed {
        let _ = app.emit(CHANGED_EVENT, ());
    }
}

/// Точка входа из lib.rs.
pub fn start(app: AppHandle, poller: Arc<Poller>, state: Arc<AppStateInner>) {
    tauri::async_runtime::spawn(async move {
        sleep(STARTUP_DELAY).await;
        let mut backoff = Backoff::default();
        loop {
            run_pass(&app, &poller, &state, &mut backoff, now_ms()).await;
            sleep(TICK).await;
        }
    });
}

#[tauri::command]
pub fn catchup_summary(state: State<'_, AppState>) -> Result<Option<Summary>, String> {
    let Some(text) = state.inner.cache.catchup_summary()? else {
        return Ok(None);
    };
    Ok(serde_json::from_str(&text).ok())
}

#[tauri::command]
pub fn catchup_dismiss(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.inner.cache.set_catchup_summary(None, now_ms())?;
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::poller::FavoriteTeam;
    use serde_json::json;

    fn ms(s: &str) -> i64 {
        parse_time_ms(s).unwrap()
    }

    fn cfg() -> PollConfig {
        PollConfig {
            favorite_teams: vec![FavoriteTeam {
                id: "t1".into(),
                name: "Arsenal".into(),
                league_id: None,
            }],
            ..Default::default()
        }
    }

    fn pitch(id: &str, home: &str, status: &str, score: Value, time: &str) -> Value {
        json!({
            "id": id,
            "home_team": { "id": home, "name": if home == "t1" { "Arsenal" } else { "Other" } },
            "away_team": { "id": "t9", "name": "Chelsea" },
            "score_home": score.clone(),
            "score_away": score,
            "status": status,
            "time_utc": time,
            "league": { "name": "EPL" }
        })
    }

    fn window() -> Window {
        Window {
            from: ms("2026-11-08T02:00:00Z"),
            to: ms("2026-11-09T06:00:00Z"),
            truncated: false,
        }
    }

    #[test]
    fn catchup_plans_window_first_run_gap_and_truncation() {
        let now = ms("2026-11-09T06:00:00Z");
        assert_eq!(plan_window(None, now, GAP_MS), None);
        assert_eq!(plan_window(Some(now - 5 * MINUTE), now, GAP_MS), None);
        assert_eq!(plan_window(Some(now + HOUR), now, GAP_MS), None);
        let w = plan_window(Some(now - 2 * HOUR), now, GAP_MS).unwrap();
        assert_eq!((w.from, w.to, w.truncated), (now - 2 * HOUR, now, false));
        let w = plan_window(Some(now - 10 * DAY), now, GAP_MS).unwrap();
        assert_eq!((w.from, w.truncated), (now - WINDOW_MS, true));
    }

    #[test]
    fn catchup_days_include_kickoff_lookback() {
        assert_eq!(
            utc_days(&window()),
            vec!["2026-11-07", "2026-11-08", "2026-11-09"]
        );
    }

    #[test]
    fn catchup_selects_only_finished_favourites_inside_window() {
        let mut scan = DayScan::default();
        scan.add_payload(&json!({ "data": { "matches": [
            pitch("m1", "t1", "finished", json!(2), "2026-11-08T15:00:00Z"),
            pitch("m2", "t1", "scheduled", json!(null), "2026-11-09T12:00:00Z"),
            pitch("m3", "t5", "finished", json!(1), "2026-11-08T15:00:00Z"),
            pitch("m4", "t1", "finished", json!(3), "2026-11-01T15:00:00Z"),
            pitch("m6", "t1", "finished", json!(0), "2026-11-08T00:30:00Z"),
        ] } }));
        let out = football_events(&scan, &cfg(), &window());
        let ids: Vec<&str> = out.events.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["football|end|m1", "football|end|m6"]);
        assert!(!out.incomplete);
        assert_eq!(out.events[0].body, "Arsenal 2 : 2 Chelsea");
        assert_eq!(out.events[0].occurred_at, ms("2026-11-08T15:00:00Z"));
    }

    #[test]
    fn catchup_marks_missing_score_ambiguity_and_bad_payload_incomplete() {
        let mut scan = DayScan::default();
        scan.add_payload(&json!({ "matches": [
            pitch("m5", "t1", "finished", json!(null), "2026-11-08T15:00:00Z")
        ] }));
        let out = football_events(&scan, &cfg(), &window());
        assert!(out.incomplete);
        assert!(out.events[0].body.contains("счёт недоступен"));

        let mut scan = DayScan::default();
        scan.add_payload(&json!({ "matches": [
            pitch("m1", "t1", "finished", json!(2), "2026-11-08T15:00:00Z")
        ] }));
        scan.add_payload(&json!({ "matches": [
            pitch("m1", "t1", "finished", json!(1), "2026-11-08T15:00:00Z")
        ] }));
        let out = football_events(&scan, &cfg(), &window());
        assert!(out.incomplete && out.events.is_empty());

        let mut scan = DayScan::default();
        scan.add_payload(&json!({ "oops": true }));
        assert!(football_events(&scan, &cfg(), &window()).incomplete);
    }

    fn end_event(id: &str) -> Event {
        Event {
            id: format!("football|end|{id}"),
            sport: "football".into(),
            kind: "end".into(),
            title: "Матч завершён".into(),
            body: "Arsenal 2 : 1 Chelsea".into(),
            occurred_at: ms("2026-11-08T15:00:00Z"),
            read: false,
            match_id: Some(id.into()),
            league_id: None,
            season: None,
            round: None,
        }
    }

    #[test]
    fn catchup_apply_dedups_and_only_advances_after_full_success() {
        let cache = Cache::open_in_memory();
        let w = window();
        let now = w.to;
        cache.set_sync_cursor(FOOTBALL, w.from, now).unwrap();

        let failed = Outcome {
            events: vec![end_event("m1")],
            incomplete: true,
        };
        let applied = apply_outcome(&cache, FOOTBALL, &w, failed, true, now);
        assert!(!applied.advanced && applied.inserted == 1 && applied.summary_changed);
        assert_eq!(cache.sync_cursor(FOOTBALL).unwrap(), Some(w.from));

        let retry = Outcome {
            events: vec![end_event("m1"), end_event("m2")],
            incomplete: false,
        };
        let applied = apply_outcome(&cache, FOOTBALL, &w, retry, true, now);
        assert_eq!(applied.inserted, 1);
        assert!(applied.advanced);
        assert_eq!(cache.sync_cursor(FOOTBALL).unwrap(), Some(w.to));
        let summary: Summary =
            serde_json::from_str(&cache.catchup_summary().unwrap().unwrap()).unwrap();
        assert_eq!(summary.items.len(), 2);
        assert!(!summary.football_incomplete);
        assert_eq!(cache.list_events(now).unwrap().len(), 2);

        cache.set_catchup_summary(None, now).unwrap();
        assert!(cache.catchup_summary().unwrap().is_none());
    }

    #[test]
    fn catchup_skips_events_the_live_poller_already_recorded() {
        let cache = Cache::open_in_memory();
        let w = window();
        cache.insert_event(&end_event("m1"), w.to).unwrap();
        let outcome = Outcome {
            events: vec![end_event("m1")],
            incomplete: false,
        };
        let applied = apply_outcome(&cache, FOOTBALL, &w, outcome, true, w.to);
        assert_eq!(applied.inserted, 0);
        assert!(!applied.summary_changed);
        assert!(cache.catchup_summary().unwrap().is_none());
    }

    #[test]
    fn catchup_cursor_survives_cache_prune_and_reopen() {
        let dir = std::env::temp_dir().join(format!(
            "sportsdesk-catchup-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        {
            let cache = Cache::open(&dir).unwrap();
            cache.set_sync_cursor(F1, 1_234, 1_234).unwrap();
            cache.prune(i64::MAX);
        }
        {
            let cache = Cache::open(&dir).unwrap();
            assert_eq!(cache.sync_cursor(F1).unwrap(), Some(1_234));
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn schedule() -> Value {
        json!({ "MRData": { "RaceTable": { "Races": [{
            "season": "2026", "round": "21", "raceName": "Гран-при Бразилии",
            "date": "2026-11-08", "time": "17:00:00Z",
            "FirstPractice": { "date": "2026-11-08", "time": "03:00:00Z" },
            "Qualifying": { "date": "2026-11-07", "time": "18:00:00Z" },
            "Sprint": { "date": "2026-11-09", "time": "05:00:00Z" }
        }] } } })
    }

    #[test]
    fn catchup_f1_selects_sessions_that_ended_inside_window() {
        let sessions = finished_sessions(&schedule(), &window());
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].sid, "race");
        assert_eq!(sessions[0].ends_at, ms("2026-11-08T20:00:00Z"));
        assert_eq!(results_path(&sessions[0]), "2026/21/results.json");
    }

    #[test]
    fn catchup_f1_result_needs_real_data() {
        let session = finished_sessions(&schedule(), &window()).remove(0);
        let payload = json!({ "MRData": { "RaceTable": { "Races": [{ "Results": [{
            "Driver": { "givenName": "Max", "familyName": "Verstappen" },
            "Constructor": { "name": "Red Bull" }
        }] }] } } });
        let event = result_event(&session, &payload).unwrap();
        assert_eq!(event.id, "f1|result|2026|21|race");
        assert_eq!(
            event.body,
            "Гран-при Бразилии · победитель: Max Verstappen (Red Bull)"
        );
        assert_eq!(event.round.as_deref(), Some("21"));
        let empty = json!({ "MRData": { "RaceTable": { "Races": [] } } });
        assert!(result_event(&session, &empty).is_none());
    }

    #[test]
    fn catchup_merge_keeps_flags_per_source() {
        let w = window();
        assert!(merge_summary(None, F1, &w, Vec::new(), false).is_none());
        let s = merge_summary(None, F1, &w, Vec::new(), true).unwrap();
        assert!(s.f1_incomplete && !s.football_incomplete);
        let s = merge_summary(Some(s), FOOTBALL, &w, vec![end_event("m1")], false).unwrap();
        let s = merge_summary(Some(s), F1, &w, vec![end_event("m1")], false).unwrap();
        assert_eq!(s.items.len(), 1);
        assert!(!s.f1_incomplete);
    }
}
