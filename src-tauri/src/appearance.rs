use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{window::Color, AppHandle, Manager, Theme};

struct Appearance {
    revealed: AtomicBool,
    mica: bool,
}

pub fn mark_main_revealed(app: &AppHandle) {
    app.state::<Appearance>()
        .revealed
        .store(true, Ordering::Relaxed);
}

fn reveal_at_startup(app: &AppHandle) -> Result<(), String> {
    if !app
        .state::<Appearance>()
        .revealed
        .swap(true, Ordering::Relaxed)
    {
        if let Some(window) = app.get_webview_window("main") {
            window.show().map_err(|_| "Не удалось открыть окно.")?;
            crate::tray::report_window_visibility(app, true);
        }
    }
    Ok(())
}

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
    #[cfg(windows)]
    let mica = app
        .get_webview_window("main")
        .is_some_and(|window| window_vibrancy::apply_mica(&window, None).is_ok());
    #[cfg(not(windows))]
    let mica = false;

    app.manage(Appearance {
        revealed: AtomicBool::new(false),
        mica,
    });
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
        let _ = reveal_at_startup(&app);
    });
}
#[tauri::command]
pub fn apply_window_appearance(app: AppHandle, scheme: String) -> Result<(), String> {
    if scheme != "dark" && scheme != "light" {
        return Err("Неизвестная тема.".into());
    }
    apply(&app, &scheme)?;
    if app.state::<Appearance>().mica {
        if let Some(window) = app.get_webview_window("main") {
            // The page has mounted when it requests its initial appearance.
            let _ = window.eval("document.documentElement.classList.add('mica')");
        }
    }
    reveal_at_startup(&app)?;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Каталог настроек недоступен.")?;
    std::fs::write(dir.join("appearance.txt"), scheme).map_err(|_| "Не удалось сохранить тему.")?;
    Ok(())
}
