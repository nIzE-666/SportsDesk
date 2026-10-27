//! SQLite cache keyed by source/path with fetchedAt and TTL. Lives in the
//! app-local data directory. Stale rows are returned after transient errors.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

pub struct Cache {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone)]
pub struct CacheRow {
    pub payload: serde_json::Value,
    pub fetched_at_ms: i64,
}

impl Cache {
    pub fn diagnostics(&self) -> Vec<serde_json::Value> {
        let Ok(conn) = self.conn.lock() else {
            return Vec::new();
        };
        let Ok(mut q)=conn.prepare("SELECT source,count(*),max(fetched_at),min(fetched_at) FROM api_cache WHERE source IN ('pitch','sportscore','espn','jolpica','openf1') GROUP BY source")else{return Vec::new()};
        q.query_map([],|r|Ok(serde_json::json!({"source":r.get::<_,String>(0)?,"entries":r.get::<_,i64>(1)?,"latestAt":r.get::<_,i64>(2)?,"oldestAt":r.get::<_,i64>(3)?}))).map(|rows|rows.filter_map(Result::ok).collect()).unwrap_or_default()
    }
    pub fn open(dir: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let path = dir.join("cache.sqlite3");
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS api_cache (
                 source TEXT NOT NULL,
                 path TEXT NOT NULL,
                 payload TEXT NOT NULL,
                 fetched_at INTEGER NOT NULL,
                 PRIMARY KEY (source, path)
             );\n             CREATE INDEX IF NOT EXISTS idx_cache_fetched ON api_cache (fetched_at);
             CREATE TABLE IF NOT EXISTS event_center (id TEXT PRIMARY KEY, payload TEXT NOT NULL, occurred_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
             CREATE INDEX IF NOT EXISTS idx_events_occurred ON event_center (occurred_at DESC);",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory cache for tests and tooling (no file, no WAL).
    #[cfg(test)]
    pub fn open_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS api_cache (
                 source TEXT NOT NULL,
                 path TEXT NOT NULL,
                 payload TEXT NOT NULL,
                 fetched_at INTEGER NOT NULL,
                 PRIMARY KEY (source, path)
             );
             CREATE TABLE IF NOT EXISTS event_center (id TEXT PRIMARY KEY, payload TEXT NOT NULL, occurred_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
             CREATE INDEX IF NOT EXISTS idx_events_occurred ON event_center (occurred_at DESC);",
        )
        .expect("create in-memory table");
        Self {
            conn: Mutex::new(conn),
        }
    }

    pub fn insert_event(
        &self,
        event: &crate::event_center::Event,
        now: i64,
    ) -> Result<bool, String> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| "Кеш недоступен.".to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM event_center WHERE occurred_at < ?1",
            [now - crate::event_center::RETENTION_MS],
        )
        .map_err(|e| e.to_string())?;
        let payload = serde_json::to_string(event).map_err(|e| e.to_string())?;
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO event_center (id, payload, occurred_at) VALUES (?1, ?2, ?3)",
                params![event.id, payload, event.occurred_at],
            )
            .map_err(|e| e.to_string())?
            > 0;
        tx.execute("DELETE FROM event_center WHERE id IN (SELECT id FROM event_center ORDER BY occurred_at DESC, id DESC LIMIT -1 OFFSET 500)", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(inserted)
    }

    pub fn list_events(&self, now: i64) -> Result<Vec<crate::event_center::Event>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "Кеш недоступен.".to_string())?;
        conn.execute(
            "DELETE FROM event_center WHERE occurred_at < ?1",
            [now - crate::event_center::RETENTION_MS],
        )
        .map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT payload, read FROM event_center ORDER BY occurred_at DESC, id DESC LIMIT 500").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut events = Vec::new();
        for row in rows {
            let (payload, read) = row.map_err(|e| e.to_string())?;
            let mut event: crate::event_center::Event =
                serde_json::from_str(&payload).map_err(|e| e.to_string())?;
            event.read = read;
            events.push(event);
        }
        Ok(events)
    }

    pub fn mark_events_read(&self, ids: &[String]) -> Result<(), String> {
        if ids.len() > 500 || ids.iter().any(|id| id.is_empty() || id.len() > 1024) {
            return Err("Некорректный список событий.".into());
        }
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| "Кеш недоступен.".to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for id in ids {
            tx.execute("UPDATE event_center SET read = 1 WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn get(&self, source: &str, path: &str) -> Option<CacheRow> {
        let conn = self.conn.lock().ok()?;
        let mut stmt = conn
            .prepare("SELECT payload, fetched_at FROM api_cache WHERE source = ?1 AND path = ?2")
            .ok()?;
        let row = stmt
            .query_row(params![source, path], |r| {
                let payload: String = r.get(0)?;
                let fetched_at: i64 = r.get(1)?;
                Ok((payload, fetched_at))
            })
            .optional()
            .ok()??;
        let payload: serde_json::Value = serde_json::from_str(&row.0).ok()?;
        Some(CacheRow {
            payload,
            fetched_at_ms: row.1,
        })
    }

    pub fn put(
        &self,
        source: &str,
        path: &str,
        payload: &serde_json::Value,
        fetched_at_ms: i64,
    ) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "Кеш недоступен.".to_string())?;
        let text =
            serde_json::to_string(payload).map_err(|_| "Кеш: некорректные данные.".to_string())?;
        conn.execute(
            "INSERT INTO api_cache (source, path, payload, fetched_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(source, path) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at",
            params![source, path, text, fetched_at_ms],
        )
        .map_err(|_| "Кеш: запись не удалась.".to_string())?;
        Ok(())
    }

    pub fn prune(&self, older_than_ms: i64) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "DELETE FROM api_cache WHERE fetched_at < ?1",
                params![older_than_ms],
            );
        }
    }

    /// Prunes rows of one synthetic source (used by the notification dedup
    /// store, which lives in the same DB under source 'dedup').
    pub fn prune_source(&self, source: &str, older_than_ms: i64) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "DELETE FROM api_cache WHERE source = ?1 AND fetched_at < ?2",
                params![source, older_than_ms],
            );
        }
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// ISO-8601 UTC from epoch millis (public helper shared by other modules).
pub fn iso_utc_ms(ms: i64) -> String {
    let total_secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = total_secs.div_euclid(86_400);
    let secs_of_day = total_secs.rem_euclid(86_400);
    // Days from civil (Howard Hinnant).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        m,
        d,
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
        millis
    )
}
