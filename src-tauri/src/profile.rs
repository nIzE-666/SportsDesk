//! Profile backup (№9): one-file export/import of every non-secret user
//! setting (favourite teams/players, appearance, league and cup selections,
//! timezone, notification settings). Secrets (PitchAPI key, Kino tokens)
//! are deliberately NOT included: they are DPAPI-bound and must be re-entered
//! on the new machine.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub app: String,
    pub version: u32,
    pub exported_at: String,
    /// localStorage keys -> values (non-secret only, allowlist enforced).
    pub settings: std::collections::BTreeMap<String, String>,
}

/// Only these key prefixes/values are exported; anything else (tokens,
/// session ids) is rejected so a future key cannot leak by accident.
pub fn is_allowed_key(key: &str) -> bool {
    let Some(name) = key.strip_prefix("sportsdesk.") else {
        return false;
    };
    let lower = name.to_ascii_lowercase();
    if [
        "token",
        "secret",
        "apikey",
        "api_key",
        "password",
        "credential",
    ]
    .iter()
    .any(|part| lower.contains(part))
    {
        return false;
    }
    [
        "scheme",
        "design",
        "sport",
        "league",
        "density",
        "timezone",
        "sidebar.collapsed",
        "tray.mode",
        "whatsnew.seen",
        "planner.priorities",
        "hero.compact",
        "notifications",
    ]
    .contains(&name)
        || [
            "football.",
            "f1.",
            "view.",
            "cup.",
            "ucl.",
            "notifications.",
            "watch.favorites",
            "watch.recent",
            "watch.view",
            "watch.preferred",
        ]
        .iter()
        .any(|p| name.starts_with(p))
}

pub fn build_profile(settings: &[(String, String)]) -> Result<Profile, String> {
    let mut map = std::collections::BTreeMap::new();
    for (k, v) in settings {
        if !is_allowed_key(k) {
            return Err(format!("Ключ '{k}' не разрешён для экспорта."));
        }
        if k.len() > 128 || v.len() > 200_000 {
            return Err(format!("Слишком большое значение для '{k}'."));
        }
        map.insert(k.clone(), v.clone());
    }
    if map.is_empty() {
        return Err("Нет настроек для экспорта.".into());
    }
    if map.len() > 200 {
        return Err("Слишком много настроек (максимум 200).".into());
    }
    if map.iter().map(|(k, v)| k.len() + v.len()).sum::<usize>() > 1_500_000 {
        return Err("Профиль превышает допустимый размер.".into());
    }
    Ok(Profile {
        app: "SportsDesk".into(),
        version: 1,
        exported_at: now_iso(),
        settings: map,
    })
}

pub fn write_profile(path: &str, profile: &Profile) -> Result<(), String> {
    let p = Path::new(path);
    if p.extension()
        .and_then(|e| e.to_str())
        .map(|e| !e.eq_ignore_ascii_case("json"))
        .unwrap_or(true)
    {
        return Err("Файл должен иметь расширение .json".into());
    }
    let text = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
    std::fs::write(p, text).map_err(|e| format!("Не удалось записать файл: {e}"))
}

pub fn read_profile(path: &str) -> Result<Profile, String> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    if text.len() > 2_000_000 {
        return Err("Файл профиля слишком большой.".into());
    }
    let profile: Profile = serde_json::from_str(&text)
        .map_err(|_| "Файл не является профилем SportsDesk.".to_string())?;
    if profile.app != "SportsDesk" {
        return Err("Файл другого приложения.".into());
    }
    if profile.version != 1 {
        return Err(format!(
            "Неподдерживаемая версия профиля: {}.",
            profile.version
        ));
    }
    if profile.settings.is_empty() {
        return Err("Профиль не содержит настроек.".into());
    }
    if profile.settings.len() > 200 {
        return Err("Профиль содержит слишком много настроек.".into());
    }
    for (k, v) in &profile.settings {
        if !is_allowed_key(k) {
            return Err(format!("Ключ '{k}' не разрешён для импорта."));
        }
        if k.len() > 128 || v.len() > 200_000 {
            return Err(format!("Слишком большое значение для '{k}'."));
        }
    }
    Ok(profile)
}

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    crate::cache::iso_utc_ms(ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_and_roundtrip_profile() {
        let settings = vec![
            (
                "sportsdesk.football.favorites.teams".to_string(),
                "{\"ids\":[\"t1\"]}".to_string(),
            ),
            ("sportsdesk.scheme".to_string(), "light".to_string()),
        ];
        let profile = build_profile(&settings).unwrap();
        assert_eq!(profile.app, "SportsDesk");
        assert_eq!(profile.settings.len(), 2);

        let dir = std::env::temp_dir().join(format!("sd-profile-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("profile.json");
        write_profile(path.to_str().unwrap(), &profile).unwrap();
        let back = read_profile(path.to_str().unwrap()).unwrap();
        assert_eq!(back.settings.get("sportsdesk.scheme").unwrap(), "light");
    }

    #[test]
    fn rejects_wrong_extension_and_foreign_files() {
        let dir = std::env::temp_dir().join(format!("sd-profile-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = build_profile(&vec![("sportsdesk.scheme".into(), "dark".into())]).unwrap();
        assert!(write_profile(dir.join("profile.txt").to_str().unwrap(), &p).is_err());
        std::fs::write(
            dir.join("foreign.json"),
            "{\"app\":\"Other\",\"version\":1,\"settings\":{\"a\":\"b\"}}",
        )
        .unwrap();
        assert!(read_profile(dir.join("foreign.json").to_str().unwrap()).is_err());
    }

    #[test]
    fn forbidden_keys_are_rejected() {
        // Keys outside the allowlist cannot be smuggled in.
        assert!(build_profile(&vec![("evil.token".into(), "x".into())]).is_err());
        assert!(!is_allowed_key("evil"));
        assert!(is_allowed_key("sportsdesk.scheme"));
        assert!(is_allowed_key("sportsdesk.design"));
    }
}
