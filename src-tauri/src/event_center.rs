use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::bridge::AppState;
use crate::cache::{now_ms, Cache};

pub const RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub sport: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub occurred_at: i64,
    pub read: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub league_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round: Option<String>,
}

pub fn record(app: &AppHandle, cache: &Cache, event: &Event) {
    record_checked(app, cache, event);
}

/// Записывает событие и сообщает, оно ли было новым. Повторная запись того же
/// id ничего не меняет, поэтому по ответу можно решить, нужен ли праздник.
pub fn record_checked(app: &AppHandle, cache: &Cache, event: &Event) -> bool {
    let inserted = matches!(cache.insert_event(event, now_ms()), Ok(true));
    if inserted {
        let _ = app.emit("sportsdesk://events-changed", ());
    }
    inserted
}

#[tauri::command]
pub fn event_center_list(state: State<'_, AppState>) -> Result<Vec<Event>, String> {
    state.inner.cache.list_events(now_ms())
}

#[tauri::command]
pub fn event_center_mark_read(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    state.inner.cache.mark_events_read(&ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn event_roundtrip_dedup_read_and_retention() {
        let cache = Cache::open_in_memory();
        let event = Event {
            id: "a".into(),
            sport: "football".into(),
            kind: "goal".into(),
            title: "Goal".into(),
            body: "body".into(),
            occurred_at: 100,
            read: false,
            match_id: Some("m".into()),
            league_id: None,
            season: None,
            round: None,
        };
        assert!(cache.insert_event(&event, 100).unwrap());
        cache.mark_events_read(&["a".into()]).unwrap();
        assert!(!cache.insert_event(&event, 100).unwrap());
        let items = cache.list_events(100).unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].read);
        assert_eq!(items[0].match_id.as_deref(), Some("m"));
        assert!(cache.list_events(101 + RETENTION_MS).unwrap().is_empty());
        assert!(cache.mark_events_read(&vec!["a".into(); 501]).is_err());
    }
    #[test]
    fn survives_reopen_and_limits_results() {
        let dir = std::env::temp_dir().join(format!(
            "sportsdesk-events-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        {
            let cache = Cache::open(&dir).unwrap();
            for n in 0..501 {
                let event = Event {
                    id: format!("event-{n}"),
                    sport: "f1".into(),
                    kind: "reminder".into(),
                    title: "F1".into(),
                    body: "body".into(),
                    occurred_at: 1_000 + n,
                    read: false,
                    match_id: None,
                    league_id: None,
                    season: Some("2026".into()),
                    round: Some("1".into()),
                };
                cache.insert_event(&event, 2_000).unwrap();
            }
            cache.mark_events_read(&["event-500".into()]).unwrap();
        }
        {
            let cache = Cache::open(&dir).unwrap();
            let events = cache.list_events(2_000).unwrap();
            assert_eq!(events.len(), 500);
            assert_eq!(events[0].id, "event-500");
            assert!(events[0].read);
            assert_eq!(events.last().unwrap().id, "event-1");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
