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
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};
const MAX_BYTES: u64 = 96 * 1024 * 1024;
type ProfileEntries = Vec<(String, String)>;
type ProfileRequest = (u64, tokio::sync::oneshot::Sender<ProfileEntries>);
type ProfileResponse = (u64, tokio::sync::oneshot::Receiver<ProfileEntries>);
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
    pending: Mutex<Option<PendingRestore>>,
    next_restore: AtomicU64,
    mirror_error: Mutex<Option<String>>,
    next_request: AtomicU64,
    profile_request: Mutex<Option<ProfileRequest>>,
}
struct PendingRestore {
    id: u64,
    started: std::time::Instant,
    profile: Profile,
    previous_profile: Profile,
    history: Option<Vec<u8>>,
    history_generation: u64,
    source: String,
    safety_file: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRestore {
    id: u64,
    profile: Profile,
    safety_file: String,
    safety_warning: Option<String>,
}
const JOURNAL_FILE: &str = "restore-journal.json";
const JOURNAL_VERSION: u32 = 1;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum JournalStage {
    /// The mirror and history may be half-way between the old and the new state.
    Committing,
    /// Native data is restored; the webview still has to apply `profile`.
    Committed,
    /// The commit failed cleanly; the webview has to return to `previous_profile`.
    RolledBack,
}
/// On-disk record of a restore in progress. It survives crashes so the next
/// start can either finish the restore or undo it from the safety copy.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreJournal {
    version: u32,
    id: u64,
    stage: JournalStage,
    created_at: i64,
    source: String,
    safety_file: String,
    profile: Profile,
    previous_profile: Profile,
}
impl RestoreJournal {
    fn new(plan: &PendingRestore, stage: JournalStage) -> Self {
        Self {
            version: JOURNAL_VERSION,
            id: plan.id,
            stage,
            created_at: crate::cache::now_ms(),
            source: plan.source.clone(),
            safety_file: plan.safety_file.clone(),
            profile: plan.profile.clone(),
            previous_profile: plan.previous_profile.clone(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredRestore {
    id: u64,
    profile: Profile,
    completed: bool,
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
fn rotate(
    folder: &Path,
    created: &Path,
    protected: Option<&Path>,
    mut remove_file: impl FnMut(&Path) -> std::io::Result<()>,
) -> Option<String> {
    let mut issues = Vec::new();
    let mut owned = Vec::new();
    match std::fs::read_dir(folder) {
        Ok(entries) => {
            for entry in entries {
                match entry {
                    Ok(entry) => match entry.file_type() {
                        Ok(kind)
                            if kind.is_file()
                                && entry.file_name().to_str().is_some_and(|name| {
                                    name.starts_with("sportsdesk-backup-")
                                        && name.ends_with(".sdbackup.json")
                                }) =>
                        {
                            owned.push(entry.path())
                        }
                        Ok(_) => {}
                        Err(error) => issues.push(format!("{}: {error}", entry.path().display())),
                    },
                    Err(error) => issues.push(error.to_string()),
                }
            }
        }
        Err(error) => issues.push(error.to_string()),
    }
    owned.sort();
    let remove = owned.len().saturating_sub(7);
    let protected = protected.and_then(|p| p.canonicalize().ok());
    for old in owned
        .into_iter()
        .filter(|p| {
            p != created
                && protected
                    .as_ref()
                    .is_none_or(|protected| p.canonicalize().ok().as_ref() != Some(protected))
        })
        .take(remove)
    {
        if let Err(error) = remove_file(&old) {
            issues.push(format!("{}: {error}", old.display()));
        }
    }
    issues.first().map(|first| {
        format!(
            "Не удалось полностью удалить старые копии ({}): {first}",
            issues.len()
        )
    })
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
            pending: Mutex::new(None),
            next_restore: AtomicU64::new(1),
            // Do not take an automatic backup of a previous session's mirror
            // until the current webview has successfully sent its profile.
            mirror_error: Mutex::new(Some("Ожидание синхронизации профиля.".into())),
            next_request: AtomicU64::new(1),
            profile_request: Mutex::new(None),
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
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Копирование уже выполняется.")?;
        self.ensure_no_restore()?;
        let p = match build_profile(&entries) {
            Ok(profile) => profile,
            Err(error) => {
                *self
                    .mirror_error
                    .lock()
                    .map_err(|_| "Профиль недоступен.")? = Some(error.clone());
                return Err(error);
            }
        };
        self.write_mirror(&p)
    }
    fn write_mirror(&self, p: &Profile) -> Result<(), String> {
        let result = atomic(
            &self.dir.join("profile-mirror.json"),
            &serde_json::to_vec(p).map_err(|_| "Профиль недоступен.")?,
        );
        *self
            .mirror_error
            .lock()
            .map_err(|_| "Профиль недоступен.")? = result.as_ref().err().cloned();
        result
    }
    fn ensure_no_restore(&self) -> Result<(), String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Восстановление недоступно.")?;
        if pending
            .as_ref()
            .is_some_and(|p| p.started.elapsed() > std::time::Duration::from_secs(300))
        {
            *pending = None;
        }
        if pending.is_some() {
            return Err("Восстановление уже выполняется.".into());
        }
        if self.journal_path().exists() {
            return Err("Предыдущее восстановление не завершено. Перезапустите приложение.".into());
        }
        Ok(())
    }
    fn create(&self, history: &History) -> Result<String, String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Копирование уже выполняется.")?;
        self.ensure_no_restore()?;
        self.create_locked(history, None).map(|(path, _)| path)
    }
    fn create_with_profile(
        &self,
        history: &History,
        entries: Vec<(String, String)>,
    ) -> Result<Option<String>, String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Копирование уже выполняется.")?;
        self.ensure_no_restore()?;
        let s = self.settings();
        let now = crate::cache::now_ms();
        if !s.enabled
            || s.folder.is_none()
            || s.last_at.is_some_and(|t| now - t < 24 * 60 * 60 * 1000)
        {
            return Ok(None);
        }
        let profile = build_profile(&entries)?;
        self.write_mirror(&profile)?;
        self.create_locked(history, None)
            .map(|(path, _)| Some(path))
    }
    fn request_profile(&self) -> Result<ProfileResponse, String> {
        let mut pending = self
            .profile_request
            .lock()
            .map_err(|_| "Профиль недоступен.")?;
        if pending.is_some() {
            return Err("Запрос профиля уже выполняется.".into());
        }
        let id = self.next_request.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        *pending = Some((id, sender));
        Ok((id, receiver))
    }
    fn provide_profile(&self, id: u64, settings: Vec<(String, String)>) -> Result<(), String> {
        let mut pending = self
            .profile_request
            .lock()
            .map_err(|_| "Профиль недоступен.")?;
        if pending.as_ref().is_none_or(|(expected, _)| *expected != id) {
            return Err("Запрос профиля уже завершён.".into());
        }
        let (_, sender) = pending.take().unwrap();
        sender
            .send(settings)
            .map_err(|_| "Запрос профиля уже завершён.".into())
    }
    fn clear_profile_request(&self, id: u64) {
        if let Ok(mut pending) = self.profile_request.lock() {
            if pending
                .as_ref()
                .is_some_and(|(expected, _)| *expected == id)
            {
                *pending = None;
            }
        }
    }
    fn create_locked(
        &self,
        history: &History,
        protected: Option<&Path>,
    ) -> Result<(String, u64), String> {
        if let Some(error) = self
            .mirror_error
            .lock()
            .map_err(|_| "Профиль недоступен.")?
            .as_ref()
        {
            return Err(format!("Профиль не синхронизирован: {error}"));
        }
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
        let history_generation = history.snapshot(&snapshot)?;
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
        let mut timestamp = crate::cache::now_ms();
        let path = loop {
            let candidate = folder.join(format!("sportsdesk-backup-{timestamp}.sdbackup.json"));
            if !candidate.exists() {
                break candidate;
            }
            timestamp += 1;
        };
        atomic(
            &path,
            &serde_json::to_vec(&bundle).map_err(|_| "Не удалось собрать копию.")?,
        )?;
        let warning = rotate(&folder, &path, protected, |p| std::fs::remove_file(p));
        let mut s = self.settings.lock().map_err(|_| "Настройки недоступны.")?;
        s.last_at = Some(crate::cache::now_ms());
        s.last_file = Some(path.to_string_lossy().into_owned());
        s.error = warning;
        s.next_attempt = None;
        self.persist(&s).map_err(|error| {
            format!(
                "Копия сохранена: {}. Не удалось сохранить настройки копирования: {error}",
                path.display()
            )
        })?;
        Ok((path.to_string_lossy().into_owned(), history_generation))
    }
    fn read_restore(&self, path: &str) -> Result<(Profile, Option<Vec<u8>>), String> {
        if std::fs::metadata(path)
            .map_err(|_| "Файл недоступен.")?
            .len()
            > MAX_BYTES
        {
            return Err("Файл слишком большой.".into());
        }
        let text = std::fs::read(path).map_err(|_| "Файл не читается.")?;
        if text.len() as u64 > MAX_BYTES {
            return Err("Файл слишком большой.".into());
        }
        let value: serde_json::Value =
            serde_json::from_slice(&text).map_err(|_| "Некорректный файл копии.")?;
        if value.get("version").and_then(|v| v.as_u64()) == Some(1) {
            if text.len() > 2_000_000 {
                return Err("Файл профиля слишком большой.".into());
            }
            let profile: Profile = serde_json::from_value(value)
                .map_err(|_| "Файл не является профилем SportsDesk.")?;
            if profile.app != "SportsDesk" || profile.version != 1 {
                return Err("Неподдерживаемая резервная копия.".into());
            }
            build_profile(
                &profile
                    .settings
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect::<Vec<_>>(),
            )?;
            return Ok((profile, None));
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
        Ok((b.profile, Some(bytes)))
    }
    fn with_snapshot<T>(
        &self,
        bytes: &[u8],
        f: impl FnOnce(&Path) -> Result<T, String>,
    ) -> Result<T, String> {
        let tmp = self.dir.join("restore-snapshot.sqlite3");
        std::fs::write(&tmp, bytes).map_err(|_| "Не удалось подготовить историю.")?;
        let result = f(&tmp);
        let _ = std::fs::remove_file(tmp);
        result
    }
    fn prepare_restore(
        &self,
        history: &History,
        path: &str,
        entries: Vec<(String, String)>,
    ) -> Result<PreparedRestore, String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Копирование уже выполняется.")?;
        self.ensure_no_restore()?;
        let previous_profile = build_profile(&entries)?;
        let (profile, bytes) = self.read_restore(path)?;
        if let Some(bytes) = &bytes {
            self.with_snapshot(bytes, History::validate_snapshot)?;
        }
        self.write_mirror(&previous_profile)?;
        let (safety_file, history_generation) =
            self.create_locked(history, Some(Path::new(path)))?;
        let id = self.next_restore.fetch_add(1, Ordering::Relaxed);
        *self
            .pending
            .lock()
            .map_err(|_| "Восстановление недоступно.")? = Some(PendingRestore {
            id,
            started: std::time::Instant::now(),
            profile: profile.clone(),
            previous_profile,
            history: bytes,
            history_generation,
            source: path.to_string(),
            safety_file: safety_file.clone(),
        });
        Ok(PreparedRestore {
            id,
            profile,
            safety_file,
            safety_warning: self.settings().error,
        })
    }
    fn cancel_restore(&self, id: u64) -> Result<(), String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Восстановление недоступно.")?;
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Восстановление недоступно.")?;
        if pending.as_ref().is_some_and(|p| p.id == id) {
            *pending = None;
        }
        Ok(())
    }
    fn commit_restore(&self, history: &History, id: u64) -> Result<(), String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Восстановление недоступно.")?;
        let plan = {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "Восстановление недоступно.")?;
            if pending.as_ref().is_none_or(|p| p.id != id) {
                return Err("Подготовленное восстановление не найдено.".into());
            }
            pending.take().unwrap()
        };
        // Record the intent before touching the mirror or the history so a crash
        // in the middle of the commit can be finished or undone on the next start.
        let mut journal = RestoreJournal::new(&plan, JournalStage::Committing);
        self.write_journal(&journal)?;
        let result = self
            .write_mirror(&plan.profile)
            .and_then(|_| match &plan.history {
                Some(bytes) => self.with_snapshot(bytes, |p| {
                    history.restore_snapshot(p, plan.history_generation)
                }),
                None => Ok(()),
            });
        if let Err(error) = result {
            journal.stage = JournalStage::RolledBack;
            if self.write_journal(&journal).is_err() {
                // Nothing was committed, so there is nothing to replay on start.
                let _ = std::fs::remove_file(self.journal_path());
            }
            if let Err(rollback) = self.write_mirror(&plan.previous_profile) {
                // A missing mirror makes later backups fail safely instead of combining
                // the restored profile with the unchanged history.
                let removal = std::fs::remove_file(self.dir.join("profile-mirror.json"));
                let detail = match removal {
                    Ok(()) => String::new(),
                    Err(e) => format!(" Не удалось удалить несогласованное зеркало: {e}."),
                };
                return Err(format!(
                    "{error} Не удалось вернуть зеркало профиля: {rollback}.{detail}"
                ));
            }
            return Err(error);
        }
        journal.stage = JournalStage::Committed;
        // If this write fails the journal still says "committing"; replaying the
        // same copy on the next start produces the state that was just committed.
        let _ = self.write_journal(&journal);
        Ok(())
    }
    fn journal_path(&self) -> PathBuf {
        self.dir.join(JOURNAL_FILE)
    }
    fn read_journal(&self) -> Result<Option<RestoreJournal>, String> {
        match std::fs::read(self.journal_path()) {
            Ok(bytes) => serde_json::from_slice::<RestoreJournal>(&bytes)
                .ok()
                .filter(|j| j.version == JOURNAL_VERSION)
                .map(Some)
                .ok_or_else(|| "Журнал прерванного восстановления повреждён.".to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("Журнал восстановления не читается.".into()),
        }
    }
    fn write_journal(&self, journal: &RestoreJournal) -> Result<(), String> {
        let bytes = serde_json::to_vec(journal)
            .map_err(|_| "Не удалось записать журнал восстановления.")?;
        atomic(&self.journal_path(), &bytes)
    }
    fn note(&self, message: String) {
        if let Ok(mut s) = self.settings.lock() {
            s.error = Some(message);
            let _ = self.persist(&s);
        }
    }
    /// Re-apply the history of a copy. Idempotent, so it is safe after a crash.
    fn replay(&self, history: &History, path: &str, expected: &Profile) -> Result<(), String> {
        let (profile, bytes) = self.read_restore(path)?;
        if profile.settings != expected.settings {
            return Err("Файл копии изменился после начала восстановления.".into());
        }
        if let Some(bytes) = bytes {
            self.with_snapshot(&bytes, |p| {
                history.restore_snapshot(p, history.generation())
            })?;
        }
        Ok(())
    }
    /// Finish or undo a restore interrupted by a crash. Returns the profile the
    /// webview must apply; the journal stays until `finish_restore` confirms it.
    fn recover(&self, history: &History) -> Result<Option<RecoveredRestore>, String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Восстановление недоступно.")?;
        let mut journal = match self.read_journal() {
            Ok(Some(journal)) => journal,
            Ok(None) => return Ok(None),
            Err(error) => {
                let aside = self.dir.join(format!(
                    "restore-journal.corrupt-{}.json",
                    crate::cache::now_ms()
                ));
                let _ = std::fs::rename(self.journal_path(), aside);
                self.note(format!(
                    "{error} Проверьте профиль и историю: защитная копия лежит в папке резервных копий."
                ));
                return Ok(None);
            }
        };
        if journal.stage == JournalStage::Committing {
            journal.stage = match self.replay(history, &journal.source, &journal.profile) {
                Ok(()) => JournalStage::Committed,
                Err(forward) => {
                    match self.replay(history, &journal.safety_file, &journal.previous_profile) {
                        Ok(()) => JournalStage::RolledBack,
                        Err(back) => {
                            let message = format!(
                                "Не удалось завершить прерванное восстановление ({forward}) и вернуть данные из защитной копии ({back}). Защитная копия: {}",
                                journal.safety_file
                            );
                            self.note(message.clone());
                            return Err(message);
                        }
                    }
                }
            };
            self.write_journal(&journal)?;
        }
        let completed = journal.stage == JournalStage::Committed;
        let profile = if completed {
            journal.profile.clone()
        } else {
            journal.previous_profile.clone()
        };
        self.write_mirror(&profile)?;
        self.note(if completed {
            "Прерванное восстановление копии завершено после перезапуска.".into()
        } else {
            format!(
                "Прерванное восстановление копии отменено после перезапуска; данные возвращены из защитной копии {}.",
                journal.safety_file
            )
        });
        Ok(Some(RecoveredRestore {
            id: journal.id,
            profile,
            completed,
        }))
    }
    /// Called by the webview once it has applied the profile of a commit,
    /// rollback or recovery. Removes the journal and unblocks the mirror.
    fn finish_restore(&self, id: u64) -> Result<(), String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "Восстановление недоступно.")?;
        match self.read_journal()? {
            Some(journal) if journal.id == id && journal.stage != JournalStage::Committing => {
                std::fs::remove_file(self.journal_path())
                    .map_err(|_| "Не удалось завершить восстановление.".into())
            }
            _ => Ok(()),
        }
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
pub fn provide_backup_profile(
    id: u64,
    settings: Vec<(String, String)>,
    state: tauri::State<'_, Arc<BackupState>>,
) -> Result<(), String> {
    state.provide_profile(id, settings)
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
pub async fn prepare_backup_restore(
    path: String,
    settings: Vec<(String, String)>,
    state: tauri::State<'_, Arc<BackupState>>,
    history: tauri::State<'_, crate::history::HistoryState>,
) -> Result<PreparedRestore, String> {
    let state = state.inner().clone();
    let h = history.0.clone();
    tauri::async_runtime::spawn_blocking(move || state.prepare_restore(&h, &path, settings))
        .await
        .map_err(|_| "Ошибка восстановления.")?
}
#[tauri::command]
pub async fn commit_backup_restore(
    id: u64,
    state: tauri::State<'_, Arc<BackupState>>,
    history: tauri::State<'_, crate::history::HistoryState>,
) -> Result<(), String> {
    let state = state.inner().clone();
    let h = history.0.clone();
    tauri::async_runtime::spawn_blocking(move || state.commit_restore(&h, id))
        .await
        .map_err(|_| "Ошибка восстановления.")?
}
#[tauri::command]
pub async fn cancel_backup_restore(
    id: u64,
    state: tauri::State<'_, Arc<BackupState>>,
) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.cancel_restore(id))
        .await
        .map_err(|_| "Ошибка отмены восстановления.")?
}
#[tauri::command]
pub async fn backup_recovery(
    state: tauri::State<'_, Arc<BackupState>>,
    history: tauri::State<'_, crate::history::HistoryState>,
) -> Result<Option<RecoveredRestore>, String> {
    let state = state.inner().clone();
    let h = history.0.clone();
    tauri::async_runtime::spawn_blocking(move || state.recover(&h))
        .await
        .map_err(|_| "Ошибка восстановления.")?
}
#[tauri::command]
pub fn finish_backup_restore(
    id: u64,
    state: tauri::State<'_, Arc<BackupState>>,
) -> Result<(), String> {
    state.finish_restore(id)
}
pub fn start(app: &AppHandle, dir: PathBuf, history: Arc<History>) {
    let state = Arc::new(BackupState::new(dir));
    app.manage(state.clone());
    let app = app.clone();
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
                let result: Result<(), String> = async {
                    let (id, receiver) = state.request_profile()?;
                    if app
                        .emit_to("main", "sportsdesk://backup-profile-request", id)
                        .is_err()
                    {
                        state.clear_profile_request(id);
                        return Err("Не удалось запросить актуальный профиль приложения.".into());
                    }
                    let answer =
                        tokio::time::timeout(std::time::Duration::from_secs(15), receiver).await;
                    state.clear_profile_request(id);
                    let entries = answer
                        .map_err(|_| "Приложение не ответило на запрос актуального профиля.")?
                        .map_err(|_| "Не удалось получить актуальный профиль.")?;
                    let b = state.clone();
                    let h = history.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        b.create_with_profile(&h, entries)
                    })
                    .await
                    .map_err(|_| "Ошибка копирования.")??;
                    Ok(())
                }
                .await;
                if let Err(error) = result {
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
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!(
                "backup-{name}-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
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
        let prepared = b
            .prepare_restore(&h, &path, vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        assert_eq!(prepared.profile.settings["sportsdesk.scheme"], "light");
        b.commit_restore(&h, prepared.id).unwrap();
        assert_eq!(h.team_matches("t_a", true).unwrap()[0].home_score, 2);
        // The journal keeps the mirror closed until the webview applied the profile.
        assert!(b
            .mirror(vec![("sportsdesk.scheme".into(), "light".into())])
            .is_err());
        b.finish_restore(prepared.id).unwrap();
        b.mirror(vec![("sportsdesk.scheme".into(), "light".into())])
            .unwrap();
        let mut bad: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        bad["historySha256"] = "bad".into();
        let badpath = folder.join("bad.json");
        std::fs::write(&badpath, serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(b
            .prepare_restore(
                &h,
                badpath.to_str().unwrap(),
                vec![("sportsdesk.scheme".into(), "dark".into())]
            )
            .is_err());
        assert_eq!(h.team_matches("t_a", true).unwrap()[0].home_score, 2);
        bad["profile"]["settings"]["sportsdesk.api_key"] = "SHOULD_NOT_IMPORT".into();
        assert!(
            crate::profile::build_profile(&[("sportsdesk.api_key".into(), "x".into())]).is_err()
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
        let prepared = b
            .prepare_restore(
                &h,
                legacy.to_str().unwrap(),
                vec![("sportsdesk.scheme".into(), "dark".into())],
            )
            .unwrap();
        assert_eq!(prepared.profile.version, 1);
        b.commit_restore(&h, prepared.id).unwrap();
    }
    #[test]
    fn selected_oldest_copy_survives_safety_backup_rotation() {
        let (b, h, folder) = fixture("protected");
        let selected = b.create(&h).unwrap();
        b.mirror(vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        // Files from a clock that ran ahead must not make rotation delete the
        // freshly written safety copy, even when it sorts before those files.
        for n in 0..6 {
            std::fs::write(
                folder.join(format!("sportsdesk-backup-999999999999{n}.sdbackup.json")),
                "old",
            )
            .unwrap();
        }
        let prepared = b
            .prepare_restore(
                &h,
                &selected,
                vec![("sportsdesk.scheme".into(), "dark".into())],
            )
            .unwrap();
        assert!(Path::new(&selected).exists());
        assert!(Path::new(&prepared.safety_file).exists());
        assert_eq!(prepared.profile.settings["sportsdesk.scheme"], "light");
        assert_eq!(
            std::fs::read_dir(folder)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().ends_with(".sdbackup.json"))
                .count(),
            7
        );
        b.commit_restore(&h, prepared.id).unwrap();
    }
    #[test]
    fn cancelled_restore_releases_mirror_and_cannot_commit() {
        let (b, h, _) = fixture("cancel");
        let path = b.create(&h).unwrap();
        let prepared = b
            .prepare_restore(&h, &path, vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        assert!(b
            .mirror(vec![("sportsdesk.scheme".into(), "dark".into())])
            .is_err());
        b.cancel_restore(prepared.id).unwrap();
        assert!(b.commit_restore(&h, prepared.id).is_err());
        b.mirror(vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
    }
    #[test]
    fn failed_profile_sync_cannot_back_up_a_stale_mirror() {
        let (b, h, _) = fixture("stale");
        assert!(b
            .mirror(vec![("sportsdesk.api_key".into(), "secret".into())])
            .is_err());
        assert!(b.create(&h).is_err());
        b.mirror(vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        assert!(b.create(&h).is_ok());
    }
    #[test]
    fn history_changed_after_safety_snapshot_refuses_restore_without_losing_new_data() {
        let (b, h, _) = fixture("concurrent-history");
        let mut batch = crate::history::HistoryUpsert {
            league_id: "league".into(),
            league_name: "League".into(),
            season: "2030".into(),
            matches: vec![crate::history::HistoryMatchIn {
                id: "match".into(),
                home_id: "a".into(),
                home_name: "A".into(),
                away_id: "b".into(),
                away_name: "B".into(),
                home_score: Some(1),
                away_score: Some(0),
                status: "finished".into(),
                date: "2030-01-01".into(),
                round: "1".into(),
            }],
        };
        h.upsert_season(&batch).unwrap();
        let path = b.create(&h).unwrap();
        batch.matches[0].home_score = Some(2);
        h.upsert_season(&batch).unwrap();
        let prepared = b
            .prepare_restore(&h, &path, vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        batch.matches[0].home_score = Some(3);
        h.upsert_season(&batch).unwrap();
        assert!(b
            .commit_restore(&h, prepared.id)
            .unwrap_err()
            .contains("История изменилась"));
        assert_eq!(h.team_matches("a", true).unwrap()[0].home_score, 3);
        let mirror =
            crate::profile::read_profile(b.dir.join("profile-mirror.json").to_str().unwrap())
                .unwrap();
        assert_eq!(mirror.settings["sportsdesk.scheme"], "dark");
    }
    #[test]
    fn automatic_backup_requires_matching_fresh_profile_response() {
        let (b, h, _) = fixture("automatic");
        b.settings.lock().unwrap().enabled = true;
        let (id, mut receiver) = b.request_profile().unwrap();
        assert!(b
            .provide_profile(id + 1, vec![("sportsdesk.scheme".into(), "stale".into())])
            .is_err());
        b.provide_profile(id, vec![("sportsdesk.scheme".into(), "fresh".into())])
            .unwrap();
        let entries = receiver.try_recv().unwrap();
        let path = b.create_with_profile(&h, entries).unwrap().unwrap();
        let bundle: Bundle = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(bundle.profile.settings["sportsdesk.scheme"], "fresh");
        assert!(b.provide_profile(id, vec![]).is_err());
    }
    #[test]
    fn rotation_reports_partial_success_when_deleting_an_old_file_fails() {
        let (_, _, folder) = fixture("rotation-error");
        let mut files = Vec::new();
        for n in 0..8 {
            let path = folder.join(format!("sportsdesk-backup-{n}.sdbackup.json"));
            std::fs::write(&path, "copy").unwrap();
            files.push(path);
        }
        let warning = rotate(&folder, &files[7], Some(&files[0]), |_| {
            Err(std::io::Error::other("denied"))
        })
        .unwrap();
        assert!(warning.contains("Не удалось полностью удалить старые копии"));
        assert!(warning.contains("denied"));
        assert!(files[0].exists());
        assert!(files[7].exists());
    }
    #[test]
    fn malformed_snapshot_is_rejected_before_safety_copy_and_failed_commit_restores_mirror() {
        let (b, h, folder) = fixture("failed");
        let mut batch = crate::history::HistoryUpsert {
            league_id: "l".into(),
            league_name: "League".into(),
            season: "2030".into(),
            matches: vec![crate::history::HistoryMatchIn {
                id: "m".into(),
                home_id: "a".into(),
                home_name: "A".into(),
                away_id: "b".into(),
                away_name: "B".into(),
                home_score: Some(1),
                away_score: Some(0),
                status: "finished".into(),
                date: "2030-01-01".into(),
                round: "1".into(),
            }],
        };
        h.upsert_season(&batch).unwrap();
        let path = b.create(&h).unwrap();
        batch.matches[0].home_score = Some(9);
        h.upsert_season(&batch).unwrap();
        let mut bundle: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let bad = b"not a sqlite database";
        bundle["historySqlite"] = base64::engine::general_purpose::STANDARD.encode(bad).into();
        bundle["historySha256"] = digest(bad).into();
        let badpath = folder.join("bad.json");
        std::fs::write(&badpath, serde_json::to_vec(&bundle).unwrap()).unwrap();
        assert!(b
            .prepare_restore(
                &h,
                badpath.to_str().unwrap(),
                vec![("sportsdesk.scheme".into(), "dark".into())]
            )
            .is_err());
        assert_eq!(
            std::fs::read_dir(&folder)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().ends_with(".sdbackup.json"))
                .count(),
            1
        );
        let prepared = b
            .prepare_restore(&h, &path, vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        b.pending.lock().unwrap().as_mut().unwrap().history = Some(bad.to_vec());
        assert!(b.commit_restore(&h, prepared.id).is_err());
        assert_eq!(h.team_matches("a", true).unwrap()[0].home_score, 9);
        let mirror =
            crate::profile::read_profile(b.dir.join("profile-mirror.json").to_str().unwrap())
                .unwrap();
        assert_eq!(mirror.settings["sportsdesk.scheme"], "dark");
    }
    fn seed_two_scores(b: &BackupState, h: &History) -> String {
        let mut batch = crate::history::HistoryUpsert {
            league_id: "l".into(),
            league_name: "League".into(),
            season: "2030".into(),
            matches: vec![crate::history::HistoryMatchIn {
                id: "m".into(),
                home_id: "a".into(),
                home_name: "A".into(),
                away_id: "b".into(),
                away_name: "B".into(),
                home_score: Some(2),
                away_score: Some(0),
                status: "finished".into(),
                date: "2030-01-01".into(),
                round: "1".into(),
            }],
        };
        h.upsert_season(&batch).unwrap();
        let path = b.create(h).unwrap();
        batch.matches[0].home_score = Some(9);
        h.upsert_season(&batch).unwrap();
        path
    }
    fn mirror_scheme(b: &BackupState) -> String {
        crate::profile::read_profile(b.dir.join("profile-mirror.json").to_str().unwrap())
            .unwrap()
            .settings["sportsdesk.scheme"]
            .clone()
    }
    #[test]
    fn crash_before_history_commit_is_finished_on_next_start() {
        let (b, h, _) = fixture("crash-forward");
        let path = seed_two_scores(&b, &h);
        b.prepare_restore(&h, &path, vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        // Simulate a crash right after the journal was written.
        let plan = b.pending.lock().unwrap().take().unwrap();
        b.write_journal(&RestoreJournal::new(&plan, JournalStage::Committing))
            .unwrap();
        let restarted = BackupState::new(b.dir.clone());
        assert!(restarted
            .mirror(vec![("sportsdesk.scheme".into(), "dark".into())])
            .is_err());
        let recovered = restarted.recover(&h).unwrap().unwrap();
        assert!(recovered.completed);
        assert_eq!(recovered.profile.settings["sportsdesk.scheme"], "light");
        assert_eq!(h.team_matches("a", true).unwrap()[0].home_score, 2);
        assert_eq!(mirror_scheme(&restarted), "light");
        assert!(restarted.settings().error.unwrap().contains("завершено"));
        // Recovery is repeatable until the webview confirms it applied the profile.
        assert!(restarted.recover(&h).unwrap().is_some());
        restarted.finish_restore(recovered.id).unwrap();
        assert!(restarted.recover(&h).unwrap().is_none());
        restarted
            .mirror(vec![("sportsdesk.scheme".into(), "light".into())])
            .unwrap();
    }
    #[test]
    fn crash_after_history_commit_with_missing_copy_rolls_back_to_safety_copy() {
        let (b, h, _) = fixture("crash-back");
        let path = seed_two_scores(&b, &h);
        let prepared = b
            .prepare_restore(&h, &path, vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        let journal = RestoreJournal::new(
            b.pending.lock().unwrap().as_ref().unwrap(),
            JournalStage::Committing,
        );
        b.commit_restore(&h, prepared.id).unwrap();
        assert_eq!(h.team_matches("a", true).unwrap()[0].home_score, 2);
        // Crash before the "committed" stage was recorded, and the copy was removed.
        b.write_journal(&journal).unwrap();
        std::fs::remove_file(&path).unwrap();
        let restarted = BackupState::new(b.dir.clone());
        let recovered = restarted.recover(&h).unwrap().unwrap();
        assert!(!recovered.completed);
        assert_eq!(recovered.profile.settings["sportsdesk.scheme"], "dark");
        assert_eq!(h.team_matches("a", true).unwrap()[0].home_score, 9);
        assert_eq!(mirror_scheme(&restarted), "dark");
        assert!(restarted.settings().error.unwrap().contains("отменено"));
        restarted.finish_restore(recovered.id).unwrap();
        assert!(!restarted.dir.join(JOURNAL_FILE).exists());
    }
    #[test]
    fn failed_commit_leaves_rollback_journal_and_unfinished_commit_cannot_be_dismissed() {
        let (b, h, _) = fixture("journal-stages");
        let path = seed_two_scores(&b, &h);
        let prepared = b
            .prepare_restore(&h, &path, vec![("sportsdesk.scheme".into(), "dark".into())])
            .unwrap();
        b.pending.lock().unwrap().as_mut().unwrap().history = Some(b"broken".to_vec());
        assert!(b.commit_restore(&h, prepared.id).is_err());
        let journal = b.read_journal().unwrap().unwrap();
        assert_eq!(journal.stage, JournalStage::RolledBack);
        assert!(b.prepare_restore(&h, &path, vec![]).is_err());
        b.finish_restore(prepared.id).unwrap();
        // A journal that is still "committing" can only be resolved by recovery.
        b.write_journal(&RestoreJournal {
            stage: JournalStage::Committing,
            ..journal
        })
        .unwrap();
        b.finish_restore(prepared.id).unwrap();
        assert!(b.dir.join(JOURNAL_FILE).exists());
        std::fs::write(b.dir.join(JOURNAL_FILE), b"{not json").unwrap();
        assert!(b.recover(&h).unwrap().is_none());
        assert!(!b.dir.join(JOURNAL_FILE).exists());
        assert!(b.settings().error.unwrap().contains("повреждён"));
    }
}
