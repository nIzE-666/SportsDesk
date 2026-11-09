use chrono::{TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct EventTypes {
    pub goals: bool,
    pub start: bool,
    pub end: bool,
    pub reminder: bool,
}
impl Default for EventTypes {
    fn default() -> Self {
        Self {
            goals: true,
            start: true,
            end: true,
            reminder: true,
        }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamPolicy {
    pub enabled: bool,
    #[serde(flatten)]
    pub events: EventTypes,
}
impl Default for TeamPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            events: EventTypes::default(),
        }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct NotificationPolicy {
    pub events: EventTypes,
    pub quiet_enabled: bool,
    pub quiet_start: String,
    pub quiet_end: String,
    pub reminder_minutes: u32,
    pub teams: BTreeMap<String, TeamPolicy>,
}
impl Default for NotificationPolicy {
    fn default() -> Self {
        Self {
            events: EventTypes::default(),
            quiet_enabled: false,
            quiet_start: "23:00".into(),
            quiet_end: "08:00".into(),
            reminder_minutes: 15,
            teams: BTreeMap::new(),
        }
    }
}
fn clock(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    let h = h.parse::<u32>().ok()?;
    let m = m.parse::<u32>().ok()?;
    if h < 24 && m < 60 {
        Some(h * 60 + m)
    } else {
        None
    }
}
impl EventTypes {
    pub fn allows(&self, kind: &str) -> bool {
        match kind {
            "goal" => self.goals,
            "start" => self.start,
            "end" => self.end,
            "reminder" => self.reminder,
            _ => false,
        }
    }
}
impl NotificationPolicy {
    pub fn quiet(&self, timezone: &str, now: i64) -> bool {
        if !self.quiet_enabled {
            return false;
        }
        let (Some(start), Some(end)) = (clock(&self.quiet_start), clock(&self.quiet_end)) else {
            return false;
        };
        let zone = timezone.parse::<chrono_tz::Tz>().unwrap_or(chrono_tz::UTC);
        let Some(utc) = Utc.timestamp_millis_opt(now).single() else {
            return false;
        };
        let time = utc.with_timezone(&zone);
        let minute = time.hour() * 60 + time.minute();
        if start == end {
            true
        } else if start < end {
            minute >= start && minute < end
        } else {
            minute >= start || minute < end
        }
    }
    pub fn allows(&self, kind: &str, team_ids: &[&str], timezone: &str, now: i64) -> bool {
        if self.quiet(timezone, now) || !self.events.allows(kind) {
            return false;
        }
        // A derby of two favourites may notify if either club is enabled.
        team_ids.is_empty()
            || team_ids.iter().any(|id| {
                self.teams
                    .get(*id)
                    .map(|p| p.enabled && p.events.allows(kind))
                    .unwrap_or(true)
            })
    }
    pub fn lead_ms(&self) -> i64 {
        self.reminder_minutes.clamp(1, 120) as i64 * 60_000
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn at(s: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .timestamp_millis()
    }
    #[test]
    fn midnight_and_dst_use_selected_wall_clock() {
        let mut p = NotificationPolicy {
            quiet_enabled: true,
            ..Default::default()
        };
        assert!(p.quiet("Asia/Yakutsk", at("2026-10-25T15:30:00Z")));
        assert!(!p.quiet("Asia/Yakutsk", at("2026-10-25T23:00:00Z")));
        p.quiet_start = "01:00".into();
        p.quiet_end = "02:00".into();
        assert!(p.quiet("Europe/London", at("2026-10-25T00:30:00Z")));
        assert!(p.quiet("Europe/London", at("2026-10-25T01:30:00Z")));
        assert!(!p.quiet("Europe/London", at("2026-10-25T02:00:00Z")));
    }
    #[test]
    fn team_and_event_controls_and_lead_are_enforced() {
        let mut p = NotificationPolicy::default();
        let off = TeamPolicy {
            enabled: false,
            ..Default::default()
        };
        p.teams.insert("t_a".into(), off);
        assert!(!p.allows("goal", &["t_a"], "UTC", 0));
        assert!(p.allows("goal", &["t_a", "t_b"], "UTC", 0));
        p.events.goals = false;
        assert!(!p.allows("goal", &["t_b"], "UTC", 0));
        assert!(p.allows("start", &["t_b"], "UTC", 0));
        p.reminder_minutes = 0;
        assert_eq!(p.lead_ms(), 60_000);
    }
}
