//! Local season history: a durable SQLite store of every league season the
//! app has fully loaded (matches with final scores), enabling offline season
//! browsing, head-to-head lookups, form lines and points-progression charts.
//!
//! Writes happen when the football layer loads a league dataset — the rows
//! are upserted, so refreshes are idempotent. Queries run locally: no
//! network, works fully offline.

use std::sync::Arc;

use crate::cache::now_ms;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMatch {
    pub id: String,
    pub league_id: String,
    pub season: String,
    pub home_id: String,
    pub home_name: String,
    pub away_id: String,
    pub away_name: String,
    pub home_score: i64,
    pub away_score: i64,
    pub status: String,
    /// ISO date (yyyy-mm-dd) or empty.
    pub date: String,
    /// Round name/number as reported by the provider.
    pub round: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryUpsert {
    pub league_id: String,
    pub season: String,
    pub league_name: String,
    pub matches: Vec<HistoryMatchIn>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMatchIn {
    pub id: String,
    pub home_id: String,
    pub home_name: String,
    pub away_id: String,
    pub away_name: String,
    #[serde(default)]
    pub home_score: Option<i64>,
    #[serde(default)]
    pub away_score: Option<i64>,
    pub status: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub round: String,
}

pub struct History {
    conn: std::sync::Mutex<rusqlite::Connection>,
    generation: std::sync::atomic::AtomicU64,
}

type SnapshotRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
    i64,
    String,
    String,
    String,
    i64,
);

fn read_snapshot(path: &std::path::Path) -> Result<Vec<SnapshotRow>, String> {
    let source =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "Повреждён снимок истории.")?;
    let check: String = source
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| "Повреждён снимок истории.")?;
    let unsafe_schema:i64=source.query_row("SELECT count(*) FROM sqlite_master WHERE type IN ('trigger','view') OR (type='table' AND name!='history_matches')",[],|r|r.get(0)).map_err(|_|"Некорректная база истории.")?;
    if check != "ok" || unsafe_schema != 0 {
        return Err("Некорректная база истории.".into());
    }
    // Materialise the vetted rows before changing the live database. Its
    // schema and indexes stay owned by the app; imported SQL is never run.
    let mut stmt=source.prepare("SELECT id,league_id,league_name,season,home_id,home_name,away_id,away_name,home_score,away_score,status,date,round,stored_at FROM history_matches LIMIT 500001").map_err(|_|"Неподдерживаемая структура истории.")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
                r.get::<_, String>(10)?,
                r.get::<_, String>(11)?,
                r.get::<_, String>(12)?,
                r.get::<_, i64>(13)?,
            ))
        })
        .map_err(|_| "История не читается.")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "История не читается.")?;
    if rows.len() > 500_000 {
        return Err("Слишком много матчей в истории.".into());
    }
    Ok(rows)
}

impl History {
    pub fn snapshot(&self, path: &std::path::Path) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|_| "История недоступна.")?;
        conn.backup(rusqlite::DatabaseName::Main, path, None)
            .map_err(|_| "Не удалось создать снимок истории.")?;
        Ok(self.generation.load(std::sync::atomic::Ordering::Relaxed))
    }
    pub fn validate_snapshot(path: &std::path::Path) -> Result<(), String> {
        read_snapshot(path).map(|_| ())
    }
    pub fn restore_snapshot(
        &self,
        path: &std::path::Path,
        expected_generation: u64,
    ) -> Result<(), String> {
        let rows = read_snapshot(path)?;
        let mut conn = self.conn.lock().map_err(|_| "История недоступна.")?;
        if self.generation.load(std::sync::atomic::Ordering::Relaxed) != expected_generation {
            return Err(
                "История изменилась после создания защитной копии. Повторите восстановление."
                    .into(),
            );
        }
        let tx = conn
            .transaction()
            .map_err(|_| "Не удалось начать восстановление.")?;
        tx.execute("DELETE FROM history_matches", [])
            .map_err(|_| "Не удалось восстановить историю.")?;
        for r in rows {
            tx.execute("INSERT INTO history_matches VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",rusqlite::params![r.0,r.1,r.2,r.3,r.4,r.5,r.6,r.7,r.8,r.9,r.10,r.11,r.12,r.13]).map_err(|_|"Не удалось восстановить историю.")?;
        }
        tx.commit()
            .map_err(|_| "Не удалось завершить восстановление.")?;
        self.generation
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    }
    pub fn open(dir: &std::path::Path) -> Result<Self, Box<dyn std::error::Error>> {
        let path = dir.join("history.sqlite3");
        let conn = rusqlite::Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history_matches (
                 id TEXT NOT NULL,
                 league_id TEXT NOT NULL,
                 league_name TEXT NOT NULL,
                 season TEXT NOT NULL,
                 home_id TEXT NOT NULL,
                 home_name TEXT NOT NULL,
                 away_id TEXT NOT NULL,
                 away_name TEXT NOT NULL,
                 home_score INTEGER NOT NULL,
                 away_score INTEGER NOT NULL,
                 status TEXT NOT NULL,
                 date TEXT NOT NULL,
                 round TEXT NOT NULL,
                 stored_at INTEGER NOT NULL,
                 PRIMARY KEY (league_id, season, id)
             );
             CREATE INDEX IF NOT EXISTS idx_history_home ON history_matches (home_id);
             CREATE INDEX IF NOT EXISTS idx_history_away ON history_matches (away_id);
             CREATE INDEX IF NOT EXISTS idx_history_date ON history_matches (date);",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            generation: std::sync::atomic::AtomicU64::new(0),
        })
    }

    /// Upsert one league season snapshot. Returns the stored row count.
    pub fn upsert_season(&self, batch: &HistoryUpsert) -> Result<usize, String> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| "История недоступна.".to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut stored = 0usize;
        for m in &batch.matches {
            let changed = tx
                .execute(
                    "INSERT INTO history_matches
                         (id, league_id, league_name, season, home_id, home_name, away_id, away_name,
                          home_score, away_score, status, date, round, stored_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                     ON CONFLICT(league_id, season, id) DO UPDATE SET
                         league_name = excluded.league_name,
                         home_id = excluded.home_id,
                         home_name = excluded.home_name,
                         away_id = excluded.away_id,
                         away_name = excluded.away_name,
                         home_score = excluded.home_score,
                         away_score = excluded.away_score,
                         status = excluded.status,
                         date = excluded.date,
                         round = excluded.round,
                         stored_at = excluded.stored_at",
                    rusqlite::params![
                        m.id,
                        batch.league_id,
                        batch.league_name,
                        batch.season,
                        m.home_id,
                        m.home_name,
                        m.away_id,
                        m.away_name,
                        m.home_score.unwrap_or(-1),
                        m.away_score.unwrap_or(-1),
                        m.status,
                        m.date,
                        m.round,
                        now_ms(),
                    ],
                )
                .map_err(|e| e.to_string())?;
            stored += changed;
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.generation
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(stored)
    }

    /// All matches between two teams (any league/season), newest first.
    pub fn head_to_head(&self, team_a: &str, team_b: &str) -> Result<Vec<HistoryMatch>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "История недоступна.".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, league_id, season, home_id, home_name, away_id, away_name,
                        home_score, away_score, status, date, round
                 FROM history_matches
                 WHERE (home_id = ?1 AND away_id = ?2) OR (home_id = ?2 AND away_id = ?1)
                 ORDER BY date DESC, id DESC
                 LIMIT 200",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![team_a, team_b], row_to_match)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// Matches of one team, newest first (finished with real scores by default).
    pub fn team_matches(
        &self,
        team_id: &str,
        finished_only: bool,
    ) -> Result<Vec<HistoryMatch>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "История недоступна.".to_string())?;
        let filter = if finished_only {
            "AND status = 'finished' AND home_score >= 0 AND away_score >= 0"
        } else {
            ""
        };
        let sql = format!(
            "SELECT id, league_id, season, home_id, home_name, away_id, away_name,
                    home_score, away_score, status, date, round
             FROM history_matches
             WHERE (home_id = ?1 OR away_id = ?1) {filter}
             ORDER BY date DESC, id DESC
             LIMIT 200"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![team_id], row_to_match)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// League seasons we have stored, with match counts.
    pub fn list_seasons(&self) -> Result<Vec<HistorySeasonInfo>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "История недоступна.".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT league_id, MAX(league_name), season, COUNT(*) AS n
                 FROM history_matches
                 GROUP BY league_id, season
                 ORDER BY season DESC, league_name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(HistorySeasonInfo {
                    league_id: r.get(0)?,
                    league_name: r.get(1)?,
                    season: r.get(2)?,
                    matches: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// One stored season, oldest-first (for progression charts).
    pub fn season_matches(
        &self,
        league_id: &str,
        season: &str,
    ) -> Result<Vec<HistoryMatch>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "История недоступна.".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, league_id, season, home_id, home_name, away_id, away_name,
                        home_score, away_score, status, date, round
                 FROM history_matches
                 WHERE league_id = ?1 AND season = ?2
                 ORDER BY date ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![league_id, season], row_to_match)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySeasonInfo {
    pub league_id: String,
    pub league_name: String,
    pub season: String,
    pub matches: i64,
}

fn row_to_match(r: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryMatch> {
    Ok(HistoryMatch {
        id: r.get(0)?,
        league_id: r.get(1)?,
        season: r.get(2)?,
        home_id: r.get(3)?,
        home_name: r.get(4)?,
        away_id: r.get(5)?,
        away_name: r.get(6)?,
        home_score: r.get(7)?,
        away_score: r.get(8)?,
        status: r.get(9)?,
        date: r.get(10)?,
        round: r.get(11)?,
    })
}

/// Shared state extension: history DB lives next to the cache DB.
pub struct HistoryState(pub Arc<History>);

pub fn open_history(data_dir: &std::path::Path) -> Result<History, String> {
    History::open(data_dir).map_err(|e| format!("Не удалось открыть историю: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_history() -> History {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("sd-history-test-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        History::open(&dir).unwrap()
    }

    fn batch(league: &str, season: &str, matches: Vec<HistoryMatchIn>) -> HistoryUpsert {
        HistoryUpsert {
            league_id: league.into(),
            league_name: "Test League".into(),
            season: season.into(),
            matches,
        }
    }

    fn m(id: &str, home: &str, away: &str, hs: i64, as_: i64, date: &str) -> HistoryMatchIn {
        HistoryMatchIn {
            id: id.into(),
            home_id: home.into(),
            home_name: home.into(),
            away_id: away.into(),
            away_name: away.into(),
            home_score: Some(hs),
            away_score: Some(as_),
            status: "finished".into(),
            date: date.into(),
            round: "1".into(),
        }
    }

    #[test]
    fn upsert_and_query_roundtrip() {
        let h = temp_history();
        let stored = h
            .upsert_season(&batch(
                "l_x",
                "2025/2026",
                vec![
                    m("m1", "A", "B", 2, 1, "2026-01-10"),
                    m("m2", "B", "A", 0, 0, "2026-02-01"),
                ],
            ))
            .unwrap();
        assert_eq!(stored, 2);
        let h2h = h.head_to_head("A", "B").unwrap();
        assert_eq!(h2h.len(), 2);
        // Newest first.
        assert_eq!(h2h[0].id, "m2");
        // Upsert same id with a new score — idempotent update.
        h.upsert_season(&batch(
            "l_x",
            "2025/2026",
            vec![m("m2", "B", "A", 1, 0, "2026-02-01")],
        ))
        .unwrap();
        let again = h.head_to_head("A", "B").unwrap();
        assert_eq!(again.len(), 2);
        assert_eq!(again[0].home_score, 1);
    }

    #[test]
    fn team_matches_and_seasons() {
        let h = temp_history();
        h.upsert_season(&batch(
            "l_y",
            "2026",
            vec![
                m("k1", "C", "D", 1, 1, "2026-03-01"),
                m("k2", "E", "C", 3, 0, "2026-03-08"),
            ],
        ))
        .unwrap();
        let team = h.team_matches("C", true).unwrap();
        assert_eq!(team.len(), 2);
        let seasons = h.list_seasons().unwrap();
        assert_eq!(seasons.len(), 1);
        assert_eq!(seasons[0].matches, 2);
        let season = h.season_matches("l_y", "2026").unwrap();
        assert_eq!(season.len(), 2);
        assert_eq!(season[0].id, "k1");
    }

    #[test]
    fn upsert_refreshes_names_and_team_ids() {
        let h = temp_history();
        h.upsert_season(&batch(
            "league",
            "2026",
            vec![m("id", "old", "away", 1, 0, "2026-01-01")],
        ))
        .unwrap();
        let mut corrected = m("id", "new", "away2", 2, 0, "2026-01-01");
        corrected.home_name = "New name".into();
        corrected.away_name = "Away name".into();
        let mut update = batch("league", "2026", vec![corrected]);
        update.league_name = "Renamed league".into();
        h.upsert_season(&update).unwrap();
        assert!(h.team_matches("old", true).unwrap().is_empty());
        let found = h.head_to_head("new", "away2").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].home_name, "New name");
        assert_eq!(found[0].away_name, "Away name");
        assert_eq!(h.list_seasons().unwrap()[0].league_name, "Renamed league");
    }
}
