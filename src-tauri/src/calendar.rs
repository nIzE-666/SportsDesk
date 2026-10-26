//! Calendar export: builds a standards-compliant .ics file from the cached
//! PitchAPI league datasets for the user's favourite teams, and writes it to
//! a user-chosen path (the save dialog is handled by the frontend plugin).
//!
//! Every event carries a VALARM so Windows Calendar shows a native reminder;
//! no network is touched — only the SQLite cache.

use std::sync::Arc;

use crate::bridge::AppStateInner;

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
    s.replace('\\', "\\\\")
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

/// Parses "2026-10-21 18:00:00" / ISO 8601 to an iCal UTC timestamp.
fn ical_utc(time: &str) -> Option<String> {
    let t = time.trim();
    let iso = if t.len() == 19 && !t.contains('T') {
        t.replace(' ', "T")
    } else {
        t.to_string()
    };
    let y: i64 = iso.get(0..4)?.parse().ok()?;
    let mo: i64 = iso.get(5..7)?.parse().ok()?;
    let d: i64 = iso.get(8..10)?.parse().ok()?;
    let hh: i64 = iso.get(11..13)?.parse().ok()?;
    let mm: i64 = iso.get(14..16)?.parse().ok()?;
    let ss: i64 = iso.get(17..19)?.parse().ok()?;

    // Match times from PitchAPI come as UTC; treat the input as UTC (Z) unless
    // an explicit offset is present.
    let offset_secs: i64 = if let Some(pos) = iso
        .rfind('+')
        .or_else(|| iso.rfind('-').filter(|_| iso.len() > 19))
    {
        let sign = if iso.as_bytes()[pos] == b'+' { 1 } else { -1 };
        let off = iso.get(pos + 1..)?;
        let (oh, om) = off
            .split_once(':')
            .unwrap_or((off.get(0..2).unwrap_or("0"), "0"));
        sign * (oh
            .trim_end_matches(|c: char| !c.is_ascii_digit())
            .parse::<i64>()
            .unwrap_or(0)
            * 3600
            + om.trim_end_matches(|c: char| !c.is_ascii_digit())
                .parse::<i64>()
                .unwrap_or(0)
                * 60)
    } else {
        0
    };

    let y_adj = if mo <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = y_adj - era * 400;
    let mp = if mo > 2 { mo - 3 } else { mo + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86_400 + hh * 3600 + mm * 60 + ss - offset_secs;

    // Normalize into a UTC calendar date.
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let zy_adj_days = days;
    let era2 = if zy_adj_days >= 0 {
        zy_adj_days
    } else {
        zy_adj_days - 399
    } / 146097;
    // days -> civil (Howard Hinnant)
    let z = days + 719_468;
    let era_c = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe_c = z - era_c * 146_097;
    let yoe_c = (doe_c - doe_c / 1460 + doe_c / 36_524 - doe_c / 146_096) / 365;
    let yy = yoe_c + era_c * 400;
    let doy_c = doe_c - (365 * yoe_c + yoe_c / 4 - yoe_c / 100);
    let mp_c = (5 * doy_c + 2) / 153;
    let dd = doy_c - (153 * mp_c + 2) / 5 + 1;
    let mm_c = if mp_c < 10 { mp_c + 3 } else { mp_c - 9 };
    let final_y = if mm_c <= 2 { yy + 1 } else { yy };
    let _ = (era2,);
    Some(format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        final_y,
        mm_c,
        dd,
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    ))
}

/// Duration in minutes for a football match (105 = 90 + HT + stoppages).
fn end_utc(start: &str) -> Option<String> {
    let stamp = ical_utc(start)?;
    // Parse back to seconds, add 105 minutes.
    let y: i64 = stamp.get(0..4)?.parse().ok()?;
    let mo: i64 = stamp.get(4..6)?.parse().ok()?;
    let d: i64 = stamp.get(6..8)?.parse().ok()?;
    let hh: i64 = stamp.get(9..11)?.parse().ok()?;
    let mm: i64 = stamp.get(11..13)?.parse().ok()?;
    let ss: i64 = stamp.get(13..15)?.parse().ok()?;
    let y_adj = if mo <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = y_adj - era * 400;
    let mp = if mo > 2 { mo - 3 } else { mo + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86_400 + hh * 3600 + mm * 60 + ss + 105 * 60;
    let nd = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let z = nd + 719_468;
    let era_c = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe_c = z - era_c * 146_097;
    let yoe_c = (doe_c - doe_c / 1460 + doe_c / 36_524 - doe_c / 146_096) / 365;
    let yy = yoe_c + era_c * 400;
    let doy_c = doe_c - (365 * yoe_c + yoe_c / 4 - yoe_c / 100);
    let mp_c = (5 * doy_c + 2) / 153;
    let dd = doy_c - (153 * mp_c + 2) / 5 + 1;
    let mm_c = if mp_c < 10 { mp_c + 3 } else { mp_c - 9 };
    let final_y = if mm_c <= 2 { yy + 1 } else { yy };
    Some(format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        final_y,
        mm_c,
        dd,
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    ))
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
        let Some(start) = ical_utc(&m.time) else {
            continue;
        };
        let end = end_utc(&m.time).unwrap_or_else(|| start.clone());
        let uid = format!("{}@sportsdesk.local", m.id);
        let summary = escape_text(&format!("{} — {}", m.home, m.away));
        let mut event = String::new();
        event.push_str("BEGIN:VEVENT\r\n");
        event.push_str(&format!("UID:{uid}\r\n"));
        event.push_str(&format!("DTSTAMP:{start}\r\n"));
        event.push_str(&format!("DTSTART:{start}\r\n"));
        event.push_str(&format!("DTEND:{end}\r\n"));
        event.push_str(&format!("SUMMARY:{summary}\r\n"));
        event.push_str(&format!("DESCRIPTION:{summary} (SportsDesk)\r\n"));
        if reminder_minutes > 0 {
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
