use tauri::{window::Color, AppHandle, Manager, Theme};
pub struct AppearanceReady(std::sync::atomic::AtomicBool);
fn apply(app: &AppHandle, scheme: &str) -> Result<(), String> {
    let light = scheme == "light";
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_theme(Some(if light { Theme::Light } else { Theme::Dark }))
            .map_err(|_| "Не удалось применить оформление окна.")?;
        window
            .set_background_color(Some(if light {
                Color(243, 246, 251, 255)
            } else {
                Color(11, 16, 28, 255)
            }))
            .map_err(|_| "Не удалось применить фон окна.")?;
    }
    Ok(())
}
pub fn setup(app: &AppHandle) {
    app.manage(AppearanceReady(std::sync::atomic::AtomicBool::new(false)));
    let scheme = app
        .path()
        .app_local_data_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("appearance.txt")).ok())
        .unwrap_or_else(|| "dark".into());
    let _ = apply(app, &scheme);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        if !app
            .state::<AppearanceReady>()
            .0
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
        }
    });
}
#[tauri::command]
pub fn apply_window_appearance(app: AppHandle, scheme: String) -> Result<(), String> {
    if scheme != "dark" && scheme != "light" {
        return Err("Неизвестная тема.".into());
    }
    apply(&app, &scheme)?;
    app.state::<AppearanceReady>()
        .0
        .store(true, std::sync::atomic::Ordering::Relaxed);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Каталог настроек недоступен.")?;
    std::fs::write(dir.join("appearance.txt"), scheme).map_err(|_| "Не удалось сохранить тему.")?;
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|_| "Не удалось открыть окно.")?;
    }
    Ok(())
}
