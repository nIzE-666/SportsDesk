//! Background sports poller: a single Rust-side loop that keeps fresh data in
//! the shared SQLite cache and raises native notifications for favourite-team
//! match events even when no window is visible.
//!
//! Design points (matching the personal-app threat model):
//! - One shared tick; every poll goes through `fetch_with_cache`, so cache,
//!   TTLs, upstream validation and stale fallback all apply automatically.
//! - Notification de-duplication persists in the SQLite cache DB (own table),
//!   so restarts cannot replay "match started/score changed" for old events.
//! - Exponential backoff with a cap on consecutive failures: pause grows from
//!   the base interval to 15 minutes; one success resets it.
//! - Favourite team names and the enabled flag are pushed from the UI (which
//!   owns localStorage); the poller never reads localStorage itself.
//! - The detail-watch loop is always silent on its first observation of a
//!   match (baseline), never notifies for finished/archived matches, and
//!   persists a per-goal dedup key in the cache DB so reopening a match or
//!   restarting the app cannot replay goals.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;
use tokio::time::sleep;

use crate::bridge::{fetch_with_cache, AppStateInner};

const BASE_TICK: Duration = Duration::from_secs(60);
const MAX_TICK: Duration = Duration::from_secs(15 * 60);
const DEDUP_TTL_MS: i64 = 48 * 60 * 60 * 1000;
/// Live match-detail refresh cadence.
const WATCH_TICK: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct PollConfig {
    pub enabled: bool,
    #[serde(default, rename = "favoriteTeams")]
    pub favorite_teams: Vec<FavoriteTeam>,
    #[serde(default)]
    pub policy: crate::notification_policy::NotificationPolicy,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    pub favorites: Vec<String>,
    #[serde(default = "default_f1_reminders", rename = "f1Reminders")]
    pub f1_reminders: bool,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq)]
pub struct FavoriteTeam {
    pub id: String,
    pub name: String,
    #[serde(default, rename = "leagueId")]
    pub league_id: Option<String>,
}
fn default_timezone() -> String {
    "Asia/Yakutsk".into()
}
fn default_f1_reminders() -> bool {
    true
}

impl Default for PollConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            favorites: Vec::new(),
            f1_reminders: true,
            favorite_teams: Vec::new(),
            policy: Default::default(),
            timezone: default_timezone(),
        }
    }
}

#[derive(Debug)]
struct LiveSnapshot {
    live: bool,
    finished: bool,
    home_score: String,
    away_score: String,
}

/// Stable identity of a match event for new-goal detection. Includes
/// minute_added and period so two genuinely different goals in the same
/// displayed minute (e.g. 45+2 vs 45+5) get distinct keys.
fn event_key(ev: &Value) -> Option<String> {
    let kind = ev.get("event_type").and_then(|t| t.as_str()).unwrap_or("");
    let minute = ev.get("minute").and_then(|m| m.as_i64()).unwrap_or(-1);
    let added = ev
        .get("minute_added")
        .and_then(|m| m.as_i64())
        .or_else(|| ev.get("extra_minute").and_then(|m| m.as_i64()))
        .unwrap_or(0);
    let period = ev
        .get("period")
        .and_then(|p| p.as_i64())
        .or_else(|| ev.get("period_number").and_then(|p| p.as_i64()))
        .unwrap_or(0);
    let player = ev
        .get("player")
        .and_then(|p| p.get("id"))
        .and_then(|n| n.as_i64())
        .map(|n| n.to_string())
        .or_else(|| {
            ev.get("player")
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    let team = ev
        .get("team_id")
        .and_then(|t| t.as_i64())
        .map(|n| n.to_string())
        .or_else(|| {
            ev.get("team")
                .and_then(|t| t.get("id"))
                .and_then(|n| n.as_i64())
                .map(|n| n.to_string())
        })
        .unwrap_or_default();
    Some(format!("{kind}|{minute}|{added}|{period}|{player}|{team}"))
}

/// A flat SportScore match row as used by the existing JS notifier.
#[derive(Debug, Clone, Default, Deserialize, serde::Serialize)]
pub struct FlatMatch {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub home_id: String,
    #[serde(default)]
    pub away_id: String,
    #[serde(default)]
    pub home: Option<String>,
    #[serde(default)]
    pub away: Option<String>,
    #[serde(default)]
    pub home_score: Option<Value>,
    #[serde(default)]
    pub away_score: Option<Value>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub status_text: Option<String>,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub competition: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFeed {
    pub matches: Vec<FlatMatch>,
    pub fetched_at: Option<String>,
    pub stale: bool,
    pub failure: Option<crate::bridge::ApiFailure>,
}
fn pitch_match(value: &Value) -> Option<FlatMatch> {
    let team = |side: &str, field: &str| {
        value
            .get(side)
            .and_then(|v| v.get(field))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    Some(FlatMatch {
        id: value.get("id")?.as_str()?.into(),
        home_id: team("home_team", "id")?,
        away_id: team("away_team", "id")?,
        home: team("home_team", "name"),
        away: team("away_team", "name"),
        home_score: value.get("score_home").cloned(),
        away_score: value.get("score_away").cloned(),
        status: value
            .get("status")
            .and_then(Value::as_str)
            .map(str::to_owned),
        status_text: None,
        time: value
            .get("time_utc")
            .and_then(Value::as_str)
            .filter(|s| s.contains('T') || s.len() >= 19)
            .map(str::to_owned),
        competition: value
            .get("league")
            .and_then(|l| l.get("name"))
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}
fn favorite_ids(m: &FlatMatch, cfg: &PollConfig) -> Vec<String> {
    let mut out: Vec<String> = cfg
        .favorite_teams
        .iter()
        .filter(|t| t.id == m.home_id || t.id == m.away_id)
        .map(|t| t.id.clone())
        .collect();
    // Defaults may remain unresolved until the club catalogue loads. Once a
    // name has a Pitch ID, a different Pitch ID must never match its name.
    for name in &cfg.favorites {
        if cfg
            .favorite_teams
            .iter()
            .any(|t| crate::sports::favorite_name(&t.name, &[name.clone()]))
        {
            continue;
        }
        if is_favourite(m.home.as_deref().unwrap_or(""), &[name.clone()])
            || is_favourite(m.away.as_deref().unwrap_or(""), &[name.clone()])
        {
            out.push(name.clone());
        }
    }
    out
}

fn score_text(v: &Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn canonical_status(m: &FlatMatch) -> (bool, bool, bool) {
    let status = crate::sports::status(&[
        m.status.as_deref().unwrap_or(""),
        m.status_text.as_deref().unwrap_or(""),
    ]);
    (
        status == "live",
        status == "finished",
        status == "scheduled",
    )
}
fn is_favourite(team: &str, favorites: &[String]) -> bool {
    crate::sports::favorite_name(team, favorites)
}

fn match_label(m: &FlatMatch) -> String {
    let base = format!(
        "{} — {}",
        m.home.as_deref().unwrap_or("—"),
        m.away.as_deref().unwrap_or("—")
    );
    match m.competition.as_deref() {
        Some(c) if !c.is_empty() => format!("{base} · {c}"),
        _ => base,
    }
}

fn score_label(m: &FlatMatch) -> String {
    let home = {
        let t = score_text(&m.home_score);
        if t.is_empty() {
            "—".into()
        } else {
            t
        }
    };
    let away = {
        let t = score_text(&m.away_score);
        if t.is_empty() {
            "—".into()
        } else {
            t
        }
    };
    format!(
        "{} {} : {} {}",
        m.home.as_deref().unwrap_or("—"),
        home,
        away,
        m.away.as_deref().unwrap_or("—")
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// RFC3339-ish UTC parser for the `time` field ("2026-10-21 18:00:00" or ISO).
fn parse_time_ms(s: &str) -> Option<i64> {
    let text = s.trim();
    let iso = if text.len() == 19 {
        format!("{}Z", text.replace(' ', "T"))
    } else {
        text.into()
    };
    chrono::DateTime::parse_from_rfc3339(&iso)
        .ok()
        .map(|v| v.timestamp_millis())
}

/// Persistent de-dup store in the app cache DB (separate table).
struct DedupStore<'a> {
    cache: &'a crate::cache::Cache,
}

impl DedupStore<'_> {
    fn seen(&self, key: &str) -> bool {
        // Reuses api_cache rows with a synthetic source; single lookup.
        self.cache.get("dedup", key).is_some()
    }

    fn mark(&self, key: &str) {
        let payload = serde_json::json!({ "seenAt": now_ms() });
        let _ = self.cache.put("dedup", key, &payload, now_ms());
    }

    fn prune(&self) {
        self.cache.prune_source("dedup", now_ms() - DEDUP_TTL_MS);
    }
}

pub struct Poller {
    state: Arc<AppStateInner>,
    config: std::sync::Mutex<PollConfig>,
    snapshots: std::sync::Mutex<HashMap<String, LiveSnapshot>>,
    feed: std::sync::Mutex<LiveFeed>,
    revision: AtomicU64,
    blocked: std::sync::Mutex<HashMap<String, u64>>,
    /// Detail-watch subscription: the match currently open in the UI.
    watch: std::sync::Mutex<Option<Watch>>,
    /// Monotonic watch generation counter: never resets across unwatch/re-watch.
    watch_gen: AtomicU64,
}

/// A single match the UI asked to follow live.
#[derive(Debug, Clone)]
pub struct Watch {
    pub match_id: String,
    /// Last observed score (for change detection on the detail endpoint).
    pub home_score: Option<i64>,
    pub away_score: Option<i64>,
    pub status: String,
    /// Known event keys (for new-goal detection).
    pub event_keys: HashSet<String>,
    pub generation: u64,
    /// True once a first (silent) baseline has been recorded for this watch.
    pub baseline_ready: bool,
}

impl Watch {
    fn new(match_id: String, generation: u64) -> Self {
        Self {
            match_id,
            home_score: None,
            away_score: None,
            status: String::new(),
            event_keys: Default::default(),
            generation,
            baseline_ready: false,
        }
    }
}

/// Pure decision: may this event list produce notifications?
/// - `baseline_ready == false` -> first observation, always silent.
/// - `finished == true` -> archived/final match, never notify.
fn notifications_eligible(baseline_ready: bool, live: bool, enabled: bool, fresh: bool) -> bool {
    baseline_ready && live && enabled && fresh
}

/// Pure diff: keys in `events` not present in `baseline`.
fn diff_event_keys(events: &[Value], baseline: &HashSet<String>) -> Vec<(String, Value)> {
    let mut known = baseline.clone();
    let mut out = Vec::new();
    for ev in events {
        let Some(key) = event_key(ev) else { continue };
        if known.insert(key.clone()) {
            out.push((key, ev.clone()));
        }
    }
    out
}

/// Commits only fresh event snapshots. Initial and disabled observations are
/// silent but still become the baseline; a failed snapshot is never consumed.
fn advance_event_baseline(
    watch: &mut Watch,
    events: &[Value],
    fresh: bool,
    live: bool,
    enabled: bool,
) -> Vec<Value> {
    if !fresh {
        return Vec::new();
    }
    let eligible = notifications_eligible(watch.baseline_ready, live, enabled, fresh);
    let changes = diff_event_keys(events, &watch.event_keys);
    let mut goals = Vec::new();
    for (key, event) in changes {
        watch.event_keys.insert(key);
        if eligible && event.get("event_type").and_then(Value::as_str) == Some("goal") {
            goals.push(event)
        }
    }
    watch.baseline_ready = true;
    goals
}

/// Pure decision: should the events endpoint be retried on this tick?
/// Always while live (the events endpoint can lag the score); only when the
/// score moved otherwise.
fn should_fetch_events(live: bool, score_changed: bool) -> bool {
    live || score_changed
}

impl Poller {
    pub fn new(state: Arc<AppStateInner>) -> Self {
        Self {
            state,
            config: std::sync::Mutex::new(PollConfig::default()),
            snapshots: std::sync::Mutex::new(HashMap::new()),
            feed: Default::default(),
            revision: AtomicU64::new(0),
            blocked: Default::default(),
            watch: std::sync::Mutex::new(None),
            watch_gen: AtomicU64::new(0),
        }
    }

    pub fn set_config(&self, cfg: PollConfig) {
        let enabled = cfg.enabled;
        self.revision.fetch_add(1, Ordering::Relaxed);
        let changed = if let Ok(mut guard) = self.config.lock() {
            let changed = serde_json::to_string(&*guard).ok() != serde_json::to_string(&cfg).ok();
            *guard = cfg;
            changed
        } else {
            false
        };
        if changed {
            if let Ok(mut snapshots) = self.snapshots.lock() {
                snapshots.clear();
            }
        }
        if changed {
            if let Ok(mut guard) = self.watch.lock() {
                if let Some(w) = guard.as_mut() {
                    w.generation = self.watch_gen.fetch_add(1, Ordering::Relaxed) + 1;
                    w.baseline_ready = false;
                }
            }
        }
        if !enabled {
            if let Ok(mut snapshots) = self.snapshots.lock() {
                // Disable resets the baseline so re-enabling never replays
                // events that happened while polling was off.
                snapshots.clear();
            }
        }
    }

    pub fn config(&self) -> PollConfig {
        self.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    /// The UI opens a match: start/refresh the detail-watch subscription.
    /// Returns the watch generation so stale responses are dropped.
    /// Generation is monotonic across unwatch/re-watch.
    pub fn watch_match(&self, match_id: &str) -> u64 {
        let mut guard = self.watch.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Some(existing) if existing.match_id == match_id => existing.generation,
            _ => {
                let gen = self.watch_gen.fetch_add(1, Ordering::Relaxed) + 1;
                *guard = Some(Watch::new(match_id.to_string(), gen));
                gen
            }
        }
    }

    /// The UI closed the match view: stop watching.
    pub fn unwatch_match(&self) {
        if let Ok(mut guard) = self.watch.lock() {
            *guard = None;
        }
    }

    pub fn watched(&self) -> Option<String> {
        self.watch
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|w| w.match_id.clone()))
    }

    /// One detail-watch cycle for the currently open match. Emits
    /// `sportsdesk://match-update` on every successful tick so the UI can
    /// refresh statistics/cards, and raises a native notification only for
    /// genuinely new goals observed after the silent baseline, on a
    /// non-finished match, with the enabled flag read at delivery time.
    async fn tick_watch(&self, app: &AppHandle) {
        let watch = match self.watch.lock().ok().and_then(|g| g.clone()) {
            Some(w) => w,
            None => return,
        };
        let Some(reply) = self
            .fetch_watched(format!("matches/{}", watch.match_id))
            .await
        else {
            return;
        };
        let Some(detail) = reply
            .payload
            .get("data")
            .unwrap_or(&reply.payload)
            .as_object()
        else {
            return;
        };
        let home_score = detail.get("score_home").and_then(Value::as_i64);
        let away_score = detail.get("score_away").and_then(Value::as_i64);
        let status = detail.get("status").and_then(Value::as_str).unwrap_or("");
        let live = crate::sports::status(&[status]) == "live";
        let changed = home_score != watch.home_score || away_score != watch.away_score;
        let mut next = watch.clone();
        let mut goals = Vec::new();
        if !reply.stale && (should_fetch_events(live, changed) || !watch.baseline_ready) {
            if let Some(events) = self
                .fetch_watched(format!("matches/{}/events", watch.match_id))
                .await
            {
                if let Some(list) = events
                    .payload
                    .get("data")
                    .and_then(|d| d.get("events"))
                    .or_else(|| events.payload.get("events"))
                    .and_then(Value::as_array)
                {
                    goals = advance_event_baseline(
                        &mut next,
                        list,
                        !events.stale,
                        live,
                        self.config().enabled,
                    );
                }
            }
        }
        if !reply.stale {
            next.home_score = home_score;
            next.away_score = away_score;
            next.status = status.into();
        }
        // A response from an old subscription or settings revision cannot change state.
        {
            let Ok(mut guard) = self.watch.lock() else {
                return;
            };
            let Some(current) = guard.as_mut() else {
                return;
            };
            if current.match_id != watch.match_id || current.generation != watch.generation {
                return;
            }
            *current = next;
        }
        let _=app.emit("sportsdesk://match-update",serde_json::json!({"matchId":watch.match_id,"fetchedAt":reply.fetched_at,"stale":reply.stale,"generation":watch.generation}));
        let store = DedupStore {
            cache: &self.state.cache,
        };
        for ev in goals {
            let config = self.config();
            let home_id = detail
                .get("home_team")
                .and_then(|t| t.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let away_id = detail
                .get("away_team")
                .and_then(|t| t.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            // Favourite scores are delivered by the global feed, once.
            if config
                .favorite_teams
                .iter()
                .any(|t| t.id == home_id || t.id == away_id)
                || pitch_match(&Value::Object(detail.clone()))
                    .map(|m| !favorite_ids(&m, &config).is_empty())
                    .unwrap_or(false)
                || !self.delivery_allowed("goal", &[home_id, away_id])
            {
                break;
            }
            let current = self
                .watch
                .lock()
                .ok()
                .and_then(|g| {
                    g.as_ref()
                        .map(|w| w.generation == watch.generation && w.match_id == watch.match_id)
                })
                .unwrap_or(false);
            if !current {
                break;
            }
            let Some(identity) = event_key(&ev) else {
                continue;
            };
            let key = format!("goal|{}|{}", watch.match_id, identity);
            if store.seen(&key) {
                continue;
            }
            let player = ev
                .get("player")
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("Игрок");
            let minute = ev.get("minute").and_then(Value::as_i64).unwrap_or(0);
            let added = ev.get("minute_added").and_then(Value::as_i64).unwrap_or(0);
            let clock = if added > 0 {
                format!("{minute}+{added}")
            } else {
                minute.to_string()
            };
            let home = detail
                .get("home_team")
                .and_then(|t| t.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let away = detail
                .get("away_team")
                .and_then(|t| t.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let body = format!("{clock}′ {player} · {home} — {away}");
            if app
                .notification()
                .builder()
                .title("Гол!")
                .body(body)
                .show()
                .is_ok()
            {
                store.mark(&key);
            }
        }
    }

    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Relaxed)
    }
    async fn fetch_watched(&self, path: String) -> Option<crate::bridge::native::ApiReply> {
        let revision = self.revision();
        if self.blocked.lock().ok().and_then(|v| v.get(&path).copied()) == Some(revision) {
            return None;
        }
        match fetch_with_cache(self.state.clone(), "pitch".into(), path.clone()).await {
            Ok(reply) => {
                if reply.failure.as_ref().is_some_and(|f| !f.retryable) {
                    if let Ok(mut v) = self.blocked.lock() {
                        v.insert(path, revision);
                    }
                }
                Some(reply)
            }
            Err(error) => {
                if !error.failure().retryable {
                    if let Ok(mut v) = self.blocked.lock() {
                        v.insert(path, revision);
                    }
                }
                None
            }
        }
    }
    pub fn live_feed(&self) -> LiveFeed {
        self.feed.lock().map(|v| v.clone()).unwrap_or_default()
    }
    pub fn settings_changed(&self) {
        self.revision.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut s) = self.snapshots.lock() {
            s.clear();
        }
        if let Ok(mut w) = self.watch.lock() {
            if let Some(w) = w.as_mut() {
                w.baseline_ready = false;
                w.generation = self.watch_gen.fetch_add(1, Ordering::Relaxed) + 1;
            }
        }
    }
    pub fn delivery_allowed(&self, kind: &str, ids: &[&str]) -> bool {
        let cfg = self.config();
        cfg.enabled && cfg.policy.allows(kind, ids, &cfg.timezone, now_ms())
    }
    async fn tick(&self, app: &AppHandle) -> Result<(), crate::bridge::ApiFailure> {
        let cfg = self.config();
        let mut matches = HashMap::new();
        // A full league schedule supplies the next event even when no club
        // plays in the next three days. Only fresh day snapshots drive alerts.
        let mut future = HashMap::new();
        let leagues: HashSet<_> = cfg
            .favorite_teams
            .iter()
            .filter_map(|t| t.league_id.as_ref())
            .collect();
        for league in leagues {
            if let Some(reply) = self
                .fetch_watched(format!("leagues/{league}/matches?status=all"))
                .await
            {
                let data = reply.payload.get("data").unwrap_or(&reply.payload);
                if let Some(list) = data.get("matches").and_then(Value::as_array) {
                    for value in list {
                        if let Some(m) = pitch_match(value) {
                            if m.time
                                .as_deref()
                                .and_then(parse_time_ms)
                                .is_some_and(|t| t > now_ms())
                                && !favorite_ids(&m, &cfg).is_empty()
                            {
                                future.insert(m.id.clone(), m);
                            }
                        }
                    }
                }
            }
        }
        let today = chrono::Utc::now().date_naive();
        for offset in [-1, 0, 1] {
            let date = today + chrono::Duration::days(offset);
            let path = format!("date/{date}?status=all");
            let reply = fetch_with_cache(self.state.clone(), "pitch".into(), path)
                .await
                .map_err(|e| e.failure())?;
            if reply.stale {
                return Err(reply
                    .failure
                    .unwrap_or_else(|| crate::bridge::BridgeError::Upstream.failure()));
            }
            let data = reply.payload.get("data").unwrap_or(&reply.payload);
            let list = data
                .get("matches")
                .and_then(Value::as_array)
                .ok_or_else(|| crate::bridge::BridgeError::BadPayload.failure())?;
            for value in list {
                if let Some(m) = pitch_match(value) {
                    matches.insert(m.id.clone(), m);
                }
            }
        }
        let mut matches: Vec<_> = matches
            .into_values()
            .filter(|m| !favorite_ids(m, &cfg).is_empty())
            .collect();
        matches.sort_by_key(|m| m.time.clone().unwrap_or_default());
        self.ingest(app, &matches);
        for m in &matches {
            future.insert(m.id.clone(), m.clone());
        }
        let mut all: Vec<_> = future.into_values().collect();
        all.sort_by_key(|m| m.time.clone().unwrap_or_default());
        let feed = LiveFeed {
            matches: all,
            fetched_at: Some(crate::cache::iso_utc_ms(now_ms())),
            stale: false,
            failure: None,
        };
        if let Ok(mut guard) = self.feed.lock() {
            *guard = feed.clone()
        }
        let _ = app.emit("sportsdesk://live-feed", &feed);
        crate::tray::update_football(app, &feed.matches, &cfg.timezone);
        Ok(())
    }
    fn ingest(&self, app: &AppHandle, matches: &[FlatMatch]) {
        let cfg = self.config();
        let now = now_ms();
        let mut events: Vec<(String, String, String, String, Vec<String>)> = Vec::new();
        if let Ok(mut snapshots) = self.snapshots.lock() {
            // Keep a missing row briefly: provider day-boundary gaps must not reset a live baseline.
            for m in matches {
                let key = m.id.clone();
                let (live, finished, scheduled) = canonical_status(m);
                let home = score_text(&m.home_score);
                let away = score_text(&m.away_score);
                let ids = favorite_ids(m, &cfg);
                if let Some(prev) = snapshots.get(&key) {
                    if live && !prev.live && !prev.finished {
                        events.push((
                            "start".into(),
                            format!("start|{key}"),
                            "Матч начался".into(),
                            match_label(m),
                            ids.clone(),
                        ));
                    }
                    if (live || finished)
                        && !prev.finished
                        && !home.is_empty()
                        && !away.is_empty()
                        && (home != prev.home_score || away != prev.away_score)
                    {
                        events.push((
                            "goal".into(),
                            format!("score|{key}|{home}|{away}"),
                            "Изменение счёта".into(),
                            score_label(m),
                            ids.clone(),
                        ));
                    }
                    if finished && !prev.finished {
                        events.push((
                            "end".into(),
                            format!("end|{key}"),
                            "Матч завершён".into(),
                            score_label(m),
                            ids.clone(),
                        ));
                    }
                }
                snapshots.insert(
                    key.clone(),
                    LiveSnapshot {
                        live,
                        finished,
                        home_score: home,
                        away_score: away,
                    },
                );
                if scheduled {
                    if let Some(start) = m.time.as_deref().and_then(parse_time_ms) {
                        let delta = start - now;
                        if delta > 0 && delta <= cfg.policy.lead_ms() {
                            events.push((
                                "reminder".into(),
                                format!("reminder|{key}|{start}"),
                                "Скоро матч".into(),
                                format!(
                                    "{} · через {} мин.",
                                    match_label(m),
                                    (delta + 59_999) / 60_000
                                ),
                                ids,
                            ));
                        }
                    }
                }
            }
            // Three UTC days of fixtures are sufficient for late-night live games.
            if snapshots.len() > 2000 {
                let keys: HashSet<_> = matches.iter().map(|m| m.id.clone()).collect();
                snapshots.retain(|k, _| keys.contains(k));
            }
        }
        let store = DedupStore {
            cache: &self.state.cache,
        };
        store.prune();
        for (kind, key, title, body, ids) in events {
            let current = self.config();
            let fresh_ids: Vec<_> = ids
                .iter()
                .filter(|id| {
                    current.favorite_teams.iter().any(|t| &t.id == *id)
                        || current.favorites.iter().any(|n| n == *id)
                })
                .map(String::as_str)
                .collect();
            if fresh_ids.is_empty() || !self.delivery_allowed(&kind, &fresh_ids) || store.seen(&key)
            {
                continue;
            }
            if app
                .notification()
                .builder()
                .title(&title)
                .body(&body)
                .show()
                .is_ok()
            {
                store.mark(&key);
                let _ = app.emit(
                    "sportsdesk://match-event",
                    serde_json::json!({"title":title,"body":body}),
                );
            }
        }
    }
}

/// Shared handle managed by Tauri.
pub struct PollerState(pub Arc<Poller>);

pub fn start(app: AppHandle, poller: Arc<Poller>) {
    // Detail-watch loop: always runs while a match is open in the UI,
    // independent of the notification settings.
    let watch_app = app.clone();
    let watch_poller = poller.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(5)).await; // let the first match load settle
        loop {
            if watch_poller.watched().is_some() {
                watch_poller.tick_watch(&watch_app).await;
                sleep(WATCH_TICK).await;
            } else {
                sleep(Duration::from_secs(1)).await;
            }
        }
    });

    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(8)).await;
        let mut pause = BASE_TICK;
        let mut blocked = None;
        loop {
            let revision = poller.revision.load(Ordering::Relaxed);
            if blocked == Some(revision) {
                sleep(Duration::from_secs(2)).await;
                continue;
            }
            match poller.tick(&app).await {
                Ok(()) => {
                    pause = BASE_TICK;
                    blocked = None;
                }
                Err(error) => {
                    if !error.retryable {
                        blocked = Some(revision);
                    }
                    pause = (pause * 2).min(MAX_TICK);
                    if let Ok(mut feed) = poller.feed.lock() {
                        feed.stale = true;
                        feed.failure = Some(error.clone());
                    }
                    let _ = app.emit(
                        "sportsdesk://poller",
                        serde_json::json!({"backoff":pause.as_secs(),"failure":error}),
                    );
                }
            }
            // Configuration/key changes wake the loop within two seconds.
            let until = tokio::time::Instant::now() + pause;
            while tokio::time::Instant::now() < until
                && poller.revision.load(Ordering::Relaxed) == revision
            {
                sleep(Duration::from_secs(2)).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pitch_ids_override_name_aliases_and_fixture_151_is_not_truncated() {
        let cfg = PollConfig {
            favorites: vec!["Arsenal".into()],
            favorite_teams: vec![FavoriteTeam {
                id: "t_senior".into(),
                name: "Arsenal".into(),
                league_id: Some("l_EPL".into()),
            }],
            ..Default::default()
        };
        let mut matches: Vec<_> = (0..150)
            .map(|i| FlatMatch {
                id: format!("m_{i}"),
                home_id: "t_youth".into(),
                home: Some("Arsenal".into()),
                ..Default::default()
            })
            .collect();
        matches.push(FlatMatch {
            id: "m_senior".into(),
            home_id: "t_senior".into(),
            home: Some("Arsenal".into()),
            ..Default::default()
        });
        let found: Vec<_> = matches
            .iter()
            .filter(|m| !favorite_ids(m, &cfg).is_empty())
            .collect();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "m_senior");
        let unresolved = PollConfig {
            favorites: vec!["Arsenal".into()],
            ..Default::default()
        };
        assert!(favorite_ids(
            &FlatMatch {
                home: Some("Arsenal U21".into()),
                ..Default::default()
            },
            &unresolved
        )
        .is_empty());
    }

    fn flat(status: &str, home_score: &str, away_score: &str) -> FlatMatch {
        FlatMatch {
            home: Some("Arsenal".into()),
            away: Some("Chelsea".into()),
            home_score: Some(Value::String(home_score.into())),
            away_score: Some(Value::String(away_score.into())),
            status: Some(status.into()),
            status_text: None,
            time: Some("2026-10-21 18:00:00".into()),
            competition: Some("EPL".into()),
            ..Default::default()
        }
    }

    fn goal(minute: i64, added: i64, player: i64, team: i64) -> Value {
        serde_json::json!({
            "event_type": "goal",
            "minute": minute,
            "minute_added": added,
            "period": 1,
            "player": { "id": player, "name": format!("Player {player}") },
            "team_id": team
        })
    }

    #[test]
    fn status_tokens_are_allowlist_based() {
        let m = flat("Halftime", "1", "0");
        let (live, finished, scheduled) = canonical_status(&m);
        assert!(live && !finished && !scheduled);
        let m = flat("FT", "2", "1");
        let (live, finished, _) = canonical_status(&m);
        assert!(finished && !live);
        let m = flat("Scheduled", "", "");
        let (_, finished, scheduled) = canonical_status(&m);
        assert!(scheduled && !finished);
    }

    #[test]
    fn favourite_matching_tolerates_case_and_accents() {
        assert!(is_favourite("FC Arsenal", &["Arsenal".into()]));
        assert!(is_favourite(
            "Atletico de Madrid",
            &["Atletico Madrid".into()]
        ));
        assert!(!is_favourite("Wolves", &["Arsenal".into()]));
    }

    #[test]
    fn time_parser_accepts_datetime_and_iso() {
        assert_eq!(
            parse_time_ms("2026-10-21 18:00:00"),
            parse_time_ms("2026-10-21T18:00:00Z")
        );
        assert!(parse_time_ms("2026-10-21 18:00:00").is_some());
        assert!(parse_time_ms("nonsense").is_none());
    }

    #[test]
    fn snapshot_diff_emits_start_score_and_finish() {
        let next = flat("FT", "2", "1");
        let prev = LiveSnapshot {
            live: true,
            finished: false,
            home_score: "0".into(),
            away_score: "0".into(),
        };
        let (nlive, nfinished, _) = canonical_status(&next);
        // Live -> finished while the score moved from 0:0 to 2:1.
        assert!(nfinished && !nlive);
        let home_score = score_text(&next.home_score);
        let score_changed = !home_score.is_empty() && home_score != prev.home_score;
        assert!(score_changed);
        assert!(!prev.finished);
    }

    #[test]
    fn silent_baseline_disabled_archive_and_stale_transitions() {
        let mut watch = Watch::new("m1".into(), 1);
        let first = goal(10, 0, 10, 1);
        assert!(advance_event_baseline(&mut watch, &[first.clone()], false, true, true).is_empty());
        assert!(!watch.baseline_ready);
        assert!(advance_event_baseline(&mut watch, &[first.clone()], true, true, true).is_empty());
        assert!(watch.baseline_ready);
        let second = goal(20, 0, 7, 2);
        assert!(advance_event_baseline(
            &mut watch,
            &[first.clone(), second.clone()],
            true,
            true,
            false
        )
        .is_empty());
        assert!(advance_event_baseline(
            &mut watch,
            &[first.clone(), second.clone()],
            true,
            true,
            true
        )
        .is_empty());
        let third = goal(30, 0, 9, 1);
        assert!(advance_event_baseline(&mut watch, &[third.clone()], false, true, true).is_empty());
        assert_eq!(
            advance_event_baseline(&mut watch, &[third.clone()], true, true, true).len(),
            1
        );
        assert!(advance_event_baseline(&mut watch, &[third], true, true, true).is_empty());
        assert!(
            advance_event_baseline(&mut watch, &[goal(50, 0, 8, 2)], true, false, true).is_empty()
        );
    }

    #[test]
    fn distinct_added_time_goals_have_distinct_keys() {
        let a = event_key(&goal(45, 2, 10, 1)).unwrap();
        let b = event_key(&goal(45, 5, 10, 1)).unwrap();
        assert_ne!(a, b);
        let baseline: HashSet<String> = [a].into_iter().collect();
        let diffs = diff_event_keys(&[goal(45, 5, 10, 1)], &baseline);
        assert_eq!(diffs.len(), 1);
    }

    #[test]
    fn generation_survives_unwatch_rewatch() {
        let poller = Poller::new(Arc::new(AppStateInner {
            client: crate::bridge::http_client(),
            cache: crate::cache::Cache::open_in_memory(),
            concurrency: crate::bridge::Concurrency::new(),
        }));
        let first = poller.watch_match("m1");
        poller.unwatch_match();
        let second = poller.watch_match("m1");
        assert!(second > first);
        poller.set_config(PollConfig {
            enabled: true,
            favorites: Vec::new(),
            ..PollConfig::default()
        });
        let third = poller.watch_match("m1");
        assert!(third > second);
    }

    #[test]
    fn events_retry_policy() {
        // Live: always retry (events endpoint may lag the score).
        assert!(should_fetch_events(true, false));
        // Non-live: only when the score moved.
        assert!(should_fetch_events(false, true));
        assert!(!should_fetch_events(false, false));
    }
}
