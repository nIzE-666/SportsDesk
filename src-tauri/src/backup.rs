//! Daily, atomic profile + consistent SQLite snapshots. No credentials.
use crate::{
    history::History,
    profile::{build_profile, Profile},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager};
const MAX_BYTES: u64 = 96 * 1024 * 1024;
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BackupSettings {
    pub enabled: bool,
    pub folder: Option<String>,
    pub last_at: Option<i64>,
    pub last_file: Option<String>,
    pub error: Option<String>,
    pub next_attempt: Option<i64>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    app: String,
    version: u32,
    profile: Profile,
    history_sqlite: String,
    history_sha256: String,
}
pub struct BackupState {
    dir: PathBuf,
    settings: Mutex<BackupSettings>,
    operation: Mutex<()>,
}
fn digest(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!("pending-{}", crate::cache::now_ms()));
    let result = (|| {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|_| "Не удалось создать файл в выбранной папке.")?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|_| "Не удалось записать резервную копию.")?;
        std::fs::rename(&tmp, path).map_err(|_| "Не удалось завершить запись файла.")
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    Ok(result?)
}
impl BackupState {
    pub fn new(dir: PathBuf) -> Self {
        let settings = std::fs::read(dir.join("backup-settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self {
            dir,
            settings: Mutex::new(settings),
            operation: Mutex::new(()),
        }
    }
    fn persist(&self, s: &BackupSettings) -> Result<(), String> {
        atomic(
            &self.dir.join("backup-settings.json"),
            &serde_json::to_vec(s).map_err(|_| "Настройки не читаются.")?,
        )
    }
    pub fn settings(&self) -> BackupSettings {
        self.settings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    pub fn mirror(&self, entries: Vec<(String, String)>) -> Result<(), String> {
        let p = build_profile(&entries)?;
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Копирование уже выполняется.")?;
        atomic(
            &self.dir.join("profile-mirror.json"),
            &serde_json::to_vec(&p).map_err(|_| "Профиль недоступен.")?,
        )
    }
    fn create(&self, history: &History) -> Result<String, String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Копирование уже выполняется.")?;
        let settings = self.settings();
        let folder = PathBuf::from(
            settings
                .folder
                .ok_or("Выберите папку для резервных копий.")?,
        );
        if !folder.is_absolute() || !folder.is_dir() {
            return Err("Выбранная папка недоступна.".into());
        }
        let profile = crate::profile::read_profile(
            self.dir
                .join("profile-mirror.json")
                .to_str()
                .ok_or("Путь недоступен.")?,
        )?;
        let snapshot = self.dir.join("backup-snapshot.sqlite3");
        let _ = std::fs::remove_file(&snapshot);
        history.snapshot(&snapshot)?;
        let bytes = std::fs::read(&snapshot).map_err(|_| "Снимок истории недоступен.")?;
        let _ = std::fs::remove_file(snapshot);
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("История превышает 64 МБ.".into());
        }
        let bundle = Bundle {
            app: "SportsDesk".into(),
            version: 2,
            profile,
            history_sha256: digest(&bytes),
            history_sqlite: base64::engine::general_purpose::STANDARD.encode(bytes),
        };
        let name = format!("sportsdesk-backup-{}.sdbackup.json", crate::cache::now_ms());
        let path = folder.join(name);
        atomic(
            &path,
            &serde_json::to_vec(&bundle).map_err(|_| "Не удалось собрать копию.")?,
        )?;
        // Only our complete backup files, never pending files or other documents.
        let mut owned: Vec<_> = std::fs::read_dir(&folder)
            .map_err(|_| "Папка недоступна.")?
            .filter_map(Result::ok)
            .filter(|e| {
                e.file_type().map(|t| t.is_file()).unwrap_or(false)
                    && e.file_name()
                        .to_str()
                        .map(|n| {
                            n.starts_with("sportsdesk-backup-") && n.ends_with(".sdbackup.json")
                        })
                        .unwrap_or(false)
            })
            .map(|e| e.path())
            .collect();
        owned.sort();
        let remove = owned.len().saturating_sub(7);
        for old in owned.into_iter().take(remove) {
            let _ = std::fs::remove_file(old);
        }
        let mut s = self.settings.lock().map_err(|_| "Настройки недоступны.")?;
        s.last_at = Some(crate::cache::now_ms());
        s.last_file = Some(path.to_string_lossy().into_owned());
        s.error = None;
        s.next_attempt = None;
        self.persist(&s)?;
        Ok(path.to_string_lossy().into_owned())
    }
    fn restore(&self, history: &History, path: &str) -> Result<Profile, String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Копирование уже выполняется.")?;
        if std::fs::metadata(path)
            .map_err(|_| "Файл недоступен.")?
            .len()
            > MAX_BYTES
        {
            return Err("Файл слишком большой.".into());
        }
        let text = std::fs::read(path).map_err(|_| "Файл не читается.")?;
        let value: serde_json::Value =
            serde_json::from_slice(&text).map_err(|_| "Некорректный файл копии.")?;
        if value.get("version").and_then(|v| v.as_u64()) == Some(1) {
            return crate::profile::read_profile(path);
        }
        let b: Bundle =
            serde_json::from_value(value).map_err(|_| "Неподдерживаемая резервная копия.")?;
        if b.app != "SportsDesk"
            || b.version != 2
            || b.profile.app != "SportsDesk"
            || b.profile.version != 1
        {
            return Err("Неподдерживаемая резервная копия.".into());
        }
        build_profile(
            &b.profile
                .settings
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<Vec<_>>(),
        )?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&b.history_sqlite)
            .map_err(|_| "Повреждена история в копии.")?;
        if bytes.len() > 64 * 1024 * 1024 || digest(&bytes) != b.history_sha256 {
            return Err("Контрольная сумма истории не совпадает.".into());
        }
        let tmp = self.dir.join("restore-snapshot.sqlite3");
        std::fs::write(&tmp, bytes).map_err(|_| "Не удалось подготовить историю.")?;
        let result = history.restore_snapshot(&tmp);
        let _ = std::fs::remove_file(tmp);
        result?;
        Ok(b.profile)
    }
}
#[tauri::command]
pub fn backup_settings(state: tauri::State<'_, Arc<BackupState>>) -> BackupSettings {
    state.settings()
}
#[tauri::command]
pub async fn sync_profile(
    settings: Vec<(String, String)>,
    state: tauri::State<'_, Arc<BackupState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.mirror(settings))
        .await
        .map_err(|_| "Ошибка профиля.")?
}
#[tauri::command]
pub fn configure_backup(
    folder: Option<String>,
    enabled: bool,
    state: tauri::State<'_, Arc<BackupState>>,
) -> Result<BackupSettings, String> {
    if let Some(folder) = &folder {
        if !Path::new(folder).is_absolute() || !Path::new(folder).is_dir() {
            return Err("Выберите существующую папку.".into());
        }
    }
    if enabled && folder.is_none() {
        return Err("Сначала выберите папку.".into());
    }
    let mut s = state.settings.lock().map_err(|_| "Настройки недоступны.")?;
    let next = BackupSettings {
        enabled,
        folder,
        error: None,
        next_attempt: None,
        ..s.clone()
    };
    state.persist(&next)?;
    *s = next.clone();
    Ok(next)
}
#[tauri::command]
pub async fn create_backup(
    state: tauri::State<'_, Arc<BackupState>>,
    history: tauri::State<'_, crate::history::HistoryState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    let h = history.0.clone();
    tauri::async_runtime::spawn_blocking(move || state.create(&h))
        .await
        .map_err(|_| "Ошибка копирования.")?
}
#[tauri::command]
pub async fn restore_backup(
    path: String,
    state: tauri::State<'_, Arc<BackupState>>,
    history: tauri::State<'_, crate::history::HistoryState>,
) -> Result<Profile, String> {
    let state = state.inner().clone();
    let h = history.0.clone();
    tauri::async_runtime::spawn_blocking(move || state.restore(&h, &path))
        .await
        .map_err(|_| "Ошибка восстановления.")?
}
pub fn start(app: &AppHandle, dir: PathBuf, history: Arc<History>) {
    let state = Arc::new(BackupState::new(dir));
    app.manage(state.clone());
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let s = state.settings();
            let now = crate::cache::now_ms();
            if s.enabled
                && s.folder.is_some()
                && s.next_attempt.is_none_or(|t| now >= t)
                && s.last_at
                    .map(|t| now - t >= 24 * 60 * 60 * 1000)
                    .unwrap_or(true)
            {
                let b = state.clone();
                let h = history.clone();
                if let Ok(Err(error)) =
                    tauri::async_runtime::spawn_blocking(move || b.create(&h)).await
                {
                    if let Ok(mut s) = state.settings.lock() {
                        s.error = Some(error);
                        s.next_attempt = Some(crate::cache::now_ms() + 60 * 60 * 1000);
                        let _ = state.persist(&s);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(name: &str) -> (BackupState, History, PathBuf) {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("backup-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let folder = dir.join("copies");
        std::fs::create_dir_all(&folder).unwrap();
        let b = BackupState::new(dir.clone());
        *b.settings.lock().unwrap() = BackupSettings {
            folder: Some(folder.to_string_lossy().into_owned()),
            ..Default::default()
        };
        b.mirror(vec![("sportsdesk.scheme".into(), "light".into())])
            .unwrap();
        let history = History::open(&dir).unwrap();
        (b, history, folder)
    }
    #[test]
    fn full_backup_restores_wal_snapshot_and_profile_and_rejects_corruption() {
        let (b, h, folder) = fixture("roundtrip");
        let batch = crate::history::HistoryUpsert {
            league_id: "l_test".into(),
            league_name: "Test".into(),
            season: "2030".into(),
            matches: vec![crate::history::HistoryMatchIn {
                id: "m_test".into(),
                home_id: "t_a".into(),
                home_name: "A".into(),
                away_id: "t_b".into(),
                away_name: "B".into(),
                home_score: Some(2),
                away_score: Some(1),
                status: "finished".into(),
                date: "2030-01-01".into(),
                round: "1".into(),
            }],
        };
        h.upsert_season(&batch).unwrap();
        let path = b.create(&h).unwrap();
        let mut newer = batch;
        newer.matches[0].home_score = Some(9);
        h.upsert_season(&newer).unwrap();
        let p = b.restore(&h, &path).unwrap();
        assert_eq!(p.settings["sportsdesk.scheme"], "light");
        assert_eq!(h.team_matches("t_a", true).unwrap()[0].home_score, 2);
        let mut bad: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        bad["historySha256"] = "bad".into();
        let badpath = folder.join("bad.json");
        std::fs::write(&badpath, serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(b.restore(&h, badpath.to_str().unwrap()).is_err());
        assert_eq!(h.team_matches("t_a", true).unwrap()[0].home_score, 2);
        bad["profile"]["settings"]["sportsdesk.api_key"] = "SHOULD_NOT_IMPORT".into();
        assert!(
            crate::profile::build_profile(&vec![("sportsdesk.api_key".into(), "x".into())])
                .is_err()
        );
    }
    #[test]
    fn rotation_keeps_seven_and_legacy_profile_is_supported() {
        let (b, h, folder) = fixture("rotation");
        std::fs::write(folder.join("personal.json"), "untouched").unwrap();
        for _ in 0..9 {
            b.create(&h).unwrap();
        }
        let count = std::fs::read_dir(&folder)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".sdbackup.json"))
            .count();
        assert_eq!(count, 7);
        assert!(folder.join("personal.json").exists());
        let legacy = b.dir.join("profile-mirror.json");
        assert_eq!(b.restore(&h, legacy.to_str().unwrap()).unwrap().version, 1);
    }
}
