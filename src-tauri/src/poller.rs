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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
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

/// Every failure gets another bounded attempt, including errors classified as
/// non-retryable for interactive requests. Settings changes can wake sooner.
pub(crate) fn retry_delay(
    current: Duration,
    base: Duration,
    maximum: Duration,
    failure: Option<&crate::bridge::ApiFailure>,
) -> Duration {
    if failure.is_some() {
        (current * 2).min(maximum)
    } else {
        base
    }
}

fn path_is_blocked(entry: Option<(u64, Instant)>, revision: u64, now: Instant) -> bool {
    entry.is_some_and(|(blocked_revision, retry_at)| blocked_revision == revision && now < retry_at)
}

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
    /// Match ids marked "no spoilers" in the UI: no score-revealing alerts or
    /// Event Center entries are produced for them until the user reveals them.
    #[serde(default, rename = "hiddenResults")]
    pub hidden_results: Vec<String>,
    /// F1 session reminders styled as SportsDesk "team radio" (off by default).
    #[serde(default, rename = "f1Radio")]
    pub f1_radio: bool,
    #[serde(default, rename = "f1RadioName")]
    pub f1_radio_name: String,
}

impl PollConfig {
    pub fn result_hidden(&self, match_id: &str) -> bool {
        !match_id.is_empty() && self.hidden_results.iter().any(|id| id == match_id)
    }
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
            hidden_results: Vec::new(),
            f1_radio: false,
            f1_radio_name: String::new(),
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
    let kind = ev
        .get("event_type")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?;
    let minute = ev
        .get("minute")
        .and_then(Value::as_i64)
        .filter(|n| *n >= 0)?;
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
        .and_then(|n| {
            n.as_str()
                .map(str::to_owned)
                .or_else(|| n.as_i64().map(|v| v.to_string()))
        })
        .or_else(|| {
            ev.get("player")
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    let team = ev
        .get("team_id")
        .and_then(|t| {
            t.as_str()
                .map(str::to_owned)
                .or_else(|| t.as_i64().map(|v| v.to_string()))
        })
        .or_else(|| {
            ev.get("team").and_then(|t| t.get("id")).and_then(|n| {
                n.as_str()
                    .map(str::to_owned)
                    .or_else(|| n.as_i64().map(|v| v.to_string()))
            })
        })
        .unwrap_or_default();
    if player.is_empty() && team.is_empty() {
        return None;
    }
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
pub(crate) fn pitch_match(value: &Value) -> Option<FlatMatch> {
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
pub(crate) fn favorite_ids(m: &FlatMatch, cfg: &PollConfig) -> Vec<String> {
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
            .any(|t| crate::sports::favorite_name(&t.name, std::slice::from_ref(name)))
        {
            continue;
        }
        if is_favourite(m.home.as_deref().unwrap_or(""), std::slice::from_ref(name))
            || is_favourite(m.away.as_deref().unwrap_or(""), std::slice::from_ref(name))
        {
            out.push(name.clone());
        }
    }
    out
}

pub(crate) fn score_text(v: &Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s
            .trim()
            .parse::<u64>()
            .map(|n| n.to_string())
            .unwrap_or_default(),
        Some(Value::Number(n)) => n.as_u64().map(|n| n.to_string()).unwrap_or_default(),
        _ => String::new(),
    }
}

pub(crate) fn canonical_status(m: &FlatMatch) -> (bool, bool, bool) {
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

pub(crate) fn match_label(m: &FlatMatch) -> String {
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

pub(crate) fn score_label(m: &FlatMatch) -> String {
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
pub(crate) fn parse_time_ms(s: &str) -> Option<i64> {
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

    fn mark(&self, key: &str) -> Result<(), String> {
        let payload = serde_json::json!({ "seenAt": now_ms() });
        self.cache.put("dedup", key, &payload, now_ms())
    }

    fn score_receipt(&self, key: &str) -> Option<ScoreReceipt> {
        let row = self.cache.get("dedup", key)?;
        Some(
            row.payload
                .get("scoreReceipt")
                .and_then(|value| serde_json::from_value(value.clone()).ok())
                .unwrap_or(ScoreReceipt::Score),
        )
    }

    fn mark_score(&self, key: &str, receipt: &ScoreReceipt) -> Result<(), String> {
        let payload = serde_json::json!({ "seenAt": now_ms(), "scoreReceipt": receipt });
        self.cache.put("dedup", key, &payload, now_ms())
    }

    fn prune(&self) {
        self.cache.prune_source("dedup", now_ms() - DEDUP_TTL_MS);
    }
}

const PENDING_SOURCE: &str = "football-pending";
const PENDING_PATH: &str = "notifications";

#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq, Eq)]
enum ScoreReceipt {
    Score,
    Named { batch: Option<String> },
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
struct ScoreState {
    home: i64,
    away: i64,
    epoch: u64,
    fetched_at: i64,
}

#[derive(Default)]
struct ScoreTracker {
    matches: HashMap<String, ScoreState>,
}

impl ScoreTracker {
    /// Ignore older endpoint snapshots. A confirmed decrease starts a new
    /// attainment epoch, shared by detail and global polling across restarts.
    fn observe(
        &mut self,
        cache: &crate::cache::Cache,
        id: &str,
        home: i64,
        away: i64,
        fetched_at: i64,
    ) -> Option<(u64, bool)> {
        if home < 0 || away < 0 {
            return None;
        }
        if !self.matches.contains_key(id) {
            if let Some(state) = cache
                .get("football-score-state", id)
                .and_then(|row| serde_json::from_value::<ScoreState>(row.payload).ok())
            {
                self.matches.insert(id.to_string(), state);
            }
        }
        let previous = self.matches.get(id);
        if previous.is_some_and(|v| {
            fetched_at < v.fetched_at
                || (fetched_at == v.fetched_at && (home != v.home || away != v.away))
        }) {
            return None;
        }
        let corrected = previous.is_some_and(|v| home < v.home || away < v.away);
        let epoch = previous
            .map(|v| v.epoch)
            .unwrap_or(0)
            .saturating_add(u64::from(corrected));
        let state = ScoreState {
            home,
            away,
            epoch,
            fetched_at,
        };
        if let Ok(payload) = serde_json::to_value(&state) {
            let _ = cache.put("football-score-state", id, &payload, now_ms());
        }
        self.matches.insert(id.to_string(), state);
        Some((epoch, corrected))
    }
}

fn score_key(match_id: &str, home: i64, away: i64, epoch: u64) -> String {
    if epoch == 0 {
        format!("score|{match_id}|{home}|{away}")
    } else {
        format!("score|{match_id}|{home}|{away}|e{epoch}")
    }
}

fn parse_score_key(key: &str, match_id: &str) -> Option<(i64, i64, u64)> {
    let prefix = format!("score|{match_id}|");
    let mut parts = key.strip_prefix(&prefix)?.split('|');
    let home = parts.next()?.parse().ok()?;
    let away = parts.next()?.parse().ok()?;
    let epoch = match parts.next() {
        None => 0,
        Some(value) => value.strip_prefix('e')?.parse().ok()?,
    };
    if parts.next().is_some() {
        return None;
    }
    Some((home, away, epoch))
}

fn goal_batch(keys: &HashSet<String>) -> String {
    let mut keys: Vec<_> = keys.iter().filter(|key| key.starts_with("goal|")).collect();
    keys.sort();
    let bytes = serde_json::to_vec(&keys).unwrap_or_default();
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
enum NotificationTarget {
    Favorite,
    Watch { match_id: String, generation: u64 },
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
struct PendingNotification {
    kind: String,
    key: String,
    title: String,
    body: String,
    ids: Vec<String>,
    #[serde(default)]
    team_names: Vec<String>,
    /// Score reached by a named watch goal, shared with global score alerts.
    #[serde(default)]
    score_dedup: Option<String>,
    #[serde(default)]
    score_batch: Option<String>,
    target: NotificationTarget,
    created_at: i64,
    /// None denotes a legacy entry persisted before enqueue sequencing.
    #[serde(default)]
    sequence: Option<u64>,
}

/// Match id a queued notification belongs to (favourite keys are `kind|match|...`).
fn notification_match_id(item: &PendingNotification) -> &str {
    match &item.target {
        NotificationTarget::Watch { match_id, .. } => match_id.as_str(),
        NotificationTarget::Favorite => item.key.split('|').nth(1).unwrap_or_default(),
    }
}

/// Reminders carry no result; everything else is held back for hidden matches.
fn hidden_by_spoiler(item: &PendingNotification, cfg: &PollConfig) -> bool {
    item.kind != "reminder" && cfg.result_hidden(notification_match_id(item))
}

#[derive(serde::Serialize, Deserialize)]
struct StoredNotifications {
    #[serde(default)]
    last_sequence: u64,
    #[serde(default)]
    items: Vec<PendingNotification>,
}

/// Failed native deliveries survive the next observation and application
/// restart. Successful deliveries are marked separately for de-duplication.
#[derive(Default)]
struct NotificationQueue {
    pending: HashMap<String, PendingNotification>,
    // A successful OS delivery must not be repeated in-process if SQLite fails.
    sent: HashSet<String>,
    score_sent: HashMap<String, ScoreReceipt>,
    last_sequence: u64,
}

impl NotificationQueue {
    fn load(cache: &crate::cache::Cache) -> Self {
        let stored = cache
            .get(PENDING_SOURCE, PENDING_PATH)
            .and_then(|row| {
                serde_json::from_value::<StoredNotifications>(row.payload.clone())
                    .ok()
                    .or_else(|| {
                        serde_json::from_value::<Vec<PendingNotification>>(row.payload)
                            .ok()
                            .map(|items| StoredNotifications {
                                last_sequence: 0,
                                items,
                            })
                    })
            })
            .unwrap_or(StoredNotifications {
                last_sequence: 0,
                items: Vec::new(),
            });
        let last_sequence = stored
            .items
            .iter()
            .filter_map(|item| item.sequence)
            .max()
            .unwrap_or(0)
            .max(stored.last_sequence);
        let pending = stored
            .items
            .into_iter()
            .filter(|item| item.created_at >= now_ms() - DEDUP_TTL_MS)
            .map(|item| (item.key.clone(), item))
            .collect();
        Self {
            pending,
            sent: HashSet::new(),
            score_sent: HashMap::new(),
            last_sequence,
        }
    }

    fn persist(&self, cache: &crate::cache::Cache) {
        let stored = StoredNotifications {
            last_sequence: self.last_sequence,
            items: self.pending.values().cloned().collect(),
        };
        if let Ok(payload) = serde_json::to_value(stored) {
            let _ = cache.put(PENDING_SOURCE, PENDING_PATH, &payload, now_ms());
        }
    }

    fn score_allows(&self, cache: &crate::cache::Cache, key: &str, batch: Option<&str>) -> bool {
        let receipt = self
            .score_sent
            .get(key)
            .cloned()
            .or_else(|| DedupStore { cache }.score_receipt(key));
        match receipt {
            None => true,
            Some(ScoreReceipt::Named {
                batch: Some(previous),
            }) => batch == Some(previous.as_str()),
            _ => false,
        }
    }

    fn enqueue(&mut self, cache: &crate::cache::Cache, mut item: PendingNotification) {
        let store = DedupStore { cache };
        if self.pending.contains_key(&item.key)
            || self.sent.contains(&item.key)
            || self.score_sent.contains_key(&item.key)
            || store.seen(&item.key)
            || item
                .score_dedup
                .as_ref()
                .is_some_and(|score| !self.score_allows(cache, score, item.score_batch.as_deref()))
        {
            return;
        }
        self.last_sequence = self.last_sequence.saturating_add(1);
        item.sequence = Some(self.last_sequence);
        self.pending.insert(item.key.clone(), item);
        self.persist(cache);
    }

    /// Process the actual queue in enqueue order. Legacy entries predate
    /// sequenced ones and use a deterministic timestamp/key fallback.
    fn process(
        &mut self,
        cache: &crate::cache::Cache,
        mut allowed: impl FnMut(&PendingNotification) -> bool,
        mut send: impl FnMut(&PendingNotification) -> bool,
    ) -> Vec<PendingNotification> {
        let mut items: Vec<_> = self.pending.values().cloned().collect();
        items.sort_by(|a, b| match (a.sequence, b.sequence) {
            (Some(a_seq), Some(b_seq)) => a_seq
                .cmp(&b_seq)
                .then_with(|| a.created_at.cmp(&b.created_at))
                .then_with(|| a.key.cmp(&b.key)),
            (None, None) => a
                .created_at
                .cmp(&b.created_at)
                .then_with(|| a.key.cmp(&b.key)),
            (None, Some(_)) => std::cmp::Ordering::Less,
            (Some(_), None) => std::cmp::Ordering::Greater,
        });
        let mut delivered = Vec::new();
        for item in items {
            let permit = allowed(&item);
            if self.attempt(cache, &item.key, permit, || allowed(&item) && send(&item)) {
                delivered.push(item);
            } else if self.pending.contains_key(&item.key) {
                // A failed delivery stays at the head so a later score or
                // goal cannot be delivered before it on a subsequent retry.
                break;
            }
        }
        delivered
    }

    /// A denied, expired, or already delivered item is discarded. An OS
    /// failure keeps it queued, and only a successful send writes the dedup key.
    fn attempt(
        &mut self,
        cache: &crate::cache::Cache,
        key: &str,
        allowed: bool,
        send: impl FnOnce() -> bool,
    ) -> bool {
        let Some(item) = self.pending.get(key) else {
            return false;
        };
        let score_dedup = item.score_dedup.clone();
        let score_batch = item.score_batch.clone();
        let store = DedupStore { cache };
        if !allowed
            || item.created_at < now_ms() - DEDUP_TTL_MS
            || self.sent.contains(key)
            || self.score_sent.contains_key(key)
            || store.seen(key)
            || score_dedup
                .as_ref()
                .is_some_and(|score| !self.score_allows(cache, score, score_batch.as_deref()))
        {
            self.pending.remove(key);
            self.persist(cache);
            return false;
        }
        if !send() {
            return false;
        }
        if key.starts_with("score|") {
            if store.mark_score(key, &ScoreReceipt::Score).is_err() {
                self.score_sent.insert(key.to_string(), ScoreReceipt::Score);
                self.sent.insert(key.to_string());
            }
        } else if store.mark(key).is_err() {
            self.sent.insert(key.to_string());
        }
        if let Some(score_key) = score_dedup {
            let receipt = ScoreReceipt::Named { batch: score_batch };
            if store.mark_score(&score_key, &receipt).is_err() {
                self.score_sent.insert(score_key, receipt);
            }
        }
        self.pending.remove(key);
        self.persist(cache);
        true
    }
}

pub struct Poller {
    state: Arc<AppStateInner>,
    config: std::sync::Mutex<PollConfig>,
    snapshots: std::sync::Mutex<HashMap<String, LiveSnapshot>>,
    feed: std::sync::Mutex<LiveFeed>,
    revision: AtomicU64,
    config_initialized: AtomicBool,
    blocked: std::sync::Mutex<HashMap<String, (u64, Instant)>>,
    notifications: std::sync::Mutex<NotificationQueue>,
    score_tracker: std::sync::Mutex<ScoreTracker>,
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
    /// Score associated with the last complete event list.
    event_home_score: Option<i64>,
    event_away_score: Option<i64>,
    /// Goal identities observed in complete snapshots, including corrections.
    seen_goal_keys: HashSet<String>,
    event_snapshot_revision: u64,
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
            event_home_score: None,
            event_away_score: None,
            seen_goal_keys: HashSet::new(),
            event_snapshot_revision: 0,
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

#[derive(Debug, Clone, PartialEq)]
enum WatchedGoal {
    Event(Value),
    /// The score rose, but event corrections make the new goal ambiguous.
    Score {
        home: i64,
        away: i64,
    },
}

fn watched_goal_notification(
    goal: &WatchedGoal,
    match_id: &str,
    home: &str,
    away: &str,
    epoch: u64,
) -> Option<(String, String, String)> {
    match goal {
        WatchedGoal::Event(event) => {
            let identity = event_key(event)?;
            let player = event
                .get("player")
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("Игрок");
            let minute = event.get("minute").and_then(Value::as_i64).unwrap_or(0);
            let added = event
                .get("minute_added")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let clock = if added > 0 {
                format!("{minute}+{added}")
            } else {
                minute.to_string()
            };
            Some((
                format!("goal|{match_id}|{identity}"),
                "Гол!".into(),
                format!("{clock}′ {player} · {home} — {away}"),
            ))
        }
        WatchedGoal::Score {
            home: home_score,
            away: away_score,
        } => Some((
            score_key(match_id, *home_score, *away_score, epoch),
            "Изменение счёта".into(),
            format!("{home} {home_score} : {away_score} {away}"),
        )),
    }
}

fn watched_event(
    key: &str,
    title: &str,
    body: &str,
    match_id: &str,
    at: i64,
) -> crate::event_center::Event {
    crate::event_center::Event {
        id: format!("football|{key}"),
        sport: "football".into(),
        kind: "goal".into(),
        title: title.into(),
        body: body.into(),
        occurred_at: at,
        read: false,
        match_id: Some(match_id.into()),
        league_id: None,
        season: None,
        round: None,
    }
}

/// An event list is usable only when its distinct goals account for the
/// complete score. This avoids announcing old goals when an initially empty or
/// partial event list catches up with an already-scored match.
fn advance_event_baseline(
    watch: &mut Watch,
    events: &[Value],
    fresh: bool,
    live: bool,
    enabled: bool,
    home_score: Option<i64>,
    away_score: Option<i64>,
) -> Vec<WatchedGoal> {
    if !fresh {
        return Vec::new();
    }
    let (Some(home), Some(away)) = (home_score, away_score) else {
        return Vec::new();
    };
    if home < 0 || away < 0 {
        return Vec::new();
    }
    let goal_keys: HashSet<_> = events
        .iter()
        .filter(|event| event.get("event_type").and_then(Value::as_str) == Some("goal"))
        .filter_map(event_key)
        .collect();
    if i64::try_from(goal_keys.len()).ok() != home.checked_add(away) {
        return Vec::new();
    }
    let eligible = notifications_eligible(watch.baseline_ready, live, enabled, fresh);
    let changes = diff_event_keys(events, &watch.event_keys);
    let goal_changes: Vec<_> = changes
        .iter()
        .filter(|(_, event)| event.get("event_type").and_then(Value::as_str) == Some("goal"))
        .collect();
    // Corrections and changed event identities can add historical keys. If
    // individual identities cannot be reconciled with the score increase,
    // report the confirmed score change without guessing a player.
    let added = match (watch.event_home_score, watch.event_away_score) {
        (Some(old_home), Some(old_away)) if home >= old_home && away >= old_away => {
            (home - old_home).checked_add(away - old_away)
        }
        _ => None,
    };
    let goals = match added {
        Some(n) if eligible && n > 0 && usize::try_from(n).ok() == Some(goal_changes.len()) => {
            goal_changes
                .into_iter()
                .filter(|(key, _)| !watch.seen_goal_keys.contains(key))
                .map(|(_, event)| WatchedGoal::Event(event.clone()))
                .collect()
        }
        Some(n) if eligible && n > 0 => vec![WatchedGoal::Score { home, away }],
        _ => Vec::new(),
    };
    // Keep the latest complete snapshot, rather than accumulating removed or
    // corrected events forever. Persistent delivery dedup still prevents a
    // previously notified identity from being sent again if it reappears.
    watch.event_keys = events.iter().filter_map(event_key).collect();
    watch.seen_goal_keys.extend(goal_keys);
    watch.event_snapshot_revision = watch.event_snapshot_revision.saturating_add(1);
    watch.baseline_ready = true;
    watch.event_home_score = Some(home);
    watch.event_away_score = Some(away);
    goals
}

/// Pure decision: should the events endpoint be retried on this tick?
/// Always while live (the events endpoint can lag the score); only when the
/// score moved otherwise.
fn should_fetch_events(live: bool, score_changed: bool) -> bool {
    live || score_changed
}

/// Each day is independent. Stale, malformed or failed replies never enter
/// the alert baseline, while other fresh days remain usable.
#[derive(Default)]
struct DailyBatch {
    matches: HashMap<String, FlatMatch>,
    fetched_at: HashMap<String, i64>,
    ambiguous: HashSet<String>,
    failure: Option<crate::bridge::ApiFailure>,
    fresh_days: usize,
}

impl DailyBatch {
    fn add(&mut self, result: Result<crate::bridge::native::ApiReply, crate::bridge::ApiFailure>) {
        let reply = match result {
            Ok(reply) if !reply.stale => reply,
            Ok(reply) => {
                self.failure.get_or_insert_with(|| {
                    reply
                        .failure
                        .unwrap_or_else(|| crate::bridge::BridgeError::Upstream.failure())
                });
                return;
            }
            Err(error) => {
                self.failure.get_or_insert(error);
                return;
            }
        };
        let fetched_at = parse_time_ms(&reply.fetched_at);
        let data = reply.payload.get("data").unwrap_or(&reply.payload);
        let Some(list) = data.get("matches").and_then(Value::as_array) else {
            self.failure
                .get_or_insert_with(|| crate::bridge::BridgeError::BadPayload.failure());
            return;
        };
        self.fresh_days += 1;
        for value in list {
            if let Some(m) = pitch_match(value) {
                if let Some(existing) = self.matches.get(&m.id) {
                    if canonical_status(existing) != canonical_status(&m)
                        || score_text(&existing.home_score) != score_text(&m.home_score)
                        || score_text(&existing.away_score) != score_text(&m.away_score)
                    {
                        self.ambiguous.insert(m.id.clone());
                        self.failure.get_or_insert_with(|| {
                            crate::bridge::BridgeError::BadPayload.failure()
                        });
                    }
                }
                if let Some(timestamp) = fetched_at {
                    self.fetched_at.insert(m.id.clone(), timestamp);
                } else {
                    self.fetched_at.remove(&m.id);
                }
                self.matches.insert(m.id.clone(), m);
            }
        }
    }
}

fn pending_allowed(
    item: &PendingNotification,
    cfg: &PollConfig,
    watch: Option<&Watch>,
    now: i64,
) -> bool {
    if !cfg.enabled {
        return false;
    }
    let ids: Vec<&str> = match &item.target {
        NotificationTarget::Favorite => item
            .ids
            .iter()
            .filter(|id| {
                cfg.favorite_teams.iter().any(|team| &team.id == *id)
                    || cfg.favorites.iter().any(|name| name == *id)
            })
            .map(String::as_str)
            .collect(),
        NotificationTarget::Watch {
            match_id,
            generation,
        } => {
            let name_is_favorite = cfg.favorites.iter().any(|name| {
                !cfg.favorite_teams.iter().any(|team| {
                    crate::sports::favorite_name(&team.name, std::slice::from_ref(name))
                }) && item
                    .team_names
                    .iter()
                    .any(|team| crate::sports::favorite_name(team, std::slice::from_ref(name)))
            });
            if !watch.is_some_and(|w| w.match_id == *match_id && w.generation == *generation)
                || cfg
                    .favorite_teams
                    .iter()
                    .any(|team| item.ids.contains(&team.id))
                || name_is_favorite
            {
                return false;
            }
            item.ids.iter().map(String::as_str).collect()
        }
    };
    if matches!(item.target, NotificationTarget::Favorite) && ids.is_empty() {
        return false;
    }
    cfg.policy.allows(&item.kind, &ids, &cfg.timezone, now)
}

impl Poller {
    pub fn new(state: Arc<AppStateInner>) -> Self {
        let notifications = NotificationQueue::load(&state.cache);
        Self {
            state,
            config: std::sync::Mutex::new(PollConfig::default()),
            snapshots: std::sync::Mutex::new(HashMap::new()),
            feed: Default::default(),
            revision: AtomicU64::new(0),
            config_initialized: AtomicBool::new(false),
            blocked: Default::default(),
            notifications: std::sync::Mutex::new(notifications),
            score_tracker: Default::default(),
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
        let mut rebound = None;
        if changed {
            if let Ok(mut guard) = self.watch.lock() {
                if let Some(w) = guard.as_mut() {
                    let previous = w.generation;
                    w.generation = self.watch_gen.fetch_add(1, Ordering::Relaxed) + 1;
                    w.baseline_ready = false;
                    rebound = Some((w.match_id.clone(), previous, w.generation));
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
        self.config_initialized.store(true, Ordering::Relaxed);
        self.revalidate_notifications(rebound.as_ref());
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
        self.retry_notifications(app);
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
                        true,
                        home_score,
                        away_score,
                    );
                }
            }
        }
        if !reply.stale {
            next.home_score = home_score;
            next.away_score = away_score;
            next.status = status.into();
        }
        let observed_keys = (next.event_snapshot_revision != watch.event_snapshot_revision)
            .then(|| next.event_keys.clone());
        let batch = observed_keys.as_ref().map(goal_batch);
        let mut score_epoch = None;
        let mut correction = false;
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
            if observed_keys.is_some() {
                let (Some(home), Some(away), Some(fetched_at)) =
                    (home_score, away_score, parse_time_ms(&reply.fetched_at))
                else {
                    return;
                };
                let Some((epoch, corrected)) =
                    self.observe_score(&watch.match_id, home, away, fetched_at)
                else {
                    return;
                };
                score_epoch = Some(epoch);
                correction = corrected;
            }
            *current = next;
        }
        if let Some(keys) = observed_keys {
            if correction {
                self.cancel_corrected_score_notifications(
                    &watch.match_id,
                    score_epoch.unwrap_or(0),
                );
            }
            self.reconcile_watched_notifications(
                &watch.match_id,
                watch.generation,
                &keys,
                home_score,
                away_score,
                score_epoch.unwrap_or(0),
            );
        }
        let _=app.emit("sportsdesk://match-update",serde_json::json!({"matchId":watch.match_id,"fetchedAt":reply.fetched_at,"stale":reply.stale,"generation":watch.generation}));
        let mut pending_goals = Vec::new();
        for goal in goals {
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
            let Some((key, title, body)) = watched_goal_notification(
                &goal,
                &watch.match_id,
                home,
                away,
                score_epoch.unwrap_or(0),
            ) else {
                continue;
            };
            let score_dedup = match (&goal, home_score, away_score) {
                (WatchedGoal::Event(_), Some(home), Some(away)) => Some(score_key(
                    &watch.match_id,
                    home,
                    away,
                    score_epoch.unwrap_or(0),
                )),
                _ => None,
            };
            if self.config().result_hidden(&watch.match_id) {
                continue;
            }
            crate::event_center::record(
                app,
                &self.state.cache,
                &watched_event(&key, &title, &body, &watch.match_id, now_ms()),
            );
            if self.delivery_allowed("goal", &[home_id, away_id]) {
                pending_goals.push(PendingNotification {
                    kind: "goal".into(),
                    key,
                    title,
                    body,
                    ids: vec![home_id.into(), away_id.into()],
                    team_names: vec![home.into(), away.into()],
                    score_dedup,
                    score_batch: batch.clone(),
                    target: NotificationTarget::Watch {
                        match_id: watch.match_id.clone(),
                        generation: watch.generation,
                    },
                    created_at: now_ms(),
                    sequence: None,
                });
            }
        }
        // Queue all goals from one observation under one lock before a retry
        // can mark their common score key as delivered.
        if let Ok(mut queue) = self.notifications.lock() {
            for item in pending_goals {
                queue.enqueue(&self.state.cache, item);
            }
        }
        self.retry_notifications(app);
    }

    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Relaxed)
    }
    async fn fetch_watched(&self, path: String) -> Option<crate::bridge::native::ApiReply> {
        let revision = self.revision();
        let blocked = self.blocked.lock().ok().and_then(|v| v.get(&path).copied());
        if path_is_blocked(blocked, revision, Instant::now()) {
            return None;
        }
        match fetch_with_cache(self.state.clone(), "pitch".into(), path.clone()).await {
            Ok(reply) => {
                if reply.failure.as_ref().is_some_and(|f| !f.retryable) {
                    if let Ok(mut v) = self.blocked.lock() {
                        v.insert(path, (revision, Instant::now() + MAX_TICK));
                    }
                } else if let Ok(mut v) = self.blocked.lock() {
                    v.remove(&path);
                }
                Some(reply)
            }
            Err(error) => {
                if !error.failure().retryable {
                    if let Ok(mut v) = self.blocked.lock() {
                        v.insert(path, (revision, Instant::now() + MAX_TICK));
                    }
                }
                None
            }
        }
    }
    /// True once the UI has pushed its real configuration (favourites).
    pub fn config_ready(&self) -> bool {
        self.config_initialized.load(Ordering::Relaxed)
    }
    pub fn live_feed(&self) -> LiveFeed {
        self.feed.lock().map(|v| v.clone()).unwrap_or_default()
    }
    pub fn settings_changed(&self) {
        self.revision.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut s) = self.snapshots.lock() {
            s.clear();
        }
        let mut rebound = None;
        if let Ok(mut w) = self.watch.lock() {
            if let Some(w) = w.as_mut() {
                w.baseline_ready = false;
                let previous = w.generation;
                w.generation = self.watch_gen.fetch_add(1, Ordering::Relaxed) + 1;
                rebound = Some((w.match_id.clone(), previous, w.generation));
            }
        }
        self.revalidate_notifications(rebound.as_ref());
    }
    pub fn delivery_allowed(&self, kind: &str, ids: &[&str]) -> bool {
        let cfg = self.config();
        cfg.enabled && cfg.policy.allows(kind, ids, &cfg.timezone, now_ms())
    }

    fn queue_notification(&self, item: PendingNotification) {
        if let Ok(mut queue) = self.notifications.lock() {
            queue.enqueue(&self.state.cache, item);
        }
    }

    fn observe_score(
        &self,
        match_id: &str,
        home: i64,
        away: i64,
        fetched_at: i64,
    ) -> Option<(u64, bool)> {
        self.score_tracker
            .lock()
            .ok()?
            .observe(&self.state.cache, match_id, home, away, fetched_at)
    }

    fn cancel_corrected_score_notifications(&self, match_id: &str, epoch: u64) {
        let Ok(mut queue) = self.notifications.lock() else {
            return;
        };
        let Ok(tracker) = self.score_tracker.lock() else {
            return;
        };
        let Some(current) = tracker.matches.get(match_id) else {
            return;
        };
        if current.epoch != epoch {
            return;
        }
        let old_len = queue.pending.len();
        queue.pending.retain(|key, _| {
            parse_score_key(key, match_id).is_none_or(|(home, away, score_epoch)| {
                score_epoch == epoch && home <= current.home && away <= current.away
            })
        });
        if old_len != queue.pending.len() {
            queue.persist(&self.state.cache);
        }
    }

    /// A complete corrected event list may remove a goal whose OS delivery
    /// previously failed. Do not retry that now-invalid notification.
    fn reconcile_watched_notifications(
        &self,
        match_id: &str,
        generation: u64,
        keys: &HashSet<String>,
        home_score: Option<i64>,
        away_score: Option<i64>,
        epoch: u64,
    ) {
        let Ok(mut queue) = self.notifications.lock() else {
            return;
        };
        let prefix = format!("goal|{match_id}|");
        let old_len = queue.pending.len();
        queue.pending.retain(|key, item| match &item.target {
            NotificationTarget::Watch {
                match_id: id,
                generation: gen,
            } if id == match_id && *gen == generation => {
                if let Some(identity) = key.strip_prefix(&prefix) {
                    keys.contains(identity)
                } else if let (
                    Some((pending_home, pending_away, pending_epoch)),
                    Some(home),
                    Some(away),
                ) = (parse_score_key(key, match_id), home_score, away_score)
                {
                    pending_epoch == epoch && pending_home <= home && pending_away <= away
                } else {
                    true
                }
            }
            _ => true,
        });
        if queue.pending.len() != old_len {
            queue.persist(&self.state.cache);
        }
    }

    /// Settings and API-key revisions invalidate in-flight watch responses,
    /// but do not by themselves invalidate a previously detected event.
    fn revalidate_notifications(&self, rebound: Option<&(String, u64, u64)>) {
        if !self.config_initialized.load(Ordering::Relaxed) {
            return;
        }
        let Ok(mut queue) = self.notifications.lock() else {
            return;
        };
        let cfg = self.config();
        let watch = self.watch.lock().ok().and_then(|w| w.clone());
        let mut changed = false;
        if let (Some((match_id, previous, next)), Some(w)) = (rebound, watch.as_ref()) {
            if w.match_id == *match_id && w.generation == *next {
                for item in queue.pending.values_mut() {
                    if let NotificationTarget::Watch {
                        match_id: id,
                        generation,
                    } = &mut item.target
                    {
                        if id == match_id && *generation == *previous {
                            *generation = *next;
                            changed = true;
                        }
                    }
                }
            }
        }
        let old_len = queue.pending.len();
        queue
            .pending
            .retain(|_, item| pending_allowed(item, &cfg, watch.as_ref(), now_ms()));
        if changed || old_len != queue.pending.len() {
            queue.persist(&self.state.cache);
        }
    }

    fn notification_allowed_now(&self, item: &PendingNotification) -> bool {
        let cfg = self.config();
        if hidden_by_spoiler(item, &cfg) {
            return false;
        }
        let watch = self.watch.lock().ok().and_then(|w| w.clone());
        pending_allowed(item, &cfg, watch.as_ref(), now_ms())
    }

    /// Retry independently of source availability. Recheck current settings,
    /// favourites and watch generation before any delayed native delivery.
    fn retry_notifications(&self, app: &AppHandle) {
        if !self.config_initialized.load(Ordering::Relaxed) {
            return;
        }
        let Ok(mut queue) = self.notifications.lock() else {
            return;
        };
        let delivered = queue.process(
            &self.state.cache,
            |item| self.notification_allowed_now(item),
            |item| {
                app.notification()
                    .builder()
                    .title(&item.title)
                    .body(&item.body)
                    .show()
                    .is_ok()
            },
        );
        drop(queue);
        for item in delivered {
            if matches!(item.target, NotificationTarget::Favorite) {
                let _ = app.emit(
                    "sportsdesk://match-event",
                    serde_json::json!({"title":item.title,"body":item.body}),
                );
            }
        }
    }
    async fn tick(&self, app: &AppHandle) -> Result<(), crate::bridge::ApiFailure> {
        self.retry_notifications(app);
        let revision = self.revision();
        let cfg = self.config();
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
        let mut batch = DailyBatch::default();
        for offset in [-1, 0, 1] {
            let date = today + chrono::Duration::days(offset);
            let path = format!("date/{date}?status=all");
            let result = fetch_with_cache(self.state.clone(), "pitch".into(), path)
                .await
                .map_err(|e| e.failure());
            batch.add(result);
        }
        let mut matches: Vec<_> = batch
            .matches
            .values()
            .filter(|m| !batch.ambiguous.contains(&m.id) && !favorite_ids(m, &cfg).is_empty())
            .cloned()
            .collect();
        matches.sort_by_key(|m| m.time.clone().unwrap_or_default());
        if self.revision() != revision {
            return Ok(());
        }
        self.ingest(app, &matches, &batch.fetched_at, batch.failure.is_none());
        // Retain the last displayed rows when any day is unavailable, but
        // never use those saved rows to detect new match events.
        if batch.failure.is_some() {
            for m in self.live_feed().matches {
                if !favorite_ids(&m, &cfg).is_empty() {
                    future.entry(m.id.clone()).or_insert(m);
                }
            }
        }
        for m in batch.matches.into_values() {
            if !favorite_ids(&m, &cfg).is_empty() {
                future.insert(m.id.clone(), m);
            }
        }
        let mut all: Vec<_> = future.into_values().collect();
        all.sort_by_key(|m| m.time.clone().unwrap_or_default());
        let feed = LiveFeed {
            matches: all,
            fetched_at: Some(crate::cache::iso_utc_ms(now_ms())),
            stale: batch.failure.is_some(),
            failure: batch.failure.clone(),
        };
        if let Ok(mut guard) = self.feed.lock() {
            *guard = feed.clone()
        }
        let _ = app.emit("sportsdesk://live-feed", &feed);
        crate::tray::update_football(app, &feed.matches, &cfg.timezone);
        if batch.fresh_days == 0 {
            Err(batch
                .failure
                .unwrap_or_else(|| crate::bridge::BridgeError::Upstream.failure()))
        } else {
            Ok(())
        }
    }
    fn ingest(
        &self,
        app: &AppHandle,
        matches: &[FlatMatch],
        fetched_at: &HashMap<String, i64>,
        prune_missing: bool,
    ) {
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
                // Unknown status and partial scores must not replace a valid
                // baseline and later manufacture start/score transitions.
                if !live && !finished && !scheduled {
                    continue;
                }
                let score_epoch = match (home.parse::<i64>(), away.parse::<i64>()) {
                    (Ok(home), Ok(away)) => {
                        let Some(&at) = fetched_at.get(&key) else {
                            continue;
                        };
                        let Some((epoch, corrected)) = self.observe_score(&key, home, away, at)
                        else {
                            continue;
                        };
                        if corrected {
                            self.cancel_corrected_score_notifications(&key, epoch);
                        }
                        epoch
                    }
                    _ => 0,
                };
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
                        && !prev.home_score.is_empty()
                        && !prev.away_score.is_empty()
                        && (home != prev.home_score || away != prev.away_score)
                    {
                        events.push((
                            "goal".into(),
                            score_key(
                                &key,
                                home.parse().unwrap_or(0),
                                away.parse().unwrap_or(0),
                                score_epoch,
                            ),
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
                let (snapshot_home, snapshot_away) = if !home.is_empty() && !away.is_empty() {
                    (home, away)
                } else if let Some(prev) = snapshots.get(&key) {
                    (prev.home_score.clone(), prev.away_score.clone())
                } else {
                    (String::new(), String::new())
                };
                snapshots.insert(
                    key.clone(),
                    LiveSnapshot {
                        live,
                        finished,
                        home_score: snapshot_home,
                        away_score: snapshot_away,
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
            if prune_missing && snapshots.len() > 2000 {
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
            if fresh_ids.is_empty() {
                continue;
            }
            let match_id = key.split('|').nth(1).unwrap_or_default().to_string();
            if kind != "reminder" && current.result_hidden(&match_id) {
                continue;
            }
            let league_id = current
                .favorite_teams
                .iter()
                .find(|team| fresh_ids.contains(&team.id.as_str()))
                .and_then(|team| team.league_id.clone());
            crate::event_center::record(
                app,
                &self.state.cache,
                &crate::event_center::Event {
                    id: format!("football|{key}"),
                    sport: "football".into(),
                    kind: kind.clone(),
                    title: title.clone(),
                    body: body.clone(),
                    occurred_at: now,
                    read: false,
                    match_id: Some(match_id),
                    league_id,
                    season: None,
                    round: None,
                },
            );
            if self.delivery_allowed(&kind, &fresh_ids) {
                self.queue_notification(PendingNotification {
                    kind,
                    key,
                    title,
                    body,
                    ids: fresh_ids.into_iter().map(str::to_owned).collect(),
                    team_names: Vec::new(),
                    score_dedup: None,
                    score_batch: None,
                    target: NotificationTarget::Favorite,
                    created_at: now,
                    sequence: None,
                });
            }
        }
        self.retry_notifications(app);
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
        loop {
            let revision = poller.revision.load(Ordering::Relaxed);
            match poller.tick(&app).await {
                Ok(()) => {
                    pause = retry_delay(pause, BASE_TICK, MAX_TICK, None);
                }
                Err(error) => {
                    pause = retry_delay(pause, BASE_TICK, MAX_TICK, Some(&error));
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
    fn spoiler_hidden_matches_hold_back_result_alerts() {
        let cfg: PollConfig =
            serde_json::from_str(r#"{"enabled":true,"favorites":[],"hiddenResults":["m1"]}"#)
                .unwrap();
        assert!(cfg.result_hidden("m1"));
        assert!(!cfg.result_hidden("m2"));
        assert!(!cfg.result_hidden(""));
        let legacy: PollConfig =
            serde_json::from_str(r#"{"enabled":true,"favorites":[]}"#).unwrap();
        assert!(legacy.hidden_results.is_empty());

        let mut goal = pending("goal|m1|event");
        goal.kind = "goal".into();
        goal.target = NotificationTarget::Favorite;
        assert!(hidden_by_spoiler(&goal, &cfg));
        let mut reminder = goal.clone();
        reminder.kind = "reminder".into();
        assert!(!hidden_by_spoiler(&reminder, &cfg));
        let mut watched = goal.clone();
        watched.key = "watch-goal|x".into();
        watched.target = NotificationTarget::Watch {
            match_id: "m1".into(),
            generation: 1,
        };
        assert!(hidden_by_spoiler(&watched, &cfg));
        let mut other = goal.clone();
        other.key = "goal|m2|event".into();
        assert!(!hidden_by_spoiler(&other, &cfg));
    }

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
        assert!(advance_event_baseline(
            &mut watch,
            std::slice::from_ref(&first),
            false,
            true,
            true,
            Some(1),
            Some(0)
        )
        .is_empty());
        assert!(!watch.baseline_ready);
        assert!(advance_event_baseline(
            &mut watch,
            std::slice::from_ref(&first),
            true,
            true,
            true,
            Some(1),
            Some(0)
        )
        .is_empty());
        assert!(watch.baseline_ready);
        let second = goal(20, 0, 7, 2);
        assert!(advance_event_baseline(
            &mut watch,
            &[first.clone(), second.clone()],
            true,
            true,
            false,
            Some(1),
            Some(1)
        )
        .is_empty());
        assert!(advance_event_baseline(
            &mut watch,
            &[first.clone(), second.clone()],
            true,
            true,
            true,
            Some(1),
            Some(1)
        )
        .is_empty());
        let third = goal(30, 0, 9, 1);
        let all = [first.clone(), second.clone(), third.clone()];
        assert!(
            advance_event_baseline(&mut watch, &all, false, true, true, Some(2), Some(1))
                .is_empty()
        );
        assert_eq!(
            advance_event_baseline(&mut watch, &all, true, true, true, Some(2), Some(1)).len(),
            1
        );
        assert!(
            advance_event_baseline(&mut watch, &all, true, true, true, Some(2), Some(1)).is_empty()
        );
        let archived = [first, second, third, goal(50, 0, 8, 2)];
        assert!(
            advance_event_baseline(&mut watch, &archived, true, false, true, Some(2), Some(2))
                .is_empty()
        );
    }

    #[test]
    fn incomplete_event_lists_never_turn_old_goals_into_new_alerts() {
        let mut watch = Watch::new("m1".into(), 1);
        let old = goal(10, 0, 10, 1);
        let new = goal(20, 0, 20, 1);
        assert!(
            advance_event_baseline(&mut watch, &[], true, true, true, Some(1), Some(0)).is_empty()
        );
        assert!(!watch.baseline_ready);
        assert!(advance_event_baseline(
            &mut watch,
            std::slice::from_ref(&old),
            true,
            true,
            true,
            Some(1),
            Some(0)
        )
        .is_empty());
        assert!(watch.baseline_ready);
        // The score advanced before the event list caught up; keep the old baseline.
        assert!(advance_event_baseline(
            &mut watch,
            std::slice::from_ref(&old),
            true,
            true,
            true,
            Some(2),
            Some(0)
        )
        .is_empty());
        assert_eq!(watch.event_home_score, Some(1));
        assert_eq!(
            advance_event_baseline(
                &mut watch,
                &[old.clone(), new.clone()],
                true,
                true,
                true,
                Some(2),
                Some(0)
            ),
            vec![WatchedGoal::Event(new.clone())]
        );
        // An event identity correction with no score change is not a goal.
        let corrected = goal(20, 0, 21, 1);
        assert!(advance_event_baseline(
            &mut watch,
            &[old, corrected],
            true,
            true,
            true,
            Some(2),
            Some(0)
        )
        .is_empty());
    }

    fn day_reply(stale: bool, matches: Vec<Value>) -> crate::bridge::native::ApiReply {
        crate::bridge::native::ApiReply {
            payload: serde_json::json!({"data": {"matches": matches}}),
            source: "pitch".into(),
            fetched_at: "2026-10-27T00:00:00Z".into(),
            stale,
            failure: stale.then(|| crate::bridge::BridgeError::Unauthorized.failure()),
        }
    }

    fn day_match(id: &str, score: i64) -> Value {
        serde_json::json!({
            "id": id, "home_team": {"id": "home"}, "away_team": {"id": "away"},
            "score_home": score, "score_away": 0, "status": "live"
        })
    }

    #[test]
    fn failed_and_stale_days_do_not_block_fresh_days() {
        let mut batch = DailyBatch::default();
        batch.add(Err(crate::bridge::BridgeError::NotFound.failure()));
        batch.add(Ok(day_reply(false, vec![day_match("fresh", 1)])));
        batch.add(Ok(day_reply(true, vec![day_match("stale", 2)])));
        assert_eq!(batch.fresh_days, 1);
        assert!(batch.matches.contains_key("fresh"));
        assert!(!batch.matches.contains_key("stale"));
        assert!(batch.failure.is_some());
    }

    #[test]
    fn conflicting_fresh_days_do_not_enter_alert_baselines() {
        let mut batch = DailyBatch::default();
        batch.add(Ok(day_reply(false, vec![day_match("shared", 1)])));
        batch.add(Ok(day_reply(
            false,
            vec![day_match("shared", 0), day_match("other", 2)],
        )));
        assert!(batch.ambiguous.contains("shared"));
        assert!(!batch.ambiguous.contains("other"));
        assert!(batch.failure.is_some());
    }

    fn pending(key: &str) -> PendingNotification {
        PendingNotification {
            kind: "goal".into(),
            key: key.into(),
            title: "Goal".into(),
            body: "1:0".into(),
            ids: vec!["home".into()],
            team_names: Vec::new(),
            score_dedup: None,
            score_batch: None,
            target: NotificationTarget::Favorite,
            created_at: now_ms(),
            sequence: None,
        }
    }

    #[test]
    fn failed_football_delivery_survives_reload_and_success_is_deduplicated() {
        let cache = crate::cache::Cache::open_in_memory();
        let mut queue = NotificationQueue::load(&cache);
        queue.enqueue(&cache, pending("score|m|1|0"));
        assert!(!queue.attempt(&cache, "score|m|1|0", true, || false));
        assert!(!DedupStore { cache: &cache }.seen("score|m|1|0"));
        let mut reloaded = NotificationQueue::load(&cache);
        assert!(reloaded.attempt(&cache, "score|m|1|0", true, || true));
        assert!(DedupStore { cache: &cache }.seen("score|m|1|0"));
        let mut after_delivery = NotificationQueue::load(&cache);
        after_delivery.enqueue(&cache, pending("score|m|1|0"));
        assert!(after_delivery.pending.is_empty());
        assert!(
            !after_delivery.attempt(&cache, "score|m|1|0", true, || panic!("duplicate delivery"))
        );
    }

    #[test]
    fn denied_delivery_discards_pending_item_without_sending() {
        let cache = crate::cache::Cache::open_in_memory();
        let mut queue = NotificationQueue::load(&cache);
        queue.enqueue(&cache, pending("start|m"));
        assert!(!queue.attempt(&cache, "start|m", false, || panic!("delivery was denied")));
        assert!(NotificationQueue::load(&cache).pending.is_empty());
    }

    #[test]
    fn settings_and_key_changes_keep_only_still_eligible_pending_notifications() {
        let poller = Poller::new(Arc::new(AppStateInner {
            client: crate::bridge::http_client(),
            cache: crate::cache::Cache::open_in_memory(),
            concurrency: crate::bridge::Concurrency::new(),
        }));
        let team = |id: &str| FavoriteTeam {
            id: id.into(),
            name: id.into(),
            league_id: None,
        };
        let mut cfg = PollConfig {
            enabled: true,
            favorite_teams: vec![team("home"), team("removed")],
            ..Default::default()
        };
        poller.set_config(cfg.clone());
        let generation = poller.watch_match("watched");
        poller.queue_notification(pending("keep"));
        let mut removed = pending("removed");
        removed.ids = vec!["removed".into()];
        poller.queue_notification(removed);
        let mut watched = pending("watch");
        watched.ids = vec!["other".into()];
        watched.target = NotificationTarget::Watch {
            match_id: "watched".into(),
            generation,
        };
        poller.queue_notification(watched);

        cfg.f1_reminders = false;
        poller.set_config(cfg.clone());
        assert_eq!(poller.notifications.lock().unwrap().pending.len(), 3);
        let current_generation = poller.watch_match("watched");
        assert!(current_generation > generation);
        assert!(matches!(
            poller.notifications.lock().unwrap().pending["watch"].target,
            NotificationTarget::Watch { generation, .. } if generation == current_generation
        ));

        poller.settings_changed(); // Pitch API key change.
        assert_eq!(poller.notifications.lock().unwrap().pending.len(), 3);
        assert_eq!(
            NotificationQueue::load(&poller.state.cache).pending.len(),
            3
        );
        cfg.favorite_teams.retain(|team| team.id != "removed");
        poller.set_config(cfg.clone());
        let keys = || {
            poller
                .notifications
                .lock()
                .unwrap()
                .pending
                .keys()
                .cloned()
                .collect::<HashSet<_>>()
        };
        assert_eq!(
            keys(),
            ["keep".into(), "watch".into()].into_iter().collect()
        );

        let mut name_match = pending("name_match");
        name_match.ids = vec!["unresolved".into()];
        name_match.team_names = vec!["Arsenal".into()];
        name_match.target = NotificationTarget::Watch {
            match_id: "watched".into(),
            generation: poller.watch_match("watched"),
        };
        poller.queue_notification(name_match);
        cfg.favorites.push("Arsenal".into());
        poller.set_config(cfg.clone());
        assert_eq!(
            keys(),
            ["keep".into(), "watch".into()].into_iter().collect()
        );

        poller.unwatch_match();
        poller.watch_match("watched");
        poller.settings_changed();
        assert_eq!(keys(), ["keep".into()].into_iter().collect());
        cfg.policy.events.goals = false;
        poller.set_config(cfg);
        assert!(keys().is_empty());
        assert!(NotificationQueue::load(&poller.state.cache)
            .pending
            .is_empty());
    }

    #[test]
    fn corrected_event_snapshot_replaces_stale_keys_without_duplicate_delivery() {
        let mut watch = Watch::new("m".into(), 1);
        let scored = goal(12, 0, 1, 1);
        assert!(
            advance_event_baseline(&mut watch, &[], true, true, true, Some(0), Some(0)).is_empty()
        );
        assert_eq!(
            advance_event_baseline(
                &mut watch,
                std::slice::from_ref(&scored),
                true,
                true,
                true,
                Some(1),
                Some(0)
            ),
            vec![WatchedGoal::Event(scored.clone())]
        );
        let key = format!("goal|m|{}", event_key(&scored).unwrap());
        let cache = crate::cache::Cache::open_in_memory();
        let mut queue = NotificationQueue::load(&cache);
        queue.enqueue(&cache, pending(&key));
        assert!(queue.attempt(&cache, &key, true, || true));

        assert!(
            advance_event_baseline(&mut watch, &[], true, true, true, Some(0), Some(0)).is_empty()
        );
        assert!(!watch.event_keys.contains(&event_key(&scored).unwrap()));
        assert!(advance_event_baseline(
            &mut watch,
            std::slice::from_ref(&scored),
            true,
            true,
            true,
            Some(1),
            Some(0)
        )
        .is_empty());
        queue.enqueue(&cache, pending(&key));
        assert!(
            queue.pending.is_empty(),
            "a restored goal must not be delivered twice"
        );
    }

    #[test]
    fn corrected_old_goal_does_not_hide_an_unseen_goal_or_replay_the_old_one() {
        let mut watch = Watch::new("m".into(), 1);
        let old = goal(10, 0, 1, 1);
        let correction = goal(10, 0, 2, 1);
        let genuinely_new = goal(20, 0, 3, 1);
        assert!(advance_event_baseline(
            &mut watch,
            std::slice::from_ref(&old),
            true,
            true,
            true,
            Some(1),
            Some(0)
        )
        .is_empty());
        assert!(advance_event_baseline(
            &mut watch,
            std::slice::from_ref(&correction),
            true,
            true,
            true,
            Some(1),
            Some(0)
        )
        .is_empty());
        assert!(!watch.event_keys.contains(&event_key(&old).unwrap()));
        assert_eq!(
            advance_event_baseline(
                &mut watch,
                &[old, correction, genuinely_new.clone()],
                true,
                true,
                true,
                Some(3),
                Some(0)
            ),
            vec![WatchedGoal::Event(genuinely_new)]
        );
    }

    #[test]
    fn simultaneous_goal_correction_and_new_goal_produces_one_score_alert() {
        let mut watch = Watch::new("m".into(), 1);
        let old = goal(10, 0, 1, 1);
        let corrected = goal(10, 0, 2, 1);
        let new = goal(20, 0, 3, 1);
        assert!(
            advance_event_baseline(&mut watch, &[old], true, true, true, Some(1), Some(0))
                .is_empty()
        );
        let changes = [corrected, new];
        let alerts =
            advance_event_baseline(&mut watch, &changes, true, true, true, Some(2), Some(0));
        assert_eq!(alerts, vec![WatchedGoal::Score { home: 2, away: 0 }]);
        let (key, title, body) =
            watched_goal_notification(&alerts[0], "m", "Home", "Away", 0).unwrap();
        assert_eq!(key, "score|m|2|0");
        assert_eq!(title, "Изменение счёта");
        assert_eq!(body, "Home 2 : 0 Away");
        assert!(
            advance_event_baseline(&mut watch, &changes, true, true, true, Some(2), Some(0))
                .is_empty()
        );
    }

    #[test]
    fn named_and_score_alerts_share_dedup_in_both_delivery_orders() {
        for score_first in [true, false] {
            let cache = crate::cache::Cache::open_in_memory();
            let mut queue = NotificationQueue::load(&cache);
            let score_key = "score|m|2|0";
            let score = pending(score_key);
            let mut named = pending("goal|m|event");
            named.score_dedup = Some(score_key.into());
            named.score_batch = Some("batch".into());
            let (first, second) = if score_first {
                (score, named)
            } else {
                (named, score)
            };
            let first_key = first.key.clone();
            queue.enqueue(&cache, first);
            assert!(queue.attempt(&cache, &first_key, true, || true));
            queue.enqueue(&cache, second);
            assert!(queue.pending.is_empty());
        }

        // Different goals from the same complete observation are queued
        // together before any can mark their common score as delivered.
        let cache = crate::cache::Cache::open_in_memory();
        let mut queue = NotificationQueue::load(&cache);
        for key in ["goal|m|first", "goal|m|second"] {
            let mut item = pending(key);
            item.score_dedup = Some("score|m|2|0".into());
            item.score_batch = Some("batch".into());
            queue.enqueue(&cache, item);
        }
        assert!(queue.attempt(&cache, "goal|m|first", true, || true));
        assert!(queue.attempt(&cache, "goal|m|second", true, || true));

        let cfg = PollConfig {
            enabled: true,
            favorite_teams: vec![FavoriteTeam {
                id: "home".into(),
                name: "Home".into(),
                league_id: None,
            }],
            ..Default::default()
        };
        assert!(cfg.policy.events.goals);
        let mut watched = pending("goal|m|event");
        watched.target = NotificationTarget::Watch {
            match_id: "m".into(),
            generation: 1,
        };
        assert!(!pending_allowed(
            &watched,
            &cfg,
            Some(&Watch::new("m".into(), 1)),
            now_ms()
        ));
        assert!(pending_allowed(
            &pending("score|m|2|0"),
            &cfg,
            None,
            now_ms()
        ));
    }

    #[test]
    fn prequeued_score_and_named_notifications_coalesce_in_both_orders() {
        for score_first in [true, false] {
            let cache = crate::cache::Cache::open_in_memory();
            let mut queue = NotificationQueue::load(&cache);
            let score = "score|m|2|0";
            queue.enqueue(&cache, pending(score));
            for key in ["goal|m|first", "goal|m|second"] {
                let mut item = pending(key);
                item.score_dedup = Some(score.into());
                item.score_batch = Some("same-complete-snapshot".into());
                queue.enqueue(&cache, item);
            }
            assert_eq!(queue.pending.len(), 3);
            // Reopen the queue before and after the first send to exercise
            // persisted pending items and the persisted receipt provenance.
            let mut queue = NotificationQueue::load(&cache);
            if score_first {
                assert!(queue.attempt(&cache, score, true, || true));
                let mut queue = NotificationQueue::load(&cache);
                for key in ["goal|m|first", "goal|m|second"] {
                    assert!(!queue.attempt(&cache, key, true, || panic!("duplicate named alert")));
                }
                assert!(queue.pending.is_empty());
            } else {
                assert!(queue.attempt(&cache, "goal|m|first", true, || true));
                let mut queue = NotificationQueue::load(&cache);
                assert!(!queue.attempt(&cache, score, true, || panic!("duplicate score alert")));
                assert!(queue.attempt(&cache, "goal|m|second", true, || true));
                assert!(queue.pending.is_empty());
                let mut other_batch = pending("goal|m|third");
                other_batch.score_dedup = Some(score.into());
                other_batch.score_batch = Some("different-snapshot".into());
                queue.enqueue(&cache, other_batch);
                assert!(queue.pending.is_empty());
            }
        }
    }

    #[test]
    fn runtime_delivery_uses_enqueue_order_after_failure_and_reload() {
        let cache = crate::cache::Cache::open_in_memory();
        let mut queue = NotificationQueue::load(&cache);
        let now = now_ms();
        let keys = ["score|m|1|0", "score|m|2|0", "goal|m|z", "goal|m|a"];
        for (index, key) in keys.iter().enumerate() {
            let mut item = pending(key);
            // A wall-clock change or same-millisecond events must not reorder
            // later enqueues or reverse two goals from the same observation.
            item.created_at = now - index as i64;
            queue.enqueue(&cache, item);
        }
        let mut attempted = Vec::new();
        let delivered = queue.process(
            &cache,
            |_| true,
            |item| {
                attempted.push(item.key.clone());
                false
            },
        );
        assert!(delivered.is_empty());
        assert_eq!(attempted, vec![keys[0]]);
        assert_eq!(queue.pending.len(), keys.len());

        let mut restored = NotificationQueue::load(&cache);
        let mut sent = Vec::new();
        let delivered = restored.process(
            &cache,
            |_| true,
            |item| {
                sent.push(item.key.clone());
                true
            },
        );
        assert_eq!(sent, keys);
        assert_eq!(
            delivered
                .iter()
                .map(|item| item.key.as_str())
                .collect::<Vec<_>>(),
            keys
        );
        assert!(restored.pending.is_empty());
        let mut empty_reloaded = NotificationQueue::load(&cache);
        assert_eq!(empty_reloaded.last_sequence, 4);
        empty_reloaded.enqueue(&cache, pending("next"));
        assert_eq!(empty_reloaded.pending["next"].sequence, Some(5));
        empty_reloaded.enqueue(&cache, pending("next"));
        assert_eq!(empty_reloaded.last_sequence, 5);
        assert_eq!(
            NotificationQueue::load(&cache).pending["next"].sequence,
            Some(5)
        );
    }

    #[test]
    fn legacy_pending_entries_have_stable_timestamp_and_key_order() {
        let cache = crate::cache::Cache::open_in_memory();
        let mut later = pending("legacy-z");
        let mut earlier = pending("legacy-b");
        let mut tied = pending("legacy-a");
        let now = now_ms();
        later.created_at = now;
        earlier.created_at = now - 1;
        tied.created_at = now - 1;
        let mut legacy = serde_json::to_value(vec![later, earlier, tied]).unwrap();
        for item in legacy.as_array_mut().unwrap() {
            item.as_object_mut().unwrap().remove("sequence");
        }
        cache
            .put(PENDING_SOURCE, PENDING_PATH, &legacy, now)
            .unwrap();
        let mut queue = NotificationQueue::load(&cache);
        let mut new = pending("new");
        new.created_at = now - 2;
        queue.enqueue(&cache, new);
        let mut restored = NotificationQueue::load(&cache);
        let mut sent = Vec::new();
        restored.process(
            &cache,
            |_| true,
            |item| {
                sent.push(item.key.clone());
                true
            },
        );
        assert_eq!(sent, ["legacy-a", "legacy-b", "legacy-z", "new"]);
    }

    #[test]
    fn in_memory_score_receipt_suppresses_generic_after_failed_cache_write() {
        let cache = crate::cache::Cache::open_in_memory();
        let mut queue = NotificationQueue::load(&cache);
        let score = "score|m|2|0";
        queue.score_sent.insert(
            score.into(),
            ScoreReceipt::Named {
                batch: Some("batch".into()),
            },
        );
        queue.enqueue(&cache, pending(score));
        assert!(queue.pending.is_empty());
        let mut peer = pending("goal|m|peer");
        peer.score_dedup = Some(score.into());
        peer.score_batch = Some("batch".into());
        queue.enqueue(&cache, peer);
        assert!(queue.pending.contains_key("goal|m|peer"));
    }

    #[test]
    fn score_epoch_survives_restart_and_old_source_cannot_undo_a_correction() {
        let cache = crate::cache::Cache::open_in_memory();
        let mut tracker = ScoreTracker::default();
        let mut watch = Watch::new("m".into(), 1);
        assert_eq!(tracker.observe(&cache, "m", 0, 0, 10), Some((0, false)));
        assert!(
            advance_event_baseline(&mut watch, &[], true, true, true, Some(0), Some(0)).is_empty()
        );
        let a = goal(10, 0, 1, 1);
        assert_eq!(tracker.observe(&cache, "m", 1, 0, 20), Some((0, false)));
        let first = advance_event_baseline(&mut watch, &[a], true, true, true, Some(1), Some(0));
        let (key_a, title_a, body_a) =
            watched_goal_notification(&first[0], "m", "Home", "Away", 0).unwrap();
        let at = now_ms();
        assert!(cache
            .insert_event(&watched_event(&key_a, &title_a, &body_a, "m", at), at)
            .unwrap());
        let mut queue = NotificationQueue::load(&cache);
        let mut item_a = pending(&key_a);
        item_a.score_dedup = Some(score_key("m", 1, 0, 0));
        item_a.score_batch = Some(goal_batch(&watch.event_keys));
        queue.enqueue(&cache, item_a);
        assert!(queue.attempt(&cache, &key_a, true, || true));

        // The global endpoint sees the rollback first. A delayed detail
        // endpoint cannot undo it, even after the tracker is recreated.
        assert_eq!(tracker.observe(&cache, "m", 0, 0, 30), Some((1, true)));
        assert!(
            advance_event_baseline(&mut watch, &[], true, true, true, Some(0), Some(0)).is_empty()
        );
        let mut restarted = ScoreTracker::default();
        assert_eq!(restarted.observe(&cache, "m", 1, 0, 20), None);
        assert_eq!(restarted.observe(&cache, "m", 1, 0, 30), None);
        assert_eq!(restarted.observe(&cache, "m", 0, 0, 40), Some((1, false)));
        assert_eq!(restarted.observe(&cache, "m", 1, 0, 50), Some((1, false)));
        assert_ne!(score_key("m", 1, 0, 0), score_key("m", 1, 0, 1));

        let b = goal(20, 0, 2, 1);
        let second = advance_event_baseline(&mut watch, &[b], true, true, true, Some(1), Some(0));
        let (key_b, title_b, body_b) =
            watched_goal_notification(&second[0], "m", "Home", "Away", 1).unwrap();
        assert!(cache
            .insert_event(
                &watched_event(&key_b, &title_b, &body_b, "m", at + 1),
                at + 1
            )
            .unwrap());
        let mut item_b = pending(&key_b);
        item_b.score_dedup = Some(score_key("m", 1, 0, 1));
        item_b.score_batch = Some(goal_batch(&watch.event_keys));
        queue.enqueue(&cache, item_b);
        assert!(queue.attempt(&cache, &key_b, true, || true));
        assert_eq!(cache.list_events(at + 1).unwrap().len(), 2);

        // Neutral score events likewise have distinct event-center IDs.
        let first_score = watched_event(&score_key("m", 1, 0, 0), "Score", "1:0", "m", at + 2);
        let second_score = watched_event(&score_key("m", 1, 0, 1), "Score", "1:0", "m", at + 3);
        assert!(cache.insert_event(&first_score, at + 2).unwrap());
        assert!(cache.insert_event(&second_score, at + 3).unwrap());
        assert_eq!(cache.list_events(at + 3).unwrap().len(), 4);
    }

    #[test]
    fn complete_score_correction_cancels_only_removed_watch_goals() {
        let poller = Poller::new(Arc::new(AppStateInner {
            client: crate::bridge::http_client(),
            cache: crate::cache::Cache::open_in_memory(),
            concurrency: crate::bridge::Concurrency::new(),
        }));
        let generation = poller.watch_match("m");
        let first = event_key(&goal(12, 0, 1, 1)).unwrap();
        let removed = event_key(&goal(13, 0, 2, 1)).unwrap();
        for identity in [&first, &removed] {
            let mut item = pending(&format!("goal|m|{identity}"));
            item.target = NotificationTarget::Watch {
                match_id: "m".into(),
                generation,
            };
            poller.queue_notification(item);
        }
        for score in [1, 2] {
            let mut item = pending(&format!("score|m|{score}|0"));
            item.target = NotificationTarget::Watch {
                match_id: "m".into(),
                generation,
            };
            poller.queue_notification(item);
        }
        poller.queue_notification(pending("favorite"));
        poller.reconcile_watched_notifications(
            "m",
            generation,
            &[first.clone()].into_iter().collect(),
            Some(1),
            Some(0),
            0,
        );
        let queue = poller.notifications.lock().unwrap();
        assert!(queue.pending.contains_key(&format!("goal|m|{first}")));
        assert!(!queue.pending.contains_key(&format!("goal|m|{removed}")));
        assert!(queue.pending.contains_key("score|m|1|0"));
        assert!(!queue.pending.contains_key("score|m|2|0"));
        assert!(queue.pending.contains_key("favorite"));
        assert_eq!(
            NotificationQueue::load(&poller.state.cache).pending.len(),
            3
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

    #[test]
    fn nonretryable_background_failures_still_get_bounded_retries() {
        let failure = crate::bridge::BridgeError::Unauthorized.failure();
        assert!(!failure.retryable);
        let mut pause = BASE_TICK;
        for _ in 0..10 {
            pause = retry_delay(pause, BASE_TICK, MAX_TICK, Some(&failure));
        }
        assert_eq!(pause, MAX_TICK);
        assert_eq!(retry_delay(pause, BASE_TICK, MAX_TICK, None), BASE_TICK);
        let now = Instant::now();
        let blocked = Some((3, now + MAX_TICK));
        assert!(path_is_blocked(blocked, 3, now));
        assert!(!path_is_blocked(blocked, 3, now + MAX_TICK));
        assert!(!path_is_blocked(blocked, 4, now));
    }
}
