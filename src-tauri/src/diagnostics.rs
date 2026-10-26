use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
};
#[derive(Clone, Serialize)]
pub struct Entry {
    at: i64,
    source: String,
    resource: String,
    code: String,
}
static ENTRIES: OnceLock<Mutex<VecDeque<Entry>>> = OnceLock::new();
pub fn record(source: &str, path: &str, error: &crate::bridge::BridgeError) {
    if let Ok(mut entries) = ENTRIES.get_or_init(Default::default).lock() {
        if entries.len() >= 50 {
            entries.pop_front();
        }
        entries.push_back(Entry {
            at: crate::cache::now_ms(),
            source: source.into(),
            resource: path
                .split('?')
                .next()
                .unwrap_or("")
                .chars()
                .take(160)
                .collect(),
            code: error.failure().code,
        });
    }
}
pub fn entries() -> Vec<Entry> {
    ENTRIES
        .get_or_init(Default::default)
        .lock()
        .map(|v| v.iter().cloned().collect())
        .unwrap_or_default()
}
#[tauri::command]
pub async fn read_diagnostics(
    state: tauri::State<'_, crate::bridge::AppState>,
) -> Result<serde_json::Value, String> {
    Ok(
        serde_json::json!({"runtime":"Windows / Tauri","network":state.inner.concurrency.snapshot().await,"cache":state.inner.cache.diagnostics(),"errors":entries()}),
    )
}
