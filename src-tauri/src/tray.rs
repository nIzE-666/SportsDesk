//! System tray: close-to-tray keeps the app alive so the Rust-side poller
//! continues to deliver notifications while the window is hidden.

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

#[derive(Clone, serde::Serialize)]
pub struct ScheduledEvent {
    pub id: String,
    pub title: String,
    pub start: i64,
    pub target: serde_json::Value,
}
#[derive(Default)]
pub struct TraySchedule {
    football: Vec<ScheduledEvent>,
    f1: Vec<ScheduledEvent>,
}

pub const TRAY_ID: &str = "sportsdesk-main";

/// Видимость главного окна для страницы: скрытое в трей или свёрнутое окно
/// не обязательно считается скрытым самим WebView2, а фоновый звук должен
/// остановиться. Это событие слушает `playbackContext.ts`.
pub const WINDOW_VISIBILITY_EVENT: &str = "sportsdesk://window-visibility";
static MAIN_VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Запоминает новое состояние и говорит, изменилось ли оно: одинаковые
/// состояния (например, поток событий изменения размера) не отправляются.
fn visibility_changed(last: &std::sync::atomic::AtomicBool, visible: bool) -> bool {
    last.swap(visible, std::sync::atomic::Ordering::Relaxed) != visible
}

pub fn report_window_visibility(app: &AppHandle, visible: bool) {
    if visibility_changed(&MAIN_VISIBLE, visible) {
        let _ = app.emit(
            WINDOW_VISIBILITY_EVENT,
            serde_json::json!({ "visible": visible }),
        );
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        report_window_visibility(app, true);
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    app.manage(Mutex::new(TraySchedule::default()));
    if let Ok(dir) = app.path().app_local_data_dir() {
        set_tray_mode(read_saved_mode(&dir.join("tray-settings.json")));
    }
    let show = MenuItem::with_id(app, "show", "Открыть SportsDesk", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("SportsDesk")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?,
        )
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                app.exit(0);
            }
            "mini" => {
                let a = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::open_mini_window(a).await;
                });
            }
            id => {
                let state = app.state::<Mutex<TraySchedule>>();
                let target = state.lock().ok().and_then(|s| {
                    s.football
                        .iter()
                        .chain(&s.f1)
                        .find(|e| e.id == id)
                        .map(|e| e.target.clone())
                });
                if let Some(target) = target {
                    show_main_window(app);
                    let _ = app.emit("sportsdesk://open-event", target);
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    // Close hides to tray instead of exiting; notifications keep working.
    if let Some(window) = app.get_webview_window("main") {
        let app_handle = app.clone();
        window.on_window_event(move |event| match event {
            // Only intercept when tray mode is active (default on).
            WindowEvent::CloseRequested { api, .. } if tray_mode_enabled() => {
                api.prevent_close();
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.hide();
                    report_window_visibility(&app_handle, false);
                }
            }
            // Сворачивание и восстановление приходят как изменение размера.
            WindowEvent::Resized(_) => {
                if let Some(w) = app_handle.get_webview_window("main") {
                    let hidden =
                        w.is_minimized().unwrap_or(false) || !w.is_visible().unwrap_or(true);
                    report_window_visibility(&app_handle, !hidden);
                }
            }
            _ => {}
        });
    }

    Ok(())
}

fn rebuild(app: &AppHandle, timezone: &str) {
    let state = app.state::<Mutex<TraySchedule>>();
    let Ok(state) = state.lock() else { return };
    let now = crate::cache::now_ms();
    let mut events: Vec<_> = state
        .football
        .iter()
        .chain(&state.f1)
        .filter(|e| e.start > now - 3 * 60 * 60 * 1000)
        .cloned()
        .collect();
    events.sort_by_key(|e| e.start);
    events.truncate(5);
    let Ok(menu) = Menu::new(app) else { return };
    let add = |id: &str, label: &str, enabled: bool| {
        if let Ok(item) = MenuItem::with_id(app, id, label, enabled, None::<&str>) {
            let _ = menu.append(&item);
        }
    };
    let shortcut = app
        .try_state::<crate::shortcut::ShortcutStateStore>()
        .and_then(|s| {
            s.0.lock().ok().map(|v| {
                if v.registered {
                    v.shortcut.clone()
                } else {
                    String::new()
                }
            })
        })
        .unwrap_or_default();
    let mini = if shortcut.is_empty() {
        "Live-мини".into()
    } else {
        format!("Live-мини · {shortcut}")
    };
    add("show", "Открыть SportsDesk", true);
    add("mini", &mini, true);
    add("heading", "Ближайшие события", false);
    let zone = timezone.parse::<chrono_tz::Tz>().unwrap_or(chrono_tz::UTC);
    for e in events {
        if let Some(date) = chrono::DateTime::from_timestamp_millis(e.start) {
            let label = format!(
                "{} · {}",
                date.with_timezone(&zone).format("%d.%m %H:%M"),
                e.title
            );
            add(&e.id, &label, true);
        }
    }
    if state.football.is_empty() && state.f1.is_empty() {
        add("empty", "Расписание пока не загружено", false);
    }
    add("quit", "Выход", true);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_menu(Some(menu));
    }
}
pub fn refresh(app: &AppHandle) {
    let tz = app
        .try_state::<crate::poller::PollerState>()
        .map(|s| s.0.config().timezone)
        .unwrap_or_else(|| "UTC".into());
    rebuild(app, &tz);
}
pub fn update_football(app: &AppHandle, matches: &[crate::poller::FlatMatch], timezone: &str) {
    let events = matches
        .iter()
        .filter_map(|m| {
            let start = chrono::DateTime::parse_from_rfc3339(m.time.as_deref()?)
                .ok()?
                .timestamp_millis();
            let state = crate::sports::status(&[m.status.as_deref().unwrap_or("")]);
            if state != "scheduled" && state != "live" {
                return None;
            }
            Some(ScheduledEvent {
                id: format!("match:{}", m.id),
                title: format!(
                    "{} — {}",
                    m.home.as_deref().unwrap_or("—"),
                    m.away.as_deref().unwrap_or("—")
                ),
                start,
                target: serde_json::json!({"kind":"match","matchId":m.id}),
            })
        })
        .collect();
    if let Ok(mut state) = app.state::<Mutex<TraySchedule>>().lock() {
        state.football = events;
    }
    rebuild(app, timezone);
}
pub fn update_f1(app: &AppHandle, payload: &serde_json::Value, timezone: &str) {
    let mut events = Vec::new();
    if let Some(races) = payload
        .pointer("/MRData/RaceTable/Races")
        .and_then(serde_json::Value::as_array)
    {
        for race in races {
            for (field, label) in [
                ("", "Гонка"),
                ("FirstPractice", "Практика 1"),
                ("SecondPractice", "Практика 2"),
                ("ThirdPractice", "Практика 3"),
                ("Qualifying", "Квалификация"),
                ("Sprint", "Спринт"),
                ("SprintQualifying", "Спринт-квалификация"),
            ] {
                let node = if field.is_empty() { race } else { &race[field] };
                let date = node["date"].as_str().unwrap_or("");
                let time = node["time"].as_str().unwrap_or("");
                let Ok(start) = chrono::DateTime::parse_from_rfc3339(&format!("{date}T{time}"))
                else {
                    continue;
                };
                if start.timestamp_millis() <= crate::cache::now_ms() {
                    continue;
                }
                let season = race["season"].as_str().unwrap_or("");
                let round = race["round"].as_str().unwrap_or("");
                events.push(ScheduledEvent {
                    id: format!("f1:{season}:{round}:{field}"),
                    title: format!(
                        "F1 · {} · {label}",
                        race["raceName"].as_str().unwrap_or("Гран-при")
                    ),
                    start: start.timestamp_millis(),
                    target: serde_json::json!({"kind":"f1","season":season,"round":round}),
                });
            }
        }
    }
    if let Ok(mut state) = app.state::<Mutex<TraySchedule>>().lock() {
        state.f1 = events;
    }
    rebuild(app, timezone);
}

/// Close-to-tray mode. Default enabled; kept as a simple static so the window
/// event handler can consult it without holding app state.
static TRAY_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

pub fn tray_mode_enabled() -> bool {
    TRAY_MODE.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn set_tray_mode(enabled: bool) {
    TRAY_MODE.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

fn read_saved_mode(path: &std::path::Path) -> bool {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("closeToTray").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}

pub fn save_tray_mode(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Каталог настроек недоступен.")?;
    std::fs::create_dir_all(&dir).map_err(|_| "Не удалось сохранить настройку трея.")?;
    std::fs::write(
        dir.join("tray-settings.json"),
        serde_json::json!({"closeToTray":enabled}).to_string(),
    )
    .map_err(|_| "Не удалось сохранить настройку трея.")?;
    set_tray_mode(enabled);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn visibility_is_reported_only_when_it_changes() {
        let last = std::sync::atomic::AtomicBool::new(true);
        assert!(!visibility_changed(&last, true));
        assert!(visibility_changed(&last, false));
        assert!(!visibility_changed(&last, false));
        assert!(visibility_changed(&last, true));
    }
    #[test]
    fn restores_false_and_defaults_safely_for_missing_or_corrupt_settings() {
        let dir = std::env::temp_dir().join(format!("sportsdesk-tray-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"closeToTray":false}"#).unwrap();
        assert!(!read_saved_mode(&path));
        std::fs::write(&path, "invalid").unwrap();
        assert!(read_saved_mode(&path));
        assert!(read_saved_mode(&dir.join("missing.json")));
    }
}
