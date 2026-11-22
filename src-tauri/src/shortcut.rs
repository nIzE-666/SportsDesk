use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ShortcutSettings {
    pub shortcut: String,
    pub registered: bool,
    pub error: Option<String>,
}
pub struct ShortcutStateStore(pub std::sync::Mutex<ShortcutSettings>);
fn parse_shortcut(key: &str) -> Result<Option<Shortcut>, String> {
    if key.is_empty() {
        return Ok(None);
    }
    let parsed = key
        .parse::<Shortcut>()
        .map_err(|_| "Некорректное сочетание клавиш.")?;
    if !parsed.mods.intersects(Modifiers::CONTROL | Modifiers::ALT) {
        return Err("Добавьте Ctrl или Alt к сочетанию.".into());
    }
    Ok(Some(parsed))
}
fn register(app: &AppHandle, shortcut: Option<Shortcut>) -> Result<(), String> {
    let Some(shortcut) = shortcut else {
        return Ok(());
    };
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(w) = app.get_webview_window("mini") {
                        if w.is_visible().unwrap_or(false) {
                            let _ = w.hide();
                            return;
                        }
                    }
                    let _ = crate::open_mini_window(app).await;
                });
            }
        })
        .map_err(|_| "Сочетание занято другим приложением. Выберите другое.".into())
}
pub fn setup(app: &AppHandle) {
    let key = app
        .path()
        .app_local_data_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("shortcut.json")).ok())
        .and_then(|v| serde_json::from_str::<ShortcutSettings>(&v).ok())
        .map(|v| v.shortcut)
        .unwrap_or_else(|| "Ctrl+Shift+L".into());
    let error = parse_shortcut(&key)
        .and_then(|shortcut| register(app, shortcut))
        .err();
    app.manage(ShortcutStateStore(std::sync::Mutex::new(
        ShortcutSettings {
            registered: error.is_none() && !key.is_empty(),
            shortcut: key,
            error,
        },
    )));
}
#[tauri::command]
pub fn shortcut_settings(app: AppHandle) -> ShortcutSettings {
    app.state::<ShortcutStateStore>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}
#[tauri::command]
pub fn set_shortcut(app: AppHandle, shortcut: String) -> Result<ShortcutSettings, String> {
    let state = app.state::<ShortcutStateStore>();
    let mut state = state.0.lock().map_err(|_| "Настройки недоступны.")?;
    let shortcut = shortcut.trim().to_string();
    let parsed = parse_shortcut(&shortcut)?;
    if state.registered && parsed.is_some() && parse_shortcut(&state.shortcut).ok() == Some(parsed)
    {
        return Ok(state.clone());
    }
    let next = ShortcutSettings {
        shortcut: shortcut.clone(),
        registered: !shortcut.is_empty(),
        error: None,
    };
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Каталог настроек недоступен.")?
        .join("shortcut.json");
    register(&app, parsed)?;
    if std::fs::write(
        path,
        serde_json::to_vec(&next).map_err(|_| "Ошибка настройки.")?,
    )
    .is_err()
    {
        if !shortcut.is_empty() {
            let _ = app.global_shortcut().unregister(shortcut.as_str());
        }
        return Err("Не удалось сохранить сочетание.".into());
    }
    if state.registered {
        let _ = app.global_shortcut().unregister(state.shortcut.as_str());
    }
    *state = next;
    let result = state.clone();
    drop(state);
    crate::tray::refresh(&app);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::parse_shortcut;

    #[test]
    fn accepts_case_and_modifier_aliases_for_the_same_shortcut() {
        let standard = parse_shortcut("Ctrl+Shift+L").unwrap();
        assert_eq!(parse_shortcut("ctrl+shift+l").unwrap(), standard);
        assert_eq!(parse_shortcut("Control+Shift+L").unwrap(), standard);
        assert!(parse_shortcut("Shift+L").is_err());
    }
}
