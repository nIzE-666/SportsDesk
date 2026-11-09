//! Upstream API bridge: strict per-source base URL whitelist, path validation,
//! bounded downloads, TLS verification, SQLite-backed cache, and concurrency
//! limits (OpenF1: >=500ms spacing and <=30/min, waiting rather than failing
//! for a normal small batch so parallel resource loads all succeed).

pub mod native {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ApiReply {
        pub payload: serde_json::Value,
        pub source: String,
        #[serde(rename = "fetchedAt")]
        pub fetched_at: String,
        pub stale: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub failure: Option<super::ApiFailure>,
    }

    #[derive(Debug, Serialize)]
    pub struct SecretStatus {
        pub pitch: bool,
        pub kino: bool,
        #[serde(rename = "kinoClient")]
        pub kino_client: bool,
    }

    #[derive(Debug, Serialize)]
    pub struct OkReply {
        pub ok: bool,
    }

    pub use crate::bridge::fetch_with_cache;
}

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::{Mutex as AsyncMutex, Semaphore, SemaphorePermit};
use tokio::time::{sleep, timeout_at, Instant};

use crate::cache::{now_ms, Cache};
use crate::secrets::{self, SecretName};

/// Shared application state. Uses the Tauri-managed async runtime; no nested
/// Tokio runtime is created or stored here.
pub struct AppStateInner {
    pub client: reqwest::Client,
    pub cache: Cache,
    pub concurrency: Concurrency,
}

pub struct AppState {
    pub inner: Arc<AppStateInner>,
}

const MAX_RESPONSE_BYTES: usize = 12 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// OpenF1 free tier: max 3 requests/second and 30 requests/minute.
const OPENF1_MIN_INTERVAL: Duration = Duration::from_millis(500);
const OPENF1_PER_MINUTE: usize = 30;
const OPENF1_MAX_WAIT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, thiserror::Error)]
pub enum BridgeError {
    #[error("Неизвестный источник данных.")]
    UnknownSource,
    #[error("Недопустимый путь запроса.")]
    InvalidPath,
    #[error("Ключ PitchAPI не настроен. Добавьте ключ в настройках.")]
    MissingKey,
    #[error("Сохранённый ключ PitchAPI не удалось прочитать или расшифровать. Введите ключ заново в настройках под текущей учётной записью Windows.")]
    KeyUnreadable,
    #[error("Провайдер отклонил доступ. Проверьте ключ или сессию.")]
    Unauthorized,
    #[error("Запрошенные данные не найдены у провайдера.")]
    NotFound,
    #[error("Провайдер ограничил запросы. Попробуйте позже.")]
    RateLimited,
    #[error("Провайдер не ответил вовремя.")]
    Timeout,
    #[error("Ответ провайдера слишком большой.")]
    TooLarge,
    #[error("Провайдер вернул не-JSON ответ.")]
    BadPayload,
    #[error("Данные провайдера временно недоступны.")]
    Upstream,
    #[error("Некорректная конфигурация.")]
    Config,
}

impl BridgeError {
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}
impl BridgeError {
    pub fn failure(&self) -> ApiFailure {
        let code = match self {
            Self::UnknownSource => "UnknownSource",
            Self::InvalidPath => "InvalidPath",
            Self::MissingKey => "MissingKey",
            Self::KeyUnreadable => "KeyUnreadable",
            Self::Unauthorized => "Unauthorized",
            Self::NotFound => "NotFound",
            Self::RateLimited => "RateLimited",
            Self::Timeout => "Timeout",
            Self::TooLarge => "TooLarge",
            Self::BadPayload => "BadPayload",
            Self::Upstream => "Upstream",
            Self::Config => "Config",
        };
        ApiFailure {
            code: code.into(),
            message: self.user_message(),
            retryable: matches!(self, Self::Timeout | Self::RateLimited | Self::Upstream),
        }
    }
}

fn base_for(source: &str) -> Option<&'static str> {
    match source {
        "pitch" => Some("https://api.pitchapi.dev/v1/"),
        "sportscore" => Some("https://sportscore.com/api/widget/"),
        "espn" => Some("https://site.api.espn.com/apis/site/v2/sports/soccer/"),
        "jolpica" => Some("https://api.jolpi.ca/ergast/f1/"),
        "openf1" => Some("https://api.openf1.org/v1/"),
        _ => None,
    }
}

/// Reject %2e/%2f/%5c/%25 encoded traversal on the lowecased path portion,
/// examined BEFORE the query string so real query values such as
/// `season=2026%2F2027` remain valid.
fn has_encoded_traversal(path: &str) -> bool {
    let cut = path.find('?').unwrap_or(path.len());
    let lowered = path[..cut].to_ascii_lowercase();
    lowered.contains("%2e")
        || lowered.contains("%2f")
        || lowered.contains("%5c")
        || lowered.contains("%25")
}

/// Validates a RELATIVE path: no scheme, no leading slash, no traversal, no
/// backslashes, no control/whitespace characters.
fn valid_relative_path(path: &str) -> bool {
    if path.is_empty() || path.len() > 2048 {
        return false;
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return false;
    }
    if path.contains("..") || path.contains('\\') || path.contains("//") {
        return false;
    }
    if has_encoded_traversal(path) {
        return false;
    }
    if let Some(colon) = path.find(':') {
        let before = &path[..colon];
        if !before.contains('/') {
            return false;
        }
    }
    path.chars().all(|c| !c.is_control() && !c.is_whitespace())
}

fn build_url(source: &str, path: &str) -> Result<url::Url, BridgeError> {
    let base = base_for(source).ok_or(BridgeError::UnknownSource)?;
    if !valid_relative_path(path) {
        return Err(BridgeError::InvalidPath);
    }
    let base_url = url::Url::parse(base).map_err(|_| BridgeError::Config)?;
    let joined = base_url.join(path).map_err(|_| BridgeError::InvalidPath)?;
    // Defense in depth: final URL must stay under the source prefix.
    if joined.origin() != base_url.origin() {
        return Err(BridgeError::InvalidPath);
    }
    if !joined.path().starts_with(base_url.path()) {
        return Err(BridgeError::InvalidPath);
    }
    Ok(joined)
}

/// Rate readiness is awaited without holding the shared network semaphore.
/// A grant is committed only after preflight and acquisition, immediately before
/// the request attempt. Waiting/cancellation/semaphore errors spend no budget.
pub struct Concurrency {
    openf1: AsyncMutex<OpenF1Budget>,
    sem: Semaphore,
    inflight: AtomicU32,
    waiting_openf1: AtomicU32,
    flights: Arc<FlightRegistry>,
}
struct OpenF1Budget {
    timestamps: Vec<Instant>,
    last: Option<Instant>,
}
impl OpenF1Budget {
    fn wait_at(&mut self, now: Instant) -> Duration {
        self.timestamps
            .retain(|t| now.saturating_duration_since(*t) < Duration::from_secs(60));
        let spacing = self
            .last
            .map(|last| (last + OPENF1_MIN_INTERVAL).saturating_duration_since(now))
            .unwrap_or_default();
        let minute = if self.timestamps.len() >= OPENF1_PER_MINUTE {
            (self.timestamps[0] + Duration::from_secs(60)).saturating_duration_since(now)
        } else {
            Duration::ZERO
        };
        spacing.max(minute)
    }
}
struct CounterGuard<'a>(&'a AtomicU32);
impl<'a> CounterGuard<'a> {
    fn new(counter: &'a AtomicU32) -> Self {
        counter.fetch_add(1, Ordering::Relaxed);
        Self(counter)
    }
}
impl Drop for CounterGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}
pub struct RequestPermit<'a> {
    _semaphore: SemaphorePermit<'a>,
    _active: CounterGuard<'a>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcurrencySnapshot {
    pub inflight: u32,
    pub openf1_waiting: u32,
    pub openf1_recent: usize,
    pub openf1_next_ms: u64,
}
impl Concurrency {
    pub fn new() -> Self {
        Self {
            openf1: AsyncMutex::new(OpenF1Budget {
                timestamps: Vec::new(),
                last: None,
            }),
            sem: Semaphore::new(4),
            inflight: AtomicU32::new(0),
            waiting_openf1: AtomicU32::new(0),
            flights: Arc::new(FlightRegistry::default()),
        }
    }
    async fn wait_openf1(&self, deadline: Instant) -> Result<(), BridgeError> {
        loop {
            if Instant::now() > deadline {
                return Err(BridgeError::RateLimited);
            }
            let wait = self.openf1.lock().await.wait_at(Instant::now());
            if wait.is_zero() {
                return Ok(());
            }
            if Instant::now() + wait > deadline {
                return Err(BridgeError::RateLimited);
            }
            sleep(wait.max(Duration::from_millis(1))).await;
        }
    }
    pub async fn acquire_request(&self, source: &str) -> Result<RequestPermit<'_>, BridgeError> {
        let deadline = Instant::now() + OPENF1_MAX_WAIT;
        let _waiting = (source == "openf1").then(|| CounterGuard::new(&self.waiting_openf1));
        loop {
            if source == "openf1" {
                self.wait_openf1(deadline).await?;
            }
            let semaphore = if source == "openf1" {
                timeout_at(deadline, self.sem.acquire())
                    .await
                    .map_err(|_| BridgeError::RateLimited)?
                    .map_err(|_| BridgeError::Upstream)?
            } else {
                self.sem
                    .acquire()
                    .await
                    .map_err(|_| BridgeError::Upstream)?
            };
            if source == "openf1" {
                let mut budget = self.openf1.lock().await;
                let now = Instant::now();
                if now > deadline {
                    return Err(BridgeError::RateLimited);
                }
                if !budget.wait_at(now).is_zero() {
                    drop(budget);
                    drop(semaphore);
                    continue;
                }
                budget.timestamps.push(now);
                budget.last = Some(now);
            }
            return Ok(RequestPermit {
                _semaphore: semaphore,
                _active: CounterGuard::new(&self.inflight),
            });
        }
    }
    pub fn inflight(&self) -> u32 {
        self.inflight.load(Ordering::Relaxed)
    }
    pub async fn snapshot(&self) -> ConcurrencySnapshot {
        let mut budget = self.openf1.lock().await;
        let wait = budget.wait_at(Instant::now());
        ConcurrencySnapshot {
            inflight: self.inflight(),
            openf1_waiting: self.waiting_openf1.load(Ordering::Relaxed),
            openf1_recent: budget.timestamps.len(),
            openf1_next_ms: wait.as_millis() as u64,
        }
    }
}

fn pitch_date_ttl(path: &str, payload: &Value, now: i64) -> i64 {
    let day = path
        .strip_prefix("date/")
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    let Ok(date) = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d") else {
        return 60_000;
    };
    let Some(today) = chrono::DateTime::from_timestamp_millis(now).map(|d| d.date_naive()) else {
        return 60_000;
    };
    if date == today {
        return 60_000;
    }
    let Some(fixtures) = payload
        .get("data")
        .unwrap_or(payload)
        .get("matches")
        .and_then(Value::as_array)
    else {
        return 60_000;
    };
    let statuses: Vec<_> = fixtures
        .iter()
        .map(|m| crate::sports::status(&[m.get("status").and_then(Value::as_str).unwrap_or("")]))
        .collect();
    if statuses.contains(&"live") {
        return 60_000;
    }
    if date > today {
        return 15 * 60_000;
    }
    // Delayed or unclassified games remain fresh after midnight.
    if statuses
        .iter()
        .all(|s| ["finished", "cancelled", "postponed"].contains(s))
    {
        10 * 60_000
    } else {
        60_000
    }
}

fn ttl_ms(source: &str, path: &str, payload: &Value) -> i64 {
    if source == "pitch" && path.starts_with("date/") {
        return pitch_date_ttl(path, payload, now_ms());
    }
    let p = path.to_ascii_lowercase();
    if source == "openf1" {
        return 24 * 60 * 60 * 1000;
    }
    if p.contains("standing") {
        return 15 * 60 * 1000;
    }
    if source == "sportscore" && (p.contains("premier-league") || p.contains("spanish-la-liga")) {
        return 15 * 60 * 1000;
    }
    if source == "espn" && (p.contains("scoreboard") || p.contains("matches")) {
        return 60 * 1000;
    }
    if source == "sportscore" && p.contains("match") {
        return 60 * 1000;
    }
    if let Some(state) = payload
        .get("data")
        .unwrap_or(payload)
        .get("status")
        .and_then(|v| v.as_str())
    {
        if crate::sports::status(&[state]) == "live" {
            return 60 * 1000;
        }
    }
    if source == "pitch"
        && p.starts_with("matches/")
        && ["/players", "/stats", "/lineups", "/events"]
            .iter()
            .any(|part| p.contains(part))
    {
        return 60 * 1000;
    }
    if p.contains("matches")
        || p.contains("results")
        || p.contains("schedule")
        || p.contains("calendar")
        || p.contains("qualifying")
    {
        return 15 * 60 * 1000;
    }
    5 * 60 * 1000
}

fn iso_utc_from_ms(ms: i64) -> String {
    let total_secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = total_secs.div_euclid(86_400);
    let secs_of_day = total_secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let hh = secs_of_day / 3600;
    let mm = (secs_of_day % 3600) / 60;
    let ss = secs_of_day % 60;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, hh, mm, ss, millis
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    // Howard Hinnant's algorithm.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(Duration::from_secs(10))
        // Never follow redirects with API credentials attached.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("SportsDesk/1.0 (+personal desktop app)")
        .build()
        .expect("failed to build reqwest client")
}

async fn fetch_upstream(
    state: &AppStateInner,
    source: &str,
    path: &str,
) -> Result<Value, BridgeError> {
    let url = build_url(source, path)?;
    // Disk/DPAPI preflight is off the async worker and precedes all grants.
    let key = if source == "pitch" {
        Some(
            tauri::async_runtime::spawn_blocking(|| secrets::read_secret(SecretName::PitchApi))
                .await
                .map_err(|_| BridgeError::KeyUnreadable)?
                .map_err(|error| match error {
                    secrets::SecretError::NotFound => BridgeError::MissingKey,
                    secrets::SecretError::Unsupported => BridgeError::Config,
                    _ => BridgeError::KeyUnreadable,
                })?,
        )
    } else {
        None
    };
    let mut request = state.client.get(url).header("accept", "application/json");
    if let Some(key) = key {
        request = request.header("x-api-key", key);
    }
    let request = request.build().map_err(|_| BridgeError::Config)?;
    let _permit = state.concurrency.acquire_request(source).await?;
    // From this point we attempt the network. Failed network attempts remain in
    // the rate ledger: bytes may have reached the provider before the timeout.
    let mut res = state.client.execute(request).await.map_err(|e| {
        if e.is_timeout() {
            BridgeError::Timeout
        } else {
            BridgeError::Upstream
        }
    })?;
    match res.status().as_u16() {
        200..=299 => {}
        401 | 403 => return Err(BridgeError::Unauthorized),
        404 => return Err(BridgeError::NotFound),
        400 | 422 => return Err(BridgeError::InvalidPath),
        429 => return Err(BridgeError::RateLimited),
        _ => return Err(BridgeError::Upstream),
    }
    if res
        .content_length()
        .is_some_and(|n| n > MAX_RESPONSE_BYTES as u64)
    {
        return Err(BridgeError::TooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| {
        if e.is_timeout() {
            BridgeError::Timeout
        } else {
            BridgeError::Upstream
        }
    })? {
        if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(bytes.len()) {
            return Err(BridgeError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| BridgeError::BadPayload)
}

type FetchResult = Result<native::ApiReply, BridgeError>;
type FetchFuture = Pin<Box<dyn Future<Output = FetchResult> + Send>>;
type RequestKey = (String, String);

#[derive(Default)]
struct FlightRegistry {
    // Weak entries are removed as soon as the last caller drops its flight.
    flights: Mutex<HashMap<RequestKey, Weak<Flight>>>,
}

impl FlightRegistry {
    fn join_or_create(
        self: &Arc<Self>,
        key: RequestKey,
        create: impl FnOnce() -> FetchFuture,
    ) -> Arc<Flight> {
        let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(flight) = flights.get(&key).and_then(Weak::upgrade) {
            return flight;
        }
        let flight = Arc::new(Flight {
            key: key.clone(),
            registry: Arc::downgrade(self),
            state: AsyncMutex::new(FlightState {
                future: Some(create()),
                result: None,
            }),
        });
        flights.insert(key, Arc::downgrade(&flight));
        flight
    }
}

struct FlightState {
    future: Option<FetchFuture>,
    result: Option<FetchResult>,
}

struct Flight {
    key: RequestKey,
    registry: Weak<FlightRegistry>,
    state: AsyncMutex<FlightState>,
}

impl Flight {
    async fn result(&self) -> FetchResult {
        let mut state = self.state.lock().await;
        if let Some(result) = &state.result {
            return result.clone();
        }
        // The future lives in the flight, not the caller driving it. If that
        // caller is cancelled, another waiter can continue polling it.
        let result = state.future.as_mut().expect("unfinished flight").await;
        state.future = None;
        state.result = Some(result.clone());
        result
    }
}

impl Drop for Flight {
    fn drop(&mut self) {
        if let Some(registry) = self.registry.upgrade() {
            let mut flights = registry.flights.lock().unwrap_or_else(|e| e.into_inner());
            // A new flight may already have replaced this dying weak entry.
            if flights
                .get(&self.key)
                .is_some_and(|entry| entry.strong_count() == 0)
            {
                flights.remove(&self.key);
            }
        }
    }
}

pub async fn fetch_with_cache(
    state: Arc<AppStateInner>,
    source: String,
    path: String,
) -> Result<native::ApiReply, BridgeError> {
    fetch_with_cache_using(state, source, path, |state, source, path| async move {
        fetch_upstream(&state, &source, &path).await
    })
    .await
}

// The injected fetch also lets tests exercise the actual cache/flight path
// without depending on providers, credentials, or network timing.
async fn fetch_with_cache_using<F, Fut>(
    state: Arc<AppStateInner>,
    source: String,
    path: String,
    fetch: F,
) -> FetchResult
where
    F: FnOnce(Arc<AppStateInner>, String, String) -> Fut + Send + 'static,
    Fut: Future<Output = Result<Value, BridgeError>> + Send + 'static,
{
    if base_for(&source).is_none() {
        return Err(BridgeError::UnknownSource);
    }
    if !valid_relative_path(&path) {
        return Err(BridgeError::InvalidPath);
    }

    let registry = Arc::clone(&state.concurrency.flights);
    let key = (source.clone(), path.clone());
    let flight = registry.join_or_create(key, || {
        Box::pin(async move {
            if let Some(row) = state.cache.get(&source, &path) {
                let ttl = ttl_ms(&source, &path, &row.payload);
                if now_ms() - row.fetched_at_ms < ttl {
                    return Ok(native::ApiReply {
                        payload: row.payload,
                        source,
                        fetched_at: iso_utc_from_ms(row.fetched_at_ms),
                        stale: false,
                        failure: None,
                    });
                }
            }

            match fetch(Arc::clone(&state), source.clone(), path.clone()).await {
                Ok(payload) => {
                    let fetched = now_ms();
                    let _ = state.cache.put(&source, &path, &payload, fetched);
                    if let Ok(mut stamp) = LAST_PRUNE.lock() {
                        let due = stamp
                            .map(|t: i64| now_ms() - t > 6 * 60 * 60 * 1000)
                            .unwrap_or(true);
                        if due {
                            state.cache.prune(now_ms() - 30 * 24 * 60 * 60 * 1000);
                            *stamp = Some(now_ms());
                        }
                    }
                    Ok(native::ApiReply {
                        payload,
                        source,
                        fetched_at: iso_utc_from_ms(fetched),
                        stale: false,
                        failure: None,
                    })
                }
                Err(err) => {
                    crate::diagnostics::record(&source, &path, &err);
                    if let Some(row) = state.cache.get(&source, &path) {
                        if now_ms() - row.fetched_at_ms < 24 * 60 * 60 * 1000 {
                            return Ok(native::ApiReply {
                                payload: row.payload,
                                source,
                                fetched_at: iso_utc_from_ms(row.fetched_at_ms),
                                stale: true,
                                failure: Some(err.failure()),
                            });
                        }
                    }
                    Err(err)
                }
            }
        })
    });
    flight.result().await
}

static LAST_PRUNE: Mutex<Option<i64>> = Mutex::new(None);

#[cfg(test)]
mod runtime_tests {
    use super::*;
    #[test]
    fn adjacent_day_cache_policy_matches_frontend_and_handles_midnight() {
        let cases: Value =
            serde_json::from_str(include_str!("../../src/shared/pitchDateCacheCases.json"))
                .unwrap();
        for case in cases.as_array().unwrap() {
            let now = chrono::DateTime::parse_from_rfc3339(case["now"].as_str().unwrap())
                .unwrap()
                .timestamp_millis();
            let matches: Vec<_> = case["statuses"]
                .as_array()
                .unwrap()
                .iter()
                .map(|status| serde_json::json!({"status":status}))
                .collect();
            assert_eq!(
                pitch_date_ttl(
                    case["path"].as_str().unwrap(),
                    &serde_json::json!({"data":{"matches":matches}}),
                    now
                ),
                case["ttl"].as_i64().unwrap(),
                "{case}"
            );
        }
        assert_eq!(
            pitch_date_ttl(
                "date/2020-01-01",
                &serde_json::json!({"data":{}}),
                1_700_000_000_000
            ),
            60_000
        );
    }
    fn run(future: impl std::future::Future<Output = ()>) {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future);
    }

    fn test_state() -> Arc<AppStateInner> {
        Arc::new(AppStateInner {
            client: http_client(),
            cache: Cache::open_in_memory(),
            concurrency: Concurrency::new(),
        })
    }

    fn registry_len(state: &AppStateInner) -> usize {
        state.concurrency.flights.flights.lock().unwrap().len()
    }

    async fn wait_for_callers(state: &AppStateInner, source: &str, path: &str, count: usize) {
        let key = (source.to_string(), path.to_string());
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let callers = state
                    .concurrency
                    .flights
                    .flights
                    .lock()
                    .unwrap()
                    .get(&key)
                    .map_or(0, Weak::strong_count);
                if callers >= count {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("callers joined flight");
    }

    #[test]
    fn identical_cache_misses_share_a_reply_and_other_keys_progress() {
        run(async {
            let state = test_state();
            let calls = Arc::new(AtomicU32::new(0));
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel();
            let first_calls = calls.clone();
            let first = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "leagues".into(),
                move |_, _, _| async move {
                    first_calls.fetch_add(1, Ordering::Relaxed);
                    started_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    Ok(serde_json::json!({"version": 1}))
                },
            ));
            started_rx.await.unwrap();

            let second_calls = calls.clone();
            let second = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "leagues".into(),
                move |_, _, _| async move {
                    second_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(serde_json::json!({"version": 2}))
                },
            ));
            wait_for_callers(&state, "pitch", "leagues", 2).await;

            // Both parts of the key matter, and neither request waits for the
            // blocked flight above.
            for (source, path) in [("pitch", "teams"), ("espn", "leagues")] {
                let reply = tokio::time::timeout(
                    Duration::from_secs(2),
                    fetch_with_cache_using(
                        state.clone(),
                        source.into(),
                        path.into(),
                        |_, _, _| async { Ok(serde_json::json!({"independent": true})) },
                    ),
                )
                .await
                .unwrap()
                .unwrap();
                assert_eq!(reply.payload["independent"], true);
            }
            assert!(!first.is_finished());
            assert!(!second.is_finished());
            release_tx.send(()).unwrap();
            let first = first.await.unwrap().unwrap();
            let second = second.await.unwrap().unwrap();
            assert_eq!(
                serde_json::to_value(&first).unwrap(),
                serde_json::to_value(&second).unwrap()
            );
            assert_eq!(first.payload["version"], 1);
            assert!(!first.stale);
            assert!(first.failure.is_none());
            assert_eq!(calls.load(Ordering::Relaxed), 1);
            assert_eq!(
                state.cache.get("pitch", "leagues").unwrap().payload,
                first.payload
            );
            assert_eq!(registry_len(&state), 0);

            let cached = fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "leagues".into(),
                |_, _, _| async { panic!("fresh cache must be checked before fetch") },
            )
            .await
            .unwrap();
            assert_eq!(
                serde_json::to_value(&cached).unwrap(),
                serde_json::to_value(first).unwrap()
            );
            assert_eq!(registry_len(&state), 0);
        });
    }

    #[test]
    fn coalescing_spends_one_openf1_grant() {
        run(async {
            tokio::time::pause();
            let state = test_state();
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel();
            let first = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "openf1".into(),
                "sessions".into(),
                move |state, source, _| async move {
                    let _permit = state.concurrency.acquire_request(&source).await?;
                    started_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    Ok(serde_json::json!({"session": 1}))
                },
            ));
            started_rx.await.unwrap();
            let second = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "openf1".into(),
                "sessions".into(),
                move |state, source, _| async move {
                    let _permit = state.concurrency.acquire_request(&source).await?;
                    Ok(serde_json::json!({"session": 2}))
                },
            ));
            wait_for_callers(&state, "openf1", "sessions", 2).await;
            assert_eq!(state.concurrency.snapshot().await.openf1_recent, 1);
            assert_eq!(state.concurrency.inflight(), 1);
            release_tx.send(()).unwrap();
            assert_eq!(first.await.unwrap().unwrap().payload["session"], 1);
            assert_eq!(second.await.unwrap().unwrap().payload["session"], 1);
            assert_eq!(state.concurrency.snapshot().await.openf1_recent, 1);
            assert_eq!(state.concurrency.inflight(), 0);
            assert_eq!(registry_len(&state), 0);
        });
    }

    #[test]
    fn callers_on_multiple_threads_share_one_flight() {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let state = test_state();
                let calls = Arc::new(AtomicU32::new(0));
                let (started_tx, started_rx) = tokio::sync::oneshot::channel();
                let (release_tx, release_rx) = tokio::sync::oneshot::channel();
                let first_calls = calls.clone();
                let first = tokio::spawn(fetch_with_cache_using(
                    state.clone(),
                    "pitch".into(),
                    "leagues".into(),
                    move |_, _, _| async move {
                        first_calls.fetch_add(1, Ordering::Relaxed);
                        started_tx.send(()).unwrap();
                        release_rx.await.unwrap();
                        Ok(serde_json::json!({"shared": true}))
                    },
                ));
                started_rx.await.unwrap();
                let mut waiters = Vec::new();
                for _ in 0..31 {
                    let calls = calls.clone();
                    waiters.push(tokio::spawn(fetch_with_cache_using(
                        state.clone(),
                        "pitch".into(),
                        "leagues".into(),
                        move |_, _, _| async move {
                            calls.fetch_add(1, Ordering::Relaxed);
                            Ok(serde_json::json!({"shared": false}))
                        },
                    )));
                }
                wait_for_callers(&state, "pitch", "leagues", 32).await;
                release_tx.send(()).unwrap();
                assert_eq!(first.await.unwrap().unwrap().payload["shared"], true);
                for waiter in waiters {
                    assert_eq!(waiter.await.unwrap().unwrap().payload["shared"], true);
                }
                assert_eq!(calls.load(Ordering::Relaxed), 1);
                assert_eq!(registry_len(&state), 0);
            });
    }

    #[test]
    fn failures_and_stale_fallback_are_shared_then_can_retry() {
        run(async {
            let state = test_state();
            let stale_at = now_ms() - 10 * 60_000;
            let stale_payload = serde_json::json!({"cached": true});
            state
                .cache
                .put("pitch", "leagues", &stale_payload, stale_at)
                .unwrap();
            let calls = Arc::new(AtomicU32::new(0));
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel();
            let first_calls = calls.clone();
            let first = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "leagues".into(),
                move |state, source, _| async move {
                    let _permit = state.concurrency.acquire_request(&source).await?;
                    first_calls.fetch_add(1, Ordering::Relaxed);
                    started_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    Err(BridgeError::Timeout)
                },
            ));
            started_rx.await.unwrap();
            let second_calls = calls.clone();
            let second = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "leagues".into(),
                move |_, _, _| async move {
                    second_calls.fetch_add(1, Ordering::Relaxed);
                    Err(BridgeError::Unauthorized)
                },
            ));
            wait_for_callers(&state, "pitch", "leagues", 2).await;
            release_tx.send(()).unwrap();
            let first = first.await.unwrap().unwrap();
            let second = second.await.unwrap().unwrap();
            assert_eq!(
                serde_json::to_value(&first).unwrap(),
                serde_json::to_value(second).unwrap()
            );
            assert_eq!(first.payload, stale_payload);
            assert_eq!(first.fetched_at, iso_utc_from_ms(stale_at));
            assert!(first.stale);
            assert_eq!(first.failure.unwrap().code, "Timeout");
            assert_eq!(calls.load(Ordering::Relaxed), 1);
            assert_eq!(registry_len(&state), 0);

            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel();
            let first_calls = calls.clone();
            let first = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "missing".into(),
                move |_, _, _| async move {
                    first_calls.fetch_add(1, Ordering::Relaxed);
                    started_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    Err(BridgeError::NotFound)
                },
            ));
            started_rx.await.unwrap();
            let second_calls = calls.clone();
            let second = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "missing".into(),
                move |_, _, _| async move {
                    second_calls.fetch_add(1, Ordering::Relaxed);
                    Err(BridgeError::Timeout)
                },
            ));
            wait_for_callers(&state, "pitch", "missing", 2).await;
            release_tx.send(()).unwrap();
            assert!(matches!(first.await.unwrap(), Err(BridgeError::NotFound)));
            assert!(matches!(second.await.unwrap(), Err(BridgeError::NotFound)));
            assert_eq!(calls.load(Ordering::Relaxed), 2);
            assert_eq!(registry_len(&state), 0);

            let retry = fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "missing".into(),
                |_, _, _| async { Ok(serde_json::json!({"retried": true})) },
            )
            .await
            .unwrap();
            assert_eq!(retry.payload["retried"], true);
            assert_eq!(registry_len(&state), 0);
        });
    }

    #[test]
    fn cancellation_transfers_a_flight_or_drops_it_when_no_waiters_remain() {
        run(async {
            let state = test_state();
            let calls = Arc::new(AtomicU32::new(0));
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel();
            let first_calls = calls.clone();
            let first = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "leagues".into(),
                move |state, source, _| async move {
                    let _permit = state.concurrency.acquire_request(&source).await?;
                    first_calls.fetch_add(1, Ordering::Relaxed);
                    started_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    Ok(serde_json::json!({"continued": true}))
                },
            ));
            started_rx.await.unwrap();
            let second_calls = calls.clone();
            let second = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "leagues".into(),
                move |_, _, _| async move {
                    second_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(serde_json::json!({"unexpected": true}))
                },
            ));
            wait_for_callers(&state, "pitch", "leagues", 2).await;
            first.abort();
            assert!(first.await.unwrap_err().is_cancelled());
            assert_eq!(state.concurrency.inflight(), 1);
            release_tx.send(()).unwrap();
            let result = second.await.unwrap().unwrap();
            assert_eq!(result.payload["continued"], true);
            assert_eq!(calls.load(Ordering::Relaxed), 1);
            assert_eq!(state.concurrency.inflight(), 0);
            assert_eq!(registry_len(&state), 0);

            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel();
            let abandoned = tokio::spawn(fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "teams".into(),
                move |state, source, _| async move {
                    let _permit = state.concurrency.acquire_request(&source).await?;
                    started_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    Ok(serde_json::json!({"unexpected": true}))
                },
            ));
            started_rx.await.unwrap();
            abandoned.abort();
            assert!(abandoned.await.unwrap_err().is_cancelled());
            assert!(release_tx.send(()).is_err());
            assert_eq!(state.concurrency.inflight(), 0);
            assert_eq!(registry_len(&state), 0);
            let retry = fetch_with_cache_using(
                state.clone(),
                "pitch".into(),
                "teams".into(),
                |_, _, _| async { Ok(serde_json::json!({"retried": true})) },
            )
            .await
            .unwrap();
            assert_eq!(retry.payload["retried"], true);
            assert_eq!(registry_len(&state), 0);
        });
    }

    #[test]
    fn flights_are_scoped_to_state_and_registry_does_not_grow() {
        run(async {
            let first_state = test_state();
            let second_state = test_state();
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel();
            let first = tokio::spawn(fetch_with_cache_using(
                first_state.clone(),
                "pitch".into(),
                "leagues".into(),
                move |_, _, _| async move {
                    started_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    Ok(serde_json::json!({"state": 1}))
                },
            ));
            started_rx.await.unwrap();
            let second = tokio::time::timeout(
                Duration::from_secs(2),
                fetch_with_cache_using(
                    second_state.clone(),
                    "pitch".into(),
                    "leagues".into(),
                    |_, _, _| async { Ok(serde_json::json!({"state": 2})) },
                ),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(second.payload["state"], 2);
            release_tx.send(()).unwrap();
            assert_eq!(first.await.unwrap().unwrap().payload["state"], 1);

            for index in 0..100 {
                fetch_with_cache_using(
                    first_state.clone(),
                    "pitch".into(),
                    format!("key/{index}"),
                    |_, _, _| async { Ok(serde_json::json!({"ok": true})) },
                )
                .await
                .unwrap();
                assert_eq!(registry_len(&first_state), 0);
            }
            assert_eq!(registry_len(&second_state), 0);
        });
    }
    #[test]
    fn openf1_waiters_do_not_occupy_football_or_jolpica_slots() {
        run(async {
            tokio::time::pause();
            let c = Arc::new(Concurrency::new());
            {
                let mut budget = c.openf1.lock().await;
                budget.timestamps = vec![Instant::now(); 30];
                budget.last = Some(Instant::now());
            }
            let mut tasks = Vec::new();
            for _ in 0..4 {
                let c = c.clone();
                tasks.push(tokio::spawn(async move {
                    let _p = c.acquire_request("openf1").await;
                }));
            }
            tokio::task::yield_now().await;
            assert_eq!(c.snapshot().await.openf1_waiting, 4);
            let football =
                tokio::time::timeout(Duration::from_millis(1), c.acquire_request("pitch"))
                    .await
                    .unwrap()
                    .unwrap();
            let jolpica =
                tokio::time::timeout(Duration::from_millis(1), c.acquire_request("jolpica"))
                    .await
                    .unwrap()
                    .unwrap();
            assert_eq!(c.inflight(), 2);
            drop(football);
            drop(jolpica);
            for task in tasks {
                task.abort();
                let _ = task.await;
            }
            assert_eq!(c.inflight(), 0);
            assert_eq!(c.snapshot().await.openf1_waiting, 0);
        });
    }
    #[test]
    fn cancelled_preflight_and_closed_semaphore_spend_no_openf1_budget() {
        run(async {
            tokio::time::pause();
            let c = Arc::new(Concurrency::new());
            let mut held = Vec::new();
            for _ in 0..4 {
                held.push(c.acquire_request("pitch").await.unwrap());
            }
            let other = c.clone();
            let waiting = tokio::spawn(async move {
                let _p = other.acquire_request("openf1").await;
            });
            tokio::task::yield_now().await;
            assert_eq!(c.snapshot().await.openf1_recent, 0);
            waiting.abort();
            let _ = waiting.await;
            drop(held);
            c.sem.close();
            assert!(c.acquire_request("openf1").await.is_err());
            assert_eq!(c.snapshot().await.openf1_recent, 0);
            assert_eq!(c.inflight(), 0);
        });
    }
    #[test]
    fn actual_grants_remain_spaced_after_semaphore_congestion() {
        run(async {
            tokio::time::pause();
            let c = Arc::new(Concurrency::new());
            let mut held = Vec::new();
            for _ in 0..4 {
                held.push(c.acquire_request("pitch").await.unwrap());
            }
            let a = c.clone();
            let b = c.clone();
            let first = tokio::spawn(async move {
                let _p = a.acquire_request("openf1").await.unwrap();
            });
            let second = tokio::spawn(async move {
                let _p = b.acquire_request("openf1").await.unwrap();
            });
            tokio::task::yield_now().await;
            tokio::time::advance(Duration::from_secs(2)).await;
            assert_eq!(c.snapshot().await.openf1_recent, 0);
            drop(held);
            tokio::task::yield_now().await;
            tokio::task::yield_now().await;
            assert_eq!(c.snapshot().await.openf1_recent, 1);
            tokio::time::advance(OPENF1_MIN_INTERVAL).await;
            first.await.unwrap();
            second.await.unwrap();
            let budget = c.openf1.lock().await;
            assert_eq!(budget.timestamps.len(), 2);
            assert!(
                budget.timestamps[1].duration_since(budget.timestamps[0]) >= OPENF1_MIN_INTERVAL
            );
        });
    }
    #[test]
    fn inflight_counter_is_released_on_error_and_task_cancellation() {
        run(async {
            let c = Arc::new(Concurrency::new());
            let result: Result<(), BridgeError> = async {
                let _p = c.acquire_request("pitch").await?;
                Err(BridgeError::MissingKey)
            }
            .await;
            assert!(result.is_err());
            assert_eq!(c.inflight(), 0);
            let (tx, rx) = tokio::sync::oneshot::channel();
            let other = c.clone();
            let task = tokio::spawn(async move {
                let _p = other.acquire_request("jolpica").await.unwrap();
                let _ = tx.send(());
                std::future::pending::<()>().await;
            });
            rx.await.unwrap();
            assert_eq!(c.inflight(), 1);
            task.abort();
            let _ = task.await;
            assert_eq!(c.inflight(), 0);
        });
    }
    #[test]
    fn retry_policy_and_nested_live_ttl_are_explicit() {
        for error in [
            BridgeError::Timeout,
            BridgeError::RateLimited,
            BridgeError::Upstream,
        ] {
            assert!(error.failure().retryable);
        }
        for error in [
            BridgeError::MissingKey,
            BridgeError::KeyUnreadable,
            BridgeError::Unauthorized,
            BridgeError::InvalidPath,
            BridgeError::BadPayload,
            BridgeError::NotFound,
            BridgeError::TooLarge,
        ] {
            assert!(!error.failure().retryable);
        }
        assert_eq!(BridgeError::MissingKey.failure().code, "MissingKey");
        assert_eq!(
            ttl_ms(
                "pitch",
                "matches/test",
                &serde_json::json!({"data":{"status":"live"}})
            ),
            60_000
        );
        assert_eq!(
            ttl_ms(
                "pitch",
                "matches/test/players",
                &serde_json::json!({"data":[]})
            ),
            60_000
        );
    }
}

#[cfg(test)]
mod acceptance_tests {
    use super::*;

    #[test]
    fn source_urls_allow_encoded_seasons_but_reject_traversal() {
        assert!(build_url(
            "pitch",
            "leagues/l_0ErfuF/matches?season=2026%2F2027&status=all"
        )
        .is_ok());
        for path in [
            "https://example.com/",
            "../secrets",
            "%2e%2e/secrets",
            "/leagues",
            "leagues/%2fsecret",
        ] {
            assert!(build_url("pitch", path).is_err());
        }
        assert!(build_url("unknown", "leagues").is_err());
    }

    #[test]
    fn timestamps_are_iso_dates() {
        assert_eq!(iso_utc_from_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso_utc_from_ms(1_700_000_000_123),
            "2023-11-14T22:13:20.123Z"
        );
    }

    #[test]
    #[ignore = "Uses the configured personal providers and Windows DPAPI"]
    fn windows_real_provider_acceptance() {
        assert!(secrets::read_secret(SecretName::PitchApi)
            .map(|s| !s.is_empty())
            .unwrap_or(false));
        assert!(secrets::read_secret(SecretName::KinoClient)
            .map(|s| serde_json::from_str::<Value>(&s).is_ok())
            .unwrap_or(false));
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("acceptance-cache");
        std::fs::create_dir_all(&dir).unwrap();
        let state = Arc::new(AppStateInner {
            client: http_client(),
            cache: Cache::open(&dir).unwrap(),
            concurrency: Concurrency::new(),
        });
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let football = fetch_with_cache(state.clone(), "pitch".into(), "leagues".into())
                .await
                .expect("native PitchAPI request");
            assert!(football.payload["data"]["leagues"]
                .as_array()
                .map(|a| a.iter().any(|l| l["id"] == "l_0bfbkO"))
                .unwrap_or(false));
            let f1 = fetch_with_cache(
                state.clone(),
                "jolpica".into(),
                "current/driverStandings.json".into(),
            )
            .await
            .expect("native Jolpica request");
            assert!(f1.payload["MRData"]["StandingsTable"]["StandingsLists"]
                .as_array()
                .map(|a| !a.is_empty())
                .unwrap_or(false));
            assert!(football.fetched_at.ends_with('Z'));
        });
    }
}
