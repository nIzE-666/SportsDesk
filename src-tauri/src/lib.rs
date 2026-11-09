mod appearance;
mod backup;
mod bridge;
mod cache;
mod calendar;
mod diagnostics;
mod event_center;
mod f1_reminders;
mod history;
mod kino;
mod notification_policy;
mod poller;
mod profile;
mod secrets;
mod shortcut;
mod sports;
mod tray;
mod updates;

use bridge::{AppState, AppStateInner};
use poller::{PollConfig, Poller, PollerState};
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
async fn api_request(
    source: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<bridge::native::ApiReply, bridge::ApiFailure> {
    let inner = state.inner.clone();
    bridge::native::fetch_with_cache(inner, source, path)
        .await
        .map_err(|e| e.failure())
}

#[tauri::command]
async fn secret_status(
    state: tauri::State<'_, AppState>,
) -> Result<bridge::native::SecretStatus, String> {
    let pitch = secrets::secret_exists(secrets::SecretName::PitchApi);
    let kino = kino::tokens_exist(&state.inner).await;
    Ok(bridge::native::SecretStatus { pitch, kino })
}

#[tauri::command]
async fn set_pitch_key(
    key: String,
    poller: tauri::State<'_, PollerState>,
) -> Result<bridge::native::OkReply, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Ключ не может быть пустым.".into());
    }
    if trimmed.len() > 512 {
        return Err("Ключ слишком длинный.".into());
    }
    let value = trimmed.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        secrets::write_secret(secrets::SecretName::PitchApi, &value)
    })
    .await
    .map_err(|_| "Не удалось сохранить ключ.".to_string())?
    .map_err(|e| e.user_message())?;
    poller.0.settings_changed();
    Ok(bridge::native::OkReply { ok: true })
}

#[tauri::command]
async fn kino_begin_auth(state: tauri::State<'_, AppState>) -> Result<kino::AuthSession, String> {
    kino::begin_auth(&state.inner)
        .await
        .map_err(|e| e.user_message())
}

#[tauri::command]
async fn kino_start_auth(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<kino::DeviceCode, String> {
    kino::start_auth(&state.inner, &session_id)
        .await
        .map_err(|e| e.user_message())
}

#[tauri::command]
async fn kino_poll_auth(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<kino::PollReply, String> {
    kino::poll_auth(&state.inner, &session_id)
        .await
        .map_err(|e| e.user_message())
}

#[tauri::command]
async fn kino_commit_auth(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bridge::native::OkReply, String> {
    kino::commit_auth(&state.inner, &session_id)
        .await
        .map_err(|e| e.user_message())?;
    Ok(bridge::native::OkReply { ok: true })
}

#[tauri::command]
async fn kino_cancel_auth(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bridge::native::OkReply, String> {
    kino::cancel_auth(&state.inner, &session_id)
        .await
        .map_err(|e| e.user_message())?;
    Ok(bridge::native::OkReply { ok: true })
}

#[tauri::command]
async fn kino_finish_auth(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bridge::native::OkReply, String> {
    kino::finish_auth(&state.inner, &session_id)
        .await
        .map_err(|e| e.user_message())?;
    Ok(bridge::native::OkReply { ok: true })
}

#[tauri::command]
async fn kino_channels(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<kino::KinoChannel>, String> {
    kino::channels(&state.inner)
        .await
        .map_err(|e| e.user_message())
}

#[tauri::command]
async fn kino_logout(state: tauri::State<'_, AppState>) -> Result<bridge::native::OkReply, String> {
    kino::logout(&state.inner)
        .await
        .map_err(|e| e.user_message())?;
    Ok(bridge::native::OkReply { ok: true })
}

#[tauri::command]
async fn open_external(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let parsed = url::Url::parse(&url).map_err(|_| "Некорректная ссылка.".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Разрешены только http/https ссылки.".into()),
    }
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|_| "Не удалось открыть ссылку.".to_string())
}

#[tauri::command]
async fn send_notification(
    title: String,
    body: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| "Не удалось отправить уведомление.".to_string())
}

/// The UI pushes its notification settings + favourite team names here; the
/// Rust poller then works even when the window is hidden in the tray.
#[tauri::command]
async fn set_poller_config(
    config: PollConfig,
    state: tauri::State<'_, PollerState>,
) -> Result<bridge::native::OkReply, String> {
    state.0.set_config(config);
    Ok(bridge::native::OkReply { ok: true })
}

#[tauri::command]
async fn get_poller_config(state: tauri::State<'_, PollerState>) -> Result<PollConfig, String> {
    Ok(state.0.config())
}

#[tauri::command]
fn get_live_feed(state: tauri::State<'_, PollerState>) -> poller::LiveFeed {
    state.0.live_feed()
}

/// Close-to-tray toggle (default: on). When off, closing the window exits.
#[tauri::command]
async fn set_tray_mode(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bridge::native::OkReply, String> {
    tray::save_tray_mode(&app, enabled)?;
    Ok(bridge::native::OkReply { ok: true })
}

#[tauri::command]
fn get_tray_mode() -> bool {
    tray::tray_mode_enabled()
}

#[tauri::command]
async fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    tray::show_main_window(&app);
    Ok(())
}

/// №7: мини-окно с live-счётом поверх всех окон (без рамки, поверх, 330x460).
#[tauri::command]
async fn open_mini_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    if let Some(existing) = app.get_webview_window("mini") {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "mini", WebviewUrl::App("index.html#mini".into()))
        .title("SportsDesk · Live")
        .inner_size(330.0, 460.0)
        .min_inner_size(240.0, 300.0)
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_mini_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ----- Profile backup (№9) -----

#[tauri::command]
async fn export_profile(
    settings: Vec<(String, String)>,
    path: String,
) -> Result<bridge::native::OkReply, String> {
    if settings.is_empty() {
        return Err("Нет настроек для экспорта.".into());
    }
    let profile = profile::build_profile(&settings)?;
    profile::write_profile(&path, &profile)?;
    Ok(bridge::native::OkReply { ok: true })
}

#[tauri::command]
async fn import_profile(path: String) -> Result<profile::Profile, String> {
    profile::read_profile(&path)
}

/// The UI opened a match: the Rust side starts following it live (60s tick,
/// emits sportsdesk://match-update on changes, native goal notifications).
#[tauri::command]
async fn watch_match(
    match_id: String,
    state: tauri::State<'_, PollerState>,
) -> Result<u64, String> {
    if match_id.trim().is_empty() {
        return Err("Не указан матч.".into());
    }
    Ok(state.0.watch_match(match_id.trim()))
}

#[tauri::command]
async fn unwatch_match(
    state: tauri::State<'_, PollerState>,
) -> Result<bridge::native::OkReply, String> {
    state.0.unwatch_match();
    Ok(bridge::native::OkReply { ok: true })
}

/// Экспорт матчей в календарь: строит .ics из переданного списка и пишет по
/// выбранному в диалоге пути. Каждому событию — VALARM с напоминанием.
#[tauri::command]
async fn export_calendar(
    matches: Vec<calendar::CalendarMatch>,
    path: String,
    reminder_minutes: i64,
    state: tauri::State<'_, AppState>,
) -> Result<bridge::native::OkReply, String> {
    if matches.is_empty() {
        return Err("Список матчей пуст.".into());
    }
    if matches.len() > 500 {
        return Err("Слишком много матчей (максимум 500).".into());
    }
    let mins = reminder_minutes.clamp(0, 24 * 60);
    let content = calendar::build_ics(&state.inner, &matches, mins);
    calendar::write_ics(&path, &content)?;
    Ok(bridge::native::OkReply { ok: true })
}

// ----- Local season history (№5) -----

#[tauri::command]
async fn history_upsert(
    batch: history::HistoryUpsert,
    state: tauri::State<'_, history::HistoryState>,
) -> Result<history::HistorySeasonInfo, String> {
    if batch.matches.is_empty() {
        return Err("Пустой список матчей.".into());
    }
    if batch.matches.len() > 2000 {
        return Err("Слишком много матчей за один вызов (максимум 2000).".into());
    }
    if batch.league_id.trim().is_empty() || batch.season.trim().is_empty() {
        return Err("Не указана лига или сезон.".into());
    }
    let stored = state.0.upsert_season(&batch)?;
    Ok(history::HistorySeasonInfo {
        league_id: batch.league_id,
        league_name: batch.league_name,
        season: batch.season,
        matches: stored as i64,
    })
}

#[tauri::command]
async fn history_seasons(
    state: tauri::State<'_, history::HistoryState>,
) -> Result<Vec<history::HistorySeasonInfo>, String> {
    state.0.list_seasons()
}

#[tauri::command]
async fn history_season_matches(
    league_id: String,
    season: String,
    state: tauri::State<'_, history::HistoryState>,
) -> Result<Vec<history::HistoryMatch>, String> {
    if league_id.trim().is_empty() || season.trim().is_empty() {
        return Err("Не указана лига или сезон.".into());
    }
    state.0.season_matches(league_id.trim(), season.trim())
}

#[tauri::command]
async fn history_head_to_head(
    team_a: String,
    team_b: String,
    state: tauri::State<'_, history::HistoryState>,
) -> Result<Vec<history::HistoryMatch>, String> {
    if team_a.trim().is_empty() || team_b.trim().is_empty() {
        return Err("Не указаны команды.".into());
    }
    state.0.head_to_head(team_a.trim(), team_b.trim())
}

#[tauri::command]
async fn history_team_matches(
    team_id: String,
    finished_only: bool,
    state: tauri::State<'_, history::HistoryState>,
) -> Result<Vec<history::HistoryMatch>, String> {
    if team_id.trim().is_empty() {
        return Err("Не указана команда.".into());
    }
    state.0.team_matches(team_id.trim(), finished_only)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|e| format!("Не удалось определить каталог данных: {e}"))?;
            std::fs::create_dir_all(&data_dir)?;
            appearance::setup(app.handle());

            let cache = cache::Cache::open(&data_dir)
                .map_err(|e| format!("Не удалось открыть кеш: {e}"))?;
            let state = Arc::new(AppStateInner {
                client: bridge::http_client(),
                cache,
                concurrency: bridge::Concurrency::new(),
            });

            let poller = Arc::new(Poller::new(state.clone()));
            app.manage(AppState {
                inner: state.clone(),
            });
            app.manage(PollerState(poller.clone()));
            let history = Arc::new(history::open_history(&data_dir)?);
            app.manage(history::HistoryState(history.clone()));
            backup::start(app.handle(), data_dir.clone(), history);

            tray::setup_tray(app.handle())?;
            shortcut::setup(app.handle());

            // №8: Mica-эффект главного окна (Windows 11; на Win10 тихо пропускаем).
            // При успехе сообщаем фронту классом для полупрозрачных слоёв.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                use window_vibrancy::apply_mica;
                if apply_mica(&window, None).is_ok() {
                    if let Some(webview) = app.get_webview_window("main") {
                        let _ = webview.eval("document.documentElement.classList.add('mica')");
                    }
                }
            }

            f1_reminders::start(app.handle().clone(), poller.clone(), state);
            poller::start(app.handle().clone(), poller);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_request,
            event_center::event_center_list,
            event_center::event_center_mark_read,
            appearance::apply_window_appearance,
            secret_status,
            set_pitch_key,
            kino_begin_auth,
            kino_start_auth,
            kino_poll_auth,
            kino_commit_auth,
            kino_cancel_auth,
            kino_finish_auth,
            kino_channels,
            kino_logout,
            open_external,
            send_notification,
            set_poller_config,
            get_poller_config,
            get_live_feed,
            shortcut::shortcut_settings,
            shortcut::set_shortcut,
            set_tray_mode,
            get_tray_mode,
            updates::updater_settings,
            updates::set_update_source,
            updates::check_for_update,
            show_window,
            watch_match,
            unwatch_match,
            export_calendar,
            history_upsert,
            history_seasons,
            history_season_matches,
            history_head_to_head,
            history_team_matches,
            open_mini_window,
            close_mini_window,
            export_profile,
            import_profile,
            backup::backup_settings,
            backup::sync_profile,
            backup::provide_backup_profile,
            backup::configure_backup,
            backup::create_backup,
            backup::prepare_backup_restore,
            backup::commit_backup_restore,
            backup::cancel_backup_restore,
            diagnostics::read_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SportsDesk");
}
