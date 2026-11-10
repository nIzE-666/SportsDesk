//! Durable fixture packages, separate from expiring api_cache. No automatic eviction.
use crate::history::History;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::Ordering;

pub const MAX_PACKAGES: usize = 60;
pub const MAX_BYTES: usize = 2_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfflineMatch {
    pub id: String,
    pub home_id: String,
    pub home_name: String,
    pub away_id: String,
    pub away_name: String,
    pub home_score: Option<i64>,
    pub away_score: Option<i64>,
    pub status: String,
    pub date: String,
    pub time_utc: Option<String>,
    pub round: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfflineSeason {
    pub version: u32,
    pub league_id: String,
    pub league_name: String,
    pub season: String,
    pub fetched_at: String,
    pub pinned: bool,
    pub duplicates: u32,
    pub matches: Vec<OfflineMatch>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    state: &'static str,
    expected: Option<usize>,
    finished: usize,
    missing_scores: usize,
    missing_dates: usize,
    missing_times: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    version: u32,
    league_id: String,
    league_name: String,
    season: String,
    fetched_at: String,
    pinned: bool,
    duplicates: u32,
    matches: usize,
    bytes: usize,
    coverage: Coverage,
}
fn bounded(v: &str, max: usize, empty: bool) -> bool {
    v.encode_utf16().count() <= max && (empty || !v.trim().is_empty())
}
impl OfflineSeason {
    pub fn validate(&self) -> Result<(), String> {
        let valid_time = |s: &str| s.len() <= 40 && chrono::DateTime::parse_from_rfc3339(s).is_ok();
        let mut ids = HashSet::new();
        let valid = self.version == 1
            && bounded(&self.league_id, 100, false)
            && bounded(&self.league_name, 200, false)
            && bounded(&self.season, 30, false)
            && valid_time(&self.fetched_at)
            && !self.matches.is_empty()
            && self.matches.len() <= 2000
            && self.matches.iter().all(|m| {
                bounded(&m.id, 100, false)
                    && ids.insert(&m.id)
                    && bounded(&m.home_id, 100, false)
                    && bounded(&m.away_id, 100, false)
                    && m.home_id != m.away_id
                    && bounded(&m.home_name, 200, false)
                    && bounded(&m.away_name, 200, false)
                    && [m.home_score, m.away_score]
                        .iter()
                        .all(|s| s.is_none_or(|n| (0..=100).contains(&n)))
                    && bounded(&m.status, 100, false)
                    && (m.date.is_empty()
                        || (m.date.len() == 10
                            && chrono::NaiveDate::parse_from_str(&m.date, "%Y-%m-%d").is_ok()))
                    && m.time_utc.as_deref().is_none_or(valid_time)
                    && bounded(&m.round, 200, true)
            });
        if !valid
            || serde_json::to_vec(self)
                .map_err(|_| "Пакет не читается.")?
                .len()
                > MAX_BYTES
        {
            return Err("Пакет пуст, повреждён, создан новой версией или превышает лимит 2000 матчей / 2 МБ.".into());
        }
        Ok(())
    }
    fn summary(&self) -> Summary {
        let year = self.season.get(..4).and_then(|s| s.parse::<u32>().ok());
        let teams = year
            .filter(|y| (2021..=2026).contains(y) && self.season == format!("{}/{}", y, y + 1))
            .and_then(|y| match self.league_id.as_str() {
                "l_4WFCIZ" | "l_0ErfuF" | "l_0ALvwF" => Some(20),
                "l_1Isor4" => Some(18),
                "l_3FJFUl" => Some(if y >= 2023 { 18 } else { 20 }),
                _ => None,
            });
        let expected = teams.map(|n| n * (n - 1));
        let ids: HashSet<_> = self
            .matches
            .iter()
            .flat_map(|m| [&m.home_id, &m.away_id])
            .collect();
        let pairs: HashSet<_> = self
            .matches
            .iter()
            .map(|m| (&m.home_id, &m.away_id))
            .collect();
        let missing_dates = self.matches.iter().filter(|m| m.date.is_empty()).count();
        Summary {
            version: self.version,
            league_id: self.league_id.clone(),
            league_name: self.league_name.clone(),
            season: self.season.clone(),
            fetched_at: self.fetched_at.clone(),
            pinned: self.pinned,
            duplicates: self.duplicates,
            matches: self.matches.len(),
            bytes: serde_json::to_vec(self).map_or(0, |v| v.len()),
            coverage: Coverage {
                state: if expected.is_none() {
                    "unverified"
                } else if expected == Some(self.matches.len())
                    && teams == Some(ids.len())
                    && expected == Some(pairs.len())
                    && missing_dates == 0
                {
                    "complete"
                } else {
                    "partial"
                },
                expected,
                finished: self
                    .matches
                    .iter()
                    .filter(|m| m.status == "finished")
                    .count(),
                missing_scores: self
                    .matches
                    .iter()
                    .filter(|m| {
                        m.status == "finished" && (m.home_score.is_none() || m.away_score.is_none())
                    })
                    .count(),
                missing_dates,
                missing_times: self.matches.iter().filter(|m| m.time_utc.is_none()).count(),
            },
        }
    }
}

pub fn read_packages(conn: &rusqlite::Connection) -> Result<Vec<OfflineSeason>, String> {
    let mut stmt = conn
        .prepare("SELECT league_id,season,payload FROM offline_seasons LIMIT 61")
        .map_err(|_| "Офлайн-пакеты не читаются.")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| "Офлайн-пакеты не читаются.")?;
    let mut result = Vec::new();
    for row in rows {
        let (league, season, raw) = row.map_err(|_| "Офлайн-пакеты не читаются.")?;
        if raw.len() > MAX_BYTES {
            return Err("Слишком большой офлайн-пакет.".into());
        }
        let p: OfflineSeason = serde_json::from_str(&raw)
            .map_err(|_| "Неподдерживаемый офлайн-пакет. Обновите приложение.")?;
        p.validate()?;
        if league != p.league_id || season != p.season {
            return Err("Повреждён индекс офлайн-пакета.".into());
        }
        result.push(p);
    }
    if result.len() > MAX_PACKAGES {
        return Err("Слишком много офлайн-пакетов.".into());
    }
    Ok(result)
}
impl History {
    pub fn offline_list(&self) -> Result<Vec<Summary>, String> {
        let conn = self.conn.lock().map_err(|_| "История недоступна.")?;
        let mut summaries: Vec<_> = read_packages(&conn)?
            .iter()
            .map(OfflineSeason::summary)
            .collect();
        summaries.sort_by(|a, b| {
            b.season
                .cmp(&a.season)
                .then(a.league_name.cmp(&b.league_name))
        });
        Ok(summaries)
    }
    pub fn offline_get(&self, league: &str, season: &str) -> Result<Option<OfflineSeason>, String> {
        let conn = self.conn.lock().map_err(|_| "История недоступна.")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT payload FROM offline_seasons WHERE league_id=?1 AND season=?2",
                [league, season],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Офлайн-пакет не читается.")?;
        raw.map(|s| {
            if s.len() > MAX_BYTES {
                return Err("Слишком большой офлайн-пакет.".into());
            }
            let p: OfflineSeason =
                serde_json::from_str(&s).map_err(|_| "Неподдерживаемый офлайн-пакет.")?;
            p.validate()?;
            if p.league_id != league || p.season != season {
                return Err("Повреждён индекс офлайн-пакета.".into());
            }
            Ok(p)
        })
        .transpose()
    }
    pub fn offline_put(&self, package: &OfflineSeason) -> Result<Summary, String> {
        package.validate()?;
        let mut conn = self.conn.lock().map_err(|_| "История недоступна.")?;
        let tx = conn
            .transaction()
            .map_err(|_| "Не удалось сохранить пакет.")?;
        let count: usize = tx
            .query_row(
                "SELECT count(*) FROM offline_seasons WHERE NOT (league_id=?1 AND season=?2)",
                [&package.league_id, &package.season],
                |r| r.get(0),
            )
            .map_err(|_| "Офлайн-пакеты недоступны.")?;
        if count >= MAX_PACKAGES {
            return Err("Лимит 60 офлайн-сезонов. Открепите и удалите ненужный пакет.".into());
        }
        tx.execute("INSERT INTO offline_seasons (league_id,season,payload) VALUES (?1,?2,?3) ON CONFLICT(league_id,season) DO UPDATE SET payload=excluded.payload", rusqlite::params![package.league_id,package.season,serde_json::to_string(package).map_err(|_| "Пакет не читается.")?]).map_err(|_| "Не удалось сохранить пакет.")?;
        // Update analytics history in the same transaction. Existing extra history is retained.
        for m in &package.matches {
            tx.execute("INSERT INTO history_matches VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) ON CONFLICT(league_id,season,id) DO UPDATE SET league_name=excluded.league_name,home_id=excluded.home_id,home_name=excluded.home_name,away_id=excluded.away_id,away_name=excluded.away_name,home_score=excluded.home_score,away_score=excluded.away_score,status=excluded.status,date=excluded.date,round=excluded.round,stored_at=excluded.stored_at",rusqlite::params![m.id,package.league_id,package.league_name,package.season,m.home_id,m.home_name,m.away_id,m.away_name,m.home_score.unwrap_or(-1),m.away_score.unwrap_or(-1),m.status,m.date,m.round,crate::cache::now_ms()]).map_err(|_| "Не удалось сохранить историю пакета.")?;
        }
        tx.commit().map_err(|_| "Не удалось сохранить пакет.")?;
        self.generation.fetch_add(1, Ordering::Relaxed);
        Ok(package.summary())
    }
    pub fn offline_pin(&self, league: &str, season: &str, pinned: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "История недоступна.")?;
        let raw: String = conn
            .query_row(
                "SELECT payload FROM offline_seasons WHERE league_id=?1 AND season=?2",
                [league, season],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Офлайн-пакет не читается.")?
            .ok_or("Пакет уже удалён.")?;
        let mut p: OfflineSeason =
            serde_json::from_str(&raw).map_err(|_| "Неподдерживаемый офлайн-пакет.")?;
        p.validate()?;
        p.pinned = pinned;
        conn.execute(
            "UPDATE offline_seasons SET payload=?3 WHERE league_id=?1 AND season=?2",
            rusqlite::params![
                league,
                season,
                serde_json::to_string(&p).map_err(|_| "Пакет не читается.")?
            ],
        )
        .map_err(|_| "Не удалось закрепить пакет.")?;
        self.generation.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
    pub fn offline_remove(&self, league: &str, season: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "История недоступна.")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT payload FROM offline_seasons WHERE league_id=?1 AND season=?2",
                [league, season],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Офлайн-пакет не читается.")?;
        if let Some(raw) = raw {
            let p: OfflineSeason =
                serde_json::from_str(&raw).map_err(|_| "Неподдерживаемый офлайн-пакет.")?;
            p.validate()?;
            if p.pinned {
                return Err("Сначала открепите сезон.".into());
            }
            conn.execute(
                "DELETE FROM offline_seasons WHERE league_id=?1 AND season=?2",
                [league, season],
            )
            .map_err(|_| "Не удалось удалить пакет.")?;
            self.generation.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_dir() -> std::path::PathBuf {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "sd-offline-test-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn package() -> OfflineSeason {
        serde_json::from_value(serde_json::json!({"version":1,"leagueId":"l_4WFCIZ","leagueName":"Premier League","season":"2026/2027","fetchedAt":"2026-11-09T00:00:00Z","pinned":true,"duplicates":0,"matches":[{"id":"m1","homeId":"a","homeName":"A","awayId":"b","awayName":"B","homeScore":null,"awayScore":null,"status":"scheduled","date":"2027-01-01","timeUtc":"2027-01-01T20:00:00Z","round":"1"}]})).unwrap()
    }
    #[test]
    fn durable_package_refresh_is_atomic_idempotent_and_keeps_exact_times() {
        let dir = temp_dir();
        let h = History::open(&dir).unwrap();
        let mut p = package();
        h.offline_put(&p).unwrap();
        p.matches[0].home_score = Some(3);
        p.matches[0].away_score = Some(2);
        p.matches[0].status = "finished".into();
        p.matches[0].home_name = "Changed".into();
        h.offline_put(&p).unwrap();
        assert_eq!(h.offline_list().unwrap().len(), 1);
        assert_eq!(h.season_matches(&p.league_id, &p.season).unwrap().len(), 1);
        assert_eq!(
            h.offline_get(&p.league_id, &p.season)
                .unwrap()
                .unwrap()
                .matches[0]
                .time_utc,
            p.matches[0].time_utc
        );
        assert_eq!(
            h.season_matches(&p.league_id, &p.season).unwrap()[0].home_name,
            "Changed"
        );
        drop(h);
        let reopened = History::open(&dir).unwrap();
        assert_eq!(
            reopened.offline_list().unwrap()[0].coverage.missing_scores,
            0
        );
    }
    #[test]
    fn pin_protects_deletion_and_removing_a_package_preserves_analytics_history() {
        let h = History::open(&temp_dir()).unwrap();
        let p = package();
        h.offline_put(&p).unwrap();
        let generation = h.generation();
        assert!(h.offline_remove(&p.league_id, &p.season).is_err());
        assert_eq!(h.generation(), generation);
        h.offline_pin(&p.league_id, &p.season, false).unwrap();
        assert!(h.generation() > generation);
        h.offline_remove(&p.league_id, &p.season).unwrap();
        assert!(h.offline_list().unwrap().is_empty());
        assert_eq!(h.season_matches(&p.league_id, &p.season).unwrap().len(), 1);
    }
    #[test]
    fn invalid_refresh_and_failed_history_write_cannot_replace_previous_package() {
        let h = History::open(&temp_dir()).unwrap();
        let p = package();
        h.offline_put(&p).unwrap();
        let mut invalid = p.clone();
        invalid.matches.push(invalid.matches[0].clone());
        assert!(h.offline_put(&invalid).is_err());
        let mut future = p.clone();
        future.version = 2;
        assert!(h.offline_put(&future).is_err());
        h.conn.lock().unwrap().execute_batch("CREATE TRIGGER reject_test BEFORE INSERT ON history_matches WHEN NEW.id='bad' BEGIN SELECT RAISE(FAIL,'test'); END;").unwrap();
        let generation = h.generation();
        let mut failed = p.clone();
        failed.matches[0].id = "bad".into();
        assert!(h.offline_put(&failed).is_err());
        assert_eq!(h.generation(), generation);
        assert_eq!(
            h.offline_get(&p.league_id, &p.season)
                .unwrap()
                .unwrap()
                .matches[0]
                .id,
            "m1"
        );
    }
    #[test]
    fn snapshot_restores_packages_and_pins_with_generation_protection() {
        let dir = temp_dir();
        let h = History::open(&dir).unwrap();
        let p = package();
        h.offline_put(&p).unwrap();
        let file = dir.join("snapshot.sqlite3");
        let generation = h.snapshot(&file).unwrap();
        h.offline_pin(&p.league_id, &p.season, false).unwrap();
        assert!(h.restore_snapshot(&file, generation).is_err());
        h.offline_remove(&p.league_id, &p.season).unwrap();
        h.restore_snapshot(&file, h.generation()).unwrap();
        assert!(h.offline_list().unwrap()[0].pinned);
    }
    #[test]
    fn real_v1_layout_migrates_without_losing_rows_and_old_snapshot_restores() {
        let dir = temp_dir();
        let h = History::open(&dir).unwrap();
        let p = package();
        h.offline_put(&p).unwrap();
        h.conn
            .lock()
            .unwrap()
            .execute_batch("DROP TABLE offline_seasons; PRAGMA user_version=1;")
            .unwrap();
        let file = dir.join("v1.sqlite3");
        h.snapshot(&file).unwrap();
        drop(h);
        let h = History::open(&dir).unwrap();
        assert!(h.offline_list().unwrap().is_empty());
        assert_eq!(h.season_matches(&p.league_id, &p.season).unwrap().len(), 1);
        h.offline_put(&p).unwrap();
        h.restore_snapshot(&file, h.generation()).unwrap();
        assert!(h.offline_list().unwrap().is_empty());
        assert_eq!(h.list_seasons().unwrap().len(), 1);
    }
    #[test]
    fn future_live_schema_is_refused_before_modification() {
        let dir = temp_dir();
        let file = dir.join("history.sqlite3");
        let conn = rusqlite::Connection::open(&file).unwrap();
        conn.execute_batch("PRAGMA user_version=99;").unwrap();
        drop(conn);
        assert!(History::open(&dir).is_err());
        let conn = rusqlite::Connection::open(&file).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
    #[test]
    fn malformed_offline_snapshot_is_rejected_without_changing_live_data() {
        let dir = temp_dir();
        let h = History::open(&dir).unwrap();
        let p = package();
        h.offline_put(&p).unwrap();
        let file = dir.join("bad.sqlite3");
        h.snapshot(&file).unwrap();
        let conn = rusqlite::Connection::open(&file).unwrap();
        conn.execute("UPDATE offline_seasons SET payload='{}'", [])
            .unwrap();
        drop(conn);
        assert!(History::validate_snapshot(&file).is_err());
        assert!(h.restore_snapshot(&file, h.generation()).is_err());
        assert_eq!(h.offline_list().unwrap().len(), 1);
    }
    #[test]
    fn capacity_never_evicts_packages_and_existing_seasons_can_refresh_at_the_limit() {
        let h = History::open(&temp_dir()).unwrap();
        let mut p = package();
        for n in 0..60 {
            p.league_id = format!("league-{n}");
            h.offline_put(&p).unwrap();
        }
        h.offline_put(&p).unwrap();
        p.league_id = "overflow".into();
        assert!(h.offline_put(&p).is_err());
        assert_eq!(h.offline_list().unwrap().len(), 60);
        h.offline_pin("league-0", &p.season, false).unwrap();
        h.offline_remove("league-0", &p.season).unwrap();
        h.offline_put(&p).unwrap();
        assert_eq!(h.offline_list().unwrap().len(), 60);
    }
    #[test]
    fn coverage_requires_all_pairs_and_tracks_missing_scores_separately() {
        let mut p = package();
        let template = p.matches[0].clone();
        p.matches.clear();
        for home in 0..20 {
            for away in 0..20 {
                if home != away {
                    let mut m = template.clone();
                    m.id = format!("{home}-{away}");
                    m.home_id = format!("t{home}");
                    m.away_id = format!("t{away}");
                    p.matches.push(m);
                }
            }
        }
        assert_eq!(p.summary().coverage.state, "complete");
        p.matches[0].status = "finished".into();
        assert_eq!(p.summary().coverage.missing_scores, 1);
        p.matches[0].home_id = p.matches[1].home_id.clone();
        p.matches[0].away_id = p.matches[1].away_id.clone();
        assert_eq!(p.summary().coverage.state, "partial");
        p.league_id = "l_0eg6C9".into();
        assert_eq!(p.summary().coverage.state, "unverified");
    }
}
