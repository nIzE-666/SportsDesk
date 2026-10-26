//! User-configurable HTTPS update source. Signatures remain enforced by the
//! official updater plugin and the public key bundled with this application.
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_updater::UpdaterExt;

fn validate_source(source: &str) -> Result<Option<url::Url>, String> {
    let source = source.trim();
    if source.is_empty() {
        return Ok(None);
    }
    let url = url::Url::parse(source).map_err(|_| "Введите корректный HTTPS-адрес манифеста.")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Нужен HTTPS-адрес без логина, пароля и фрагмента.".into());
    }
    Ok(Some(url))
}

fn endpoint(app: &AppHandle) -> String {
    if let Ok(dir) = app.path().app_local_data_dir() {
        if let Ok(text) = std::fs::read_to_string(dir.join("updater-settings.json")) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                if let Some(s) = value.get("endpoint").and_then(Value::as_str) {
                    return s.to_string();
                }
            }
        }
    }
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("endpoints"))
        .and_then(Value::as_array)
        .and_then(|v| v.first())
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

#[tauri::command]
pub fn updater_settings(app: AppHandle) -> Value {
    json!({"endpoint":endpoint(&app),"version":app.package_info().version.to_string()})
}

#[tauri::command]
pub fn set_update_source(app: AppHandle, source: String) -> Result<Value, String> {
    let endpoint = validate_source(&source)?
        .map(|u| u.to_string())
        .unwrap_or_default();
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Каталог настроек недоступен.")?;
    std::fs::create_dir_all(&dir).map_err(|_| "Не удалось сохранить источник обновлений.")?;
    std::fs::write(
        dir.join("updater-settings.json"),
        json!({"endpoint":endpoint}).to_string(),
    )
    .map_err(|_| "Не удалось сохранить источник обновлений.")?;
    Ok(json!({"ok":true,"endpoint":endpoint}))
}

#[tauri::command]
pub async fn check_for_update(webview: Webview) -> Result<Option<Value>, String> {
    let url = validate_source(&endpoint(webview.app_handle()))?
        .ok_or("Источник обновлений ещё не подключён.")?;
    let updater = webview
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|_| "Некорректный источник обновлений.")?
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|_| "Не удалось подготовить проверку обновлений.")?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|_| "Источник обновлений недоступен или вернул некорректный манифест.")?
    else {
        return Ok(None);
    };
    if update.download_url.scheme() != "https" {
        return Err("Файл обновления должен загружаться по HTTPS.".into());
    }
    let mut metadata = json!({"currentVersion":update.current_version,"version":update.version,"body":update.body,"rawJson":update.raw_json});
    let rid = webview.resources_table().add(update);
    metadata["rid"] = json!(rid);
    Ok(Some(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_source_requires_https_and_can_be_disconnected() {
        assert!(validate_source("").unwrap().is_none());
        assert_eq!(
            validate_source(" https://example.com/latest.json ")
                .unwrap()
                .unwrap()
                .host_str(),
            Some("example.com")
        );
        for input in [
            "http://example.com/a",
            "file:///tmp/a",
            "https://user:pass@example.com/a",
            "https://example.com/a#x",
            "not a url",
        ] {
            assert!(validate_source(input).is_err(), "{input}");
        }
    }
}
