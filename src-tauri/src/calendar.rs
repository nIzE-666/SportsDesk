//! Calendar export: builds a standards-compliant .ics file from the cached
//! PitchAPI league datasets for the user's favourite teams, and writes it to
//! a user-chosen path (the save dialog is handled by the frontend plugin).
//!
//! Every event carries a VALARM so Windows Calendar shows a native reminder;
//! no network is touched — only the SQLite cache.

use std::sync::Arc;

use crate::bridge::AppStateInner;
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, Utc};

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CalendarMatch {
    pub id: String,
    pub home: String,
    pub away: String,
    /// ISO-like local time "2026-10-21 18:00:00" or ISO 8601.
    pub time: String,
}

/// Windows Calendar accepts CRLF-separated lines; fold long ones at 75 octets.
fn escape_text(s: &str) -> String {
    s.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

fn fold_line(line: &str) -> String {
    if line.len() <= 73 {
        return line.to_string();
    }
    let mut out = String::new();
    let mut rest = line;
    let mut first = true;
    while rest.len() > 73 {
        let mut boundary = 73;
        while !rest.is_char_boundary(boundary) {
            boundary -= 1;
        }
        let (chunk, tail) = rest.split_at(boundary);
        if first {
            out.push_str(chunk);
            first = false;
        } else {
            out.push_str("\r\n ");
            out.push_str(chunk);
        }
        rest = tail;
    }
    if !rest.is_empty() {
        if !first {
            out.push_str("\r\n ");
        }
        out.push_str(rest);
    }
    out
}

/// Pitch timestamps without an offset are UTC. Reject invalid dates and offsets.
fn parse_utc(time: &str) -> Option<DateTime<Utc>> {
    let text = time.trim();
    if let Ok(parsed) = DateTime::parse_from_rfc3339(text) {
        return Some(parsed.with_timezone(&Utc));
    }
    for format in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"] {
        if let Ok(parsed) = NaiveDateTime::parse_from_str(text, format) {
            return Some(parsed.and_utc());
        }
    }
    None
}

#[cfg(test)]
fn ical_utc(time: &str) -> Option<String> {
    Some(parse_utc(time)?.format("%Y%m%dT%H%M%SZ").to_string())
}

#[cfg(test)]
fn end_utc(time: &str) -> Option<String> {
    Some(
        (parse_utc(time)? + Duration::minutes(105))
            .format("%Y%m%dT%H%M%SZ")
            .to_string(),
    )
}

pub fn build_ics(
    _state: &Arc<AppStateInner>,
    matches: &[CalendarMatch],
    reminder_minutes: i64,
) -> String {
    let mut out = String::new();
    out.push_str("BEGIN:VCALENDAR\r\n");
    out.push_str("VERSION:2.0\r\n");
    out.push_str("PRODID:-//SportsDesk//Personal Sports Hub//RU\r\n");
    out.push_str("CALSCALE:GREGORIAN\r\n");
    for m in matches {
        let date = NaiveDate::parse_from_str(&m.time, "%Y-%m-%d").ok();
        let (start, end, all_day) = if let Some(date) = date {
            let Some(next) = date.succ_opt() else {
                continue;
            };
            (
                date.format("%Y%m%d").to_string(),
                next.format("%Y%m%d").to_string(),
                true,
            )
        } else {
            let Some(time) = parse_utc(&m.time) else {
                continue;
            };
            (
                time.format("%Y%m%dT%H%M%SZ").to_string(),
                (time + Duration::minutes(105))
                    .format("%Y%m%dT%H%M%SZ")
                    .to_string(),
                false,
            )
        };
        let uid = format!("{}@sportsdesk.local", m.id.replace(['\r', '\n'], ""));
        let summary = escape_text(&format!("{} — {}", m.home, m.away));
        let mut event = String::new();
        event.push_str("BEGIN:VEVENT\r\n");
        event.push_str(&format!("UID:{uid}\r\n"));
        event.push_str(&format!(
            "DTSTAMP:{}\r\n",
            Utc::now().format("%Y%m%dT%H%M%SZ")
        ));
        let qualifier = if all_day { ";VALUE=DATE" } else { "" };
        event.push_str(&format!("DTSTART{qualifier}:{start}\r\n"));
        event.push_str(&format!("DTEND{qualifier}:{end}\r\n"));
        event.push_str(&format!("SUMMARY:{summary}\r\n"));
        event.push_str(&format!("DESCRIPTION:{summary} (SportsDesk)\r\n"));
        if reminder_minutes > 0 && !all_day {
            event.push_str(&format!(
                "BEGIN:VALARM\r\nTRIGGER:-PT{reminder_minutes}M\r\nACTION:DISPLAY\r\nDESCRIPTION:Матч скоро начнётся\r\nEND:VALARM\r\n"
            ));
        }
        event.push_str("END:VEVENT\r\n");
        for line in event.split("\r\n") {
            if line.is_empty() {
                continue;
            }
            out.push_str(&fold_line(line));
            out.push_str("\r\n");
        }
    }
    out.push_str("END:VCALENDAR\r\n");
    out
}

/// Writes the .ics to a file. The path comes from the frontend save dialog.
pub fn write_ics(path: &str, content: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if p.extension()
        .and_then(|e| e.to_str())
        .map(|e| !e.eq_ignore_ascii_case("ics"))
        .unwrap_or(true)
    {
        return Err("Файл должен иметь расширение .ics".into());
    }
    std::fs::write(p, content).map_err(|e| format!("Не удалось записать файл: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ical_utc_parses_plain_and_iso() {
        assert_eq!(
            ical_utc("2026-10-21 18:00:00").as_deref(),
            Some("20261021T180000Z")
        );
        assert_eq!(
            ical_utc("2026-10-21T18:00:00Z").as_deref(),
            Some("20261021T180000Z")
        );
        assert_eq!(
            ical_utc("2026-10-21T20:00:00+02:00").as_deref(),
            Some("20261021T180000Z")
        );
        assert!(ical_utc("nonsense").is_none());
    }

    #[test]
    fn end_utc_adds_105_minutes() {
        let start = ical_utc("2026-10-21 18:00:00").unwrap();
        let end = end_utc("2026-10-21 18:00:00").unwrap();
        assert_eq!(start, "20261021T180000Z".to_string());
        assert_eq!(end, "20261021T194500Z".to_string());
    }

    #[test]
    fn ics_has_structure_and_alarm() {
        let matches = vec![CalendarMatch {
            id: "m1".into(),
            home: "Arsenal; FC".into(),
            away: "Chelsea".into(),
            time: "2026-10-21 18:00:00".into(),
        }];
        let state = Arc::new(crate::bridge::AppStateInner {
            client: crate::bridge::http_client(),
            cache: crate::cache::Cache::open_in_memory(),
            concurrency: crate::bridge::Concurrency::new(),
        });
        let ics = build_ics(&state, &matches, 15);
        assert!(ics.starts_with("BEGIN:VCALENDAR"));
        assert!(ics.contains("UID:m1@sportsdesk.local"));
        assert!(ics.contains("SUMMARY:Arsenal\\; FC — Chelsea"));
        assert!(ics.contains("TRIGGER:-PT15M"));
        assert!(ics.ends_with("END:VCALENDAR\r\n"));
    }

    #[test]
    fn date_only_fixtures_are_all_day_and_invalid_dates_are_skipped() {
        let state = Arc::new(crate::bridge::AppStateInner {
            client: crate::bridge::http_client(),
            cache: crate::cache::Cache::open_in_memory(),
            concurrency: crate::bridge::Concurrency::new(),
        });
        let matches = vec![
            CalendarMatch {
                id: "day".into(),
                home: "A".into(),
                away: "B".into(),
                time: "2026-10-21".into(),
            },
            CalendarMatch {
                id: "invalid".into(),
                home: "C".into(),
                away: "D".into(),
                time: "2026-02-30T18:00:00Z".into(),
            },
        ];
        let ics = build_ics(&state, &matches, 15);
        assert!(ics.contains("DTSTART;VALUE=DATE:20261021\r\n"));
        assert!(ics.contains("DTEND;VALUE=DATE:20261022\r\n"));
        assert!(!ics.contains("VALARM"));
        assert!(!ics.contains("UID:invalid"));
    }

    #[test]
    fn fold_line_respects_limit() {
        let long = "SUMMARY:".to_string() + &"x".repeat(200);
        let folded = fold_line(&long);
        for line in folded.split("\r\n ") {
            assert!(line.len() <= 75, "line too long: {}", line.len());
        }
    }

    #[test]
    fn folds_unicode_without_splitting_codepoints_or_losing_text() {
        for text in [
            "Манчестер Юнайтед — Атлетико Мадрид ".repeat(8),
            "⚽🏎️ 日本語 ".repeat(20),
        ] {
            let line = format!("SUMMARY:{text}");
            let folded = fold_line(&line);
            assert_eq!(folded.replace("\r\n ", ""), line);
            assert!(folded.split("\r\n").all(|part| part.len() <= 75));
        }
    }
}
