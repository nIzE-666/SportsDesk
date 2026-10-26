//! KinoPub device-code login and TV channel retrieval for SportsDesk desktop.
//! Protocol routes sourced from the old MIT KinoWatch project. Client config
//! (baseUrl/clientId/clientSecret) is read from kinoclient.dpapi; tokens are
//! stored in kino.dpapi. Never returns tokens to the UI. Stream URLs are kept
//! in memory only and never logged.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex as AsyncMutex;

use crate::bridge::AppStateInner;
use crate::secrets::{self, SecretName};

const REQUEST_TIMEOUT_SECS: u64 = 20;
const DEFAULT_TOKEN_TTL_SECS: i64 = 86_400;

#[derive(Debug, thiserror::Error)]
pub enum KinoError {
    #[error("Конфигурация клиента KinoPub не найдена.")]
    MissingConfig,
    #[error("Нет активной сессии KinoPub. Войдите по коду.")]
    NoSession,
    #[error("Не удалось запустить авторизацию KinoPub.")]
    StartFailed,
    #[error("Ошибка опроса авторизации KinoPub. Попробуйте ещё раз.")]
    PollFailed,
    #[error("Доступ отклонён пользователем.")]
    Denied,
    #[error("Код авторизации истёк. Запросите новый.")]
    Expired,
    #[error("Не удалось обновить сессию KinoPub. Войдите заново.")]
    RefreshFailed,
    #[error("Не удалось получить список каналов KinoPub.")]
    ChannelsFailed,
    #[error("Ошибка хранилища секретов.")]
    Secret,
    #[error("Сетевая ошибка KinoPub.")]
    Network,
}

impl KinoError {
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize)]
pub struct PollReply {
    pub pending: bool,
    pub authenticated: bool,
}

#[derive(Debug, Serialize)]
pub struct KinoChannel {
    pub id: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ClientConfig {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "clientId")]
    client_id: String,
    #[serde(rename = "clientSecret")]
    client_secret: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    base_url: String,
}

struct KinoCtx {
    client: reqwest::Client,
    store: Mutex<Option<Tokens>>,
    // Serializes refresh-token rotation so concurrent fetches cannot race it.
    refresh_guard: AsyncMutex<()>,
}

fn global() -> &'static Mutex<Option<Arc<KinoCtx>>> {
    static GLOBAL: Mutex<Option<Arc<KinoCtx>>> = Mutex::new(None);
    &GLOBAL
}

fn ctx() -> Result<Arc<KinoCtx>, KinoError> {
    let mut guard = global().lock().map_err(|_| KinoError::Network)?;
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.clone());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        // Authenticated requests: refuse redirects entirely.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("SportsDesk/1.0")
        .build()
        .map_err(|_| KinoError::Network)?;
    let created = Arc::new(KinoCtx {
        client,
        store: Mutex::new(None),
        refresh_guard: AsyncMutex::new(()),
    });
    *guard = Some(created.clone());
    Ok(created)
}

fn load_config() -> Result<ClientConfig, KinoError> {
    let raw = secrets::read_secret(SecretName::KinoClient).map_err(|_| KinoError::MissingConfig)?;
    let cfg: ClientConfig = serde_json::from_str(&raw).map_err(|_| KinoError::MissingConfig)?;
    let base = cfg.base_url.trim_end_matches('/').to_string();
    if !base.starts_with("https://") || cfg.client_id.is_empty() || cfg.client_secret.is_empty() {
        return Err(KinoError::MissingConfig);
    }
    Ok(ClientConfig {
        base_url: base,
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn load_tokens() -> Option<Tokens> {
    let raw = secrets::read_secret(SecretName::KinoTokens).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let access = v.get("access_token")?.as_str()?.to_string();
    let refresh = v.get("refresh_token")?.as_str()?.to_string();
    if access.is_empty() || refresh.is_empty() {
        return None;
    }
    let expires_at = v.get("expires_at").and_then(|x| x.as_i64()).unwrap_or(0);
    let base_url = v
        .get("baseUrl")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    Some(Tokens {
        access_token: access,
        refresh_token: refresh,
        expires_at,
        base_url,
    })
}

fn save_tokens(data: &Value, base_url: &str) -> Result<Tokens, KinoError> {
    let access = data
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or(KinoError::PollFailed)?;
    let refresh = data
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or(KinoError::PollFailed)?;
    let expires_in = data
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_TOKEN_TTL_SECS);
    let tokens = Tokens {
        access_token: access.to_string(),
        refresh_token: refresh.to_string(),
        expires_at: now_ms() + (expires_in.max(60) - 60) * 1000,
        base_url: base_url.to_string(),
    };
    let stored = serde_json::json!({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expires_at": tokens.expires_at,
        "baseUrl": tokens.base_url,
    });
    secrets::write_secret(SecretName::KinoTokens, &stored.to_string())
        .map_err(|_| KinoError::Secret)?;
    Ok(tokens)
}

async fn form_post(
    client: &reqwest::Client,
    url: &str,
    form: Vec<(&'static str, String)>,
) -> Result<reqwest::Response, KinoError> {
    client
        .post(url)
        .header("accept", "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|_| KinoError::Network)
}

pub async fn tokens_exist(_state: &Arc<AppStateInner>) -> bool {
    // Only a boolean flag reaches the UI; never the token material itself.
    load_tokens().is_some()
}

pub async fn start_auth(_state: &Arc<AppStateInner>) -> Result<DeviceCode, KinoError> {
    let cfg = load_config()?;
    let kctx = ctx()?;
    let url = format!("{}/oauth2/device", cfg.base_url);
    let res = form_post(
        &kctx.client,
        &url,
        vec![
            ("grant_type", "device_code".to_string()),
            ("client_id", cfg.client_id.clone()),
            ("client_secret", cfg.client_secret.clone()),
        ],
    )
    .await?;
    if !res.status().is_success() {
        return Err(KinoError::StartFailed);
    }
    let data: Value = res.json().await.map_err(|_| KinoError::StartFailed)?;
    let code = data
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or(KinoError::StartFailed)?;
    let user_code = data
        .get("user_code")
        .and_then(|v| v.as_str())
        .ok_or(KinoError::StartFailed)?;
    let expires_in = data
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .filter(|v| *v > 0)
        .unwrap_or(600);
    let interval = data
        .get("interval")
        .and_then(|v| v.as_u64())
        .filter(|v| *v > 0)
        .unwrap_or(5);
    Ok(DeviceCode {
        code: code.to_string(),
        user_code: user_code.to_string(),
        verification_uri: data
            .get("verification_uri")
            .and_then(|v| v.as_str())
            .unwrap_or("https://kino.pub/device")
            .to_string(),
        expires_in,
        interval,
    })
}

pub async fn poll_auth(_state: &Arc<AppStateInner>, code: &str) -> Result<PollReply, KinoError> {
    let cfg = load_config()?;
    let kctx = ctx()?;
    let url = format!("{}/oauth2/device", cfg.base_url);
    let res = form_post(
        &kctx.client,
        &url,
        vec![
            ("grant_type", "device_token".to_string()),
            ("client_id", cfg.client_id.clone()),
            ("client_secret", cfg.client_secret.clone()),
            ("code", code.to_string()),
        ],
    )
    .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let err = body.get("error").and_then(|v| v.as_str()).unwrap_or("");
        return match err {
            "authorization_pending" | "slow_down" => Ok(PollReply {
                pending: true,
                authenticated: false,
            }),
            "access_denied" => Err(KinoError::Denied),
            "expired_token" => Err(KinoError::Expired),
            // Unknown errors / 5xx / forbidden must not be silently treated as pending.
            _ => Err(KinoError::PollFailed),
        };
    }
    if body.get("access_token").is_none() || body.get("refresh_token").is_none() {
        return Ok(PollReply {
            pending: true,
            authenticated: false,
        });
    }
    let tokens = save_tokens(&body, &cfg.base_url)?;
    if let Ok(mut g) = kctx.store.lock() {
        *g = Some(tokens);
    }
    Ok(PollReply {
        pending: false,
        authenticated: true,
    })
}

/// Performs the actual refresh request. Callers must hold `refresh_guard`.
async fn refresh_locked(cfg: &ClientConfig, tokens: &Tokens) -> Result<Tokens, KinoError> {
    let kctx = ctx()?;
    let url = format!("{}/oauth2/token", cfg.base_url);
    let res = form_post(
        &kctx.client,
        &url,
        vec![
            ("grant_type", "refresh_token".to_string()),
            ("client_id", cfg.client_id.clone()),
            ("client_secret", cfg.client_secret.clone()),
            ("refresh_token", tokens.refresh_token.clone()),
        ],
    )
    .await?;
    if !res.status().is_success() {
        return Err(KinoError::RefreshFailed);
    }
    let body: Value = res.json().await.map_err(|_| KinoError::RefreshFailed)?;
    let saved = save_tokens(&body, &cfg.base_url).map_err(|_| KinoError::RefreshFailed)?;
    if let Ok(mut g) = kctx.store.lock() {
        *g = Some(saved.clone());
    }
    Ok(saved)
}

/// Called (usually after a 401 or expiry) with a token the caller observed as
/// stale. Serializes on `refresh_guard`; inside the guard we re-read the latest
/// token so a concurrent refresh is never duplicated, and a rotated token that
/// already differs from `stale` is reused instead of refreshing again.
async fn refresh_token(cfg: &ClientConfig, stale: &Tokens) -> Result<Tokens, KinoError> {
    let kctx = ctx()?;
    let _guard = kctx.refresh_guard.lock().await;
    let latest = kctx
        .store
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .or_else(load_tokens);
    if let Some(current) = latest {
        if current.refresh_token != stale.refresh_token && now_ms() < current.expires_at {
            return Ok(current);
        }
    }
    let base = load_tokens().unwrap_or_else(|| stale.clone());
    let base_url = if cfg.base_url.is_empty() {
        base.base_url.clone()
    } else {
        cfg.base_url.clone()
    };
    refresh_locked(cfg, &Tokens { base_url, ..base }).await
}

async fn active_tokens(cfg: &ClientConfig) -> Result<Tokens, KinoError> {
    let kctx = ctx()?;
    let cached = kctx.store.lock().ok().and_then(|g| g.clone());
    let tokens = match cached {
        Some(t) => t,
        None => load_tokens().ok_or(KinoError::NoSession)?,
    };
    if now_ms() < tokens.expires_at {
        return Ok(tokens);
    }
    refresh_token(cfg, &tokens).await
}

/// Returns only http(s) URLs; anything else is dropped.
fn sanitize_url(value: Option<&Value>) -> Option<String> {
    let s = value?.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    let lower = s.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Some(s.to_string())
    } else {
        None
    }
}

fn map_channel(raw: &Value) -> Option<KinoChannel> {
    let id = raw.get("id").and_then(|v| v.as_i64())?;
    if id <= 0 {
        return None;
    }
    let title = raw
        .get("title")
        .or_else(|| raw.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Канал {id}"));
    let logo = sanitize_url(
        raw.get("logos")
            .and_then(|v| v.get("m").or_else(|| v.get("s")))
            .or_else(|| raw.get("logo")),
    );
    let url = sanitize_url(raw.get("stream").or_else(|| raw.get("url")));
    Some(KinoChannel {
        id,
        title,
        logo,
        url,
    })
}

/// Accepts an array, or {"items":[...]} / {"channels":[...]} / {"data":{"items":[...]}}.
fn extract_channels(body: &Value) -> Vec<KinoChannel> {
    let raw_list = if let Some(arr) = body.as_array() {
        arr.clone()
    } else if let Some(arr) = body.get("items").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = body.get("channels").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(data) = body.get("data") {
        data.get("items")
            .and_then(|v| v.as_array())
            .or_else(|| data.get("channels").and_then(|v| v.as_array()))
            .cloned()
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    raw_list.iter().filter_map(map_channel).collect()
}

pub async fn channels(_state: &Arc<AppStateInner>) -> Result<Vec<KinoChannel>, KinoError> {
    let cfg = load_config()?;
    let kctx = ctx()?;
    let mut tokens = active_tokens(&cfg).await?;
    let mut attempt = 0;
    loop {
        let url = format!("{}/v1/tv", cfg.base_url);
        let res = kctx
            .client
            .get(&url)
            .header("accept", "application/json")
            .header("authorization", format!("Bearer {}", tokens.access_token))
            .send()
            .await
            .map_err(|_| KinoError::Network)?;
        if res.status().as_u16() == 401 && attempt == 0 {
            attempt += 1;
            tokens = refresh_token(&cfg, &tokens).await?;
            continue;
        }
        if !res.status().is_success() {
            return Err(KinoError::ChannelsFailed);
        }
        let body: Value = res.json().await.map_err(|_| KinoError::ChannelsFailed)?;
        // Stream URLs are returned to the UI in memory only.
        return Ok(extract_channels(&body));
    }
}

pub async fn logout(_state: &Arc<AppStateInner>) -> Result<(), KinoError> {
    if let Ok(g) = global().lock() {
        if let Some(ctx) = g.as_ref() {
            if let Ok(mut store) = ctx.store.lock() {
                *store = None;
            }
        }
    }
    secrets::delete_secret(SecretName::KinoTokens).map_err(|_| KinoError::Secret)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_items_envelope() {
        let body = json!({ "items": [ { "id": 1, "title": "Первый", "stream": "https://cdn.example/live.m3u8" } ] });
        let chans = extract_channels(&body);
        assert_eq!(chans.len(), 1);
        assert_eq!(chans[0].id, 1);
        assert_eq!(chans[0].title, "Первый");
        assert_eq!(
            chans[0].url.as_deref(),
            Some("https://cdn.example/live.m3u8")
        );
    }

    #[test]
    fn parses_channels_and_data_items() {
        let by_channels = json!({ "channels": [ { "id": 2, "name": "Второй" } ] });
        assert_eq!(extract_channels(&by_channels).len(), 1);
        let by_data = json!({ "data": { "items": [ { "id": 3, "title": "Третий", "logos": { "m": "https://img.example/3.png" } } ] } });
        let chans = extract_channels(&by_data);
        assert_eq!(chans.len(), 1);
        assert_eq!(chans[0].logo.as_deref(), Some("https://img.example/3.png"));
    }

    #[test]
    fn rejects_non_http_urls_and_bad_ids() {
        let body = json!({ "items": [
            { "id": 4, "title": "A", "stream": "javascript:alert(1)", "logo": "file:///etc/passwd" },
            { "title": "no id", "stream": "https://x.example/a.m3u8" },
            { "id": 5, "stream": "http://x.example/b.m3u8" }
        ] });
        let chans = extract_channels(&body);
        assert_eq!(chans.len(), 2);
        assert_eq!(chans[0].id, 4);
        assert!(chans[0].url.is_none());
        assert!(chans[0].logo.is_none());
        assert_eq!(chans[1].id, 5);
        assert_eq!(chans[1].url.as_deref(), Some("http://x.example/b.m3u8"));
        assert_eq!(chans[1].title, "Канал 5");
    }

    #[test]
    fn empty_or_malformed_body_is_empty() {
        assert!(extract_channels(&Value::Null).is_empty());
        assert!(extract_channels(&json!({ "something": 1 })).is_empty());
        assert!(extract_channels(&json!({ "data": "nope" })).is_empty());
    }
}
