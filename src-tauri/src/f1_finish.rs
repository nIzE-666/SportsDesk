//! Клетчатый флаг и подиум: наблюдатель за опубликованными итогами гонки и
//! спринта Ф1.
//!
//! - Финиш подтверждается только опубликованными итогами Jolpica с полным
//!   подиумом. Расписание лишь определяет, когда стоит спрашивать; победитель
//!   никогда не выбирается по текущему лидеру или расчётному времени.
//! - Праздник «живой»: наблюдатель сам видел сессию без итогов не более
//!   `LIVE_GAP_MS` назад. После запуска приложения, сна или долгого сбоя сети
//!   итоги записываются в Центр событий молча, без `sportsdesk://f1-finish`.
//! - Событие Центра событий (`f1|result|<сезон>|<этап>|<сессия>`) то же, что у
//!   «Пока вас не было»: `INSERT OR IGNORE` не даёт ни дублей, ни повторного
//!   праздника после исправления итогов или перезапуска. Если событие уже
//!   записала догрузка, праздника нет.
//! - Запросы идут через общий кеш моста: интерфейс и наблюдатель не удваивают
//!   нагрузку на Jolpica, а пустой ответ кешируется всего 2 минуты.
//! - Никакой std::sync::Mutex не удерживается через .await.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;

use crate::bridge::{fetch_with_cache, AppStateInner};
use crate::cache::{now_ms, Cache};
use crate::catchup::{results_path, scheduled_sessions, F1Session};
use crate::event_center::{record_checked, Event};
use crate::poller::Poller;

const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;
const STARTUP_DELAY: Duration = Duration::from_secs(20);
const TICK: Duration = Duration::from_secs(60);
const SCHEDULE_PATH: &str = "current.json?limit=100";
/// Событие для интерфейса: итоги только что опубликованы и приложение это видело.
pub const FINISH_EVENT: &str = "sportsdesk://f1-finish";
/// Как часто спрашивать итоги одной сессии.
const CHECK_EVERY_MS: i64 = 3 * MINUTE;
/// Праздник возможен, только если сессию без итогов видели не раньше.
const LIVE_GAP_MS: i64 = 20 * MINUTE;

/// Окно, в котором стоит спрашивать итоги: от самого раннего правдоподобного
/// финиша до нескольких часов после расчётного конца. Квалификации не ждём.
fn watch_window(sid: &str) -> Option<(i64, i64)> {
    match sid {
        "race" => Some((HOUR, 12 * HOUR)),
        "sprint" => Some((30 * MINUTE, 6 * HOUR)),
        _ => None,
    }
}

/// Гонки и спринты, итоги которых сейчас стоит проверять.
pub fn live_sessions(schedule: &Value, now: i64) -> Vec<F1Session> {
    scheduled_sessions(schedule)
        .into_iter()
        .filter(|(session, start)| {
            watch_window(session.sid)
                .is_some_and(|(after, until)| now >= start + after && now <= start + until)
        })
        .map(|(session, _)| session)
        .collect()
}

fn session_key(session: &F1Session) -> String {
    format!("{}|{}|{}", session.season, session.round, session.sid)
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodiumEntry {
    pub position: u8,
    pub driver: String,
    pub team: Option<String>,
    pub constructor_id: Option<String>,
}

/// То, что уходит в интерфейс.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finish {
    pub id: String,
    pub season: String,
    pub round: String,
    pub session: String,
    pub label: String,
    pub race_name: String,
    pub podium: Vec<PodiumEntry>,
}

/// Место в итогах считается только у классифицированного пилота: у
/// выбывших и дисквалифицированных `positionText` — «R», «D», «W».
fn classified_position(row: &Value) -> Option<u8> {
    let position: u8 = text(row, "position")?.parse().ok()?;
    (text(row, "positionText")? == position.to_string()).then_some(position)
}

fn podium_entry(row: &Value, position: u8) -> Option<PodiumEntry> {
    let driver = row.get("Driver")?;
    let name = [text(driver, "givenName"), text(driver, "familyName")]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    if name.is_empty() {
        return None;
    }
    let constructor = row.get("Constructor");
    Some(PodiumEntry {
        position,
        driver: name,
        team: constructor.and_then(|c| text(c, "name")).map(str::to_owned),
        constructor_id: constructor
            .and_then(|c| text(c, "constructorId"))
            .map(str::to_owned),
    })
}

/// Подиум из итогов Jolpica. `None` — итоги не опубликованы или неполны:
/// без трёх классифицированных финишёров ничего не объявляется.
pub fn podium(session: &F1Session, payload: &Value) -> Option<Vec<PodiumEntry>> {
    let race = payload.pointer("/MRData/RaceTable/Races/0")?;
    let key = match session.sid {
        "race" => "Results",
        "sprint" => "SprintResults",
        _ => return None,
    };
    let rows = race.get(key)?.as_array()?;
    (1..=3u8)
        .map(|position| {
            let row = rows
                .iter()
                .find(|row| classified_position(row) == Some(position))?;
            podium_entry(row, position)
        })
        .collect()
}

/// Запись для Центра событий: тот же id, заголовок и текст, что у «Пока вас не
/// было», но время — когда итоги стали известны приложению.
pub fn finish_event(session: &F1Session, podium: &[PodiumEntry], now: i64) -> Option<Event> {
    let winner = podium.first()?;
    let who = match &winner.team {
        Some(team) => format!("{} ({team})", winner.driver),
        None => winner.driver.clone(),
    };
    Some(Event {
        id: format!(
            "f1|result|{}|{}|{}",
            session.season, session.round, session.sid
        ),
        sport: "f1".into(),
        kind: "result".into(),
        title: format!("{}: итоги", session.label),
        body: format!("{} · победитель: {who}", session.race_name),
        occurred_at: now,
        read: false,
        match_id: None,
        league_id: None,
        season: Some(session.season.clone()),
        round: Some(session.round.clone()),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Приложение само видело, как итоги появились: можно праздновать.
    Live,
    /// Итоги найдены, но праздника быть не должно (старая сессия).
    Silent,
}

#[derive(Debug, Clone, Copy)]
struct Seen {
    /// Когда сессию в последний раз видели без итогов.
    unpublished_at: Option<i64>,
    next_check: i64,
    /// Итоги уже найдены: сессию больше не опрашиваем.
    done: bool,
}

/// Состояние наблюдателя в памяти процесса. После перезапуска он ничего не
/// «помнит», поэтому уже опубликованные итоги никогда не считаются живыми.
#[derive(Debug, Default)]
pub struct Watcher {
    seen: HashMap<String, Seen>,
}

impl Watcher {
    fn entry(&mut self, key: &str) -> &mut Seen {
        self.seen.entry(key.to_string()).or_insert(Seen {
            unpublished_at: None,
            next_check: 0,
            done: false,
        })
    }

    pub fn due(&self, key: &str, now: i64) -> bool {
        match self.seen.get(key) {
            Some(seen) => !seen.done && now >= seen.next_check,
            None => true,
        }
    }

    /// Итогов пока нет.
    pub fn unpublished(&mut self, key: &str, now: i64) {
        let seen = self.entry(key);
        seen.unpublished_at = Some(now);
        seen.next_check = now + CHECK_EVERY_MS;
    }

    /// Ответ не получен или устарел: ничего не известно, повторим позже.
    pub fn failed(&mut self, key: &str, now: i64) {
        self.entry(key).next_check = now + CHECK_EVERY_MS;
    }

    /// Итоги найдены.
    pub fn published(&mut self, key: &str, now: i64) -> Verdict {
        let seen = self.entry(key);
        let live = !seen.done
            && seen
                .unpublished_at
                .is_some_and(|at| now - at <= LIVE_GAP_MS);
        seen.done = true;
        if live {
            Verdict::Live
        } else {
            Verdict::Silent
        }
    }

    /// Забывает сессии, которые вышли из окна наблюдения.
    pub fn retain(&mut self, keys: &HashSet<String>) {
        self.seen.retain(|key, _| keys.contains(key));
    }
}

/// Записывает итоги в Центр событий и, если они живые и новые, сообщает
/// интерфейсу. Возвращает, было ли отправлено событие праздника.
fn announce(
    app: &AppHandle,
    cache: &Cache,
    session: &F1Session,
    podium: Vec<PodiumEntry>,
    verdict: Verdict,
    now: i64,
) -> bool {
    let Some(event) = finish_event(session, &podium, now) else {
        return false;
    };
    let id = event.id.clone();
    let inserted = record_checked(app, cache, &event);
    if !inserted || verdict != Verdict::Live {
        return false;
    }
    let finish = Finish {
        id,
        season: session.season.clone(),
        round: session.round.clone(),
        session: session.sid.to_string(),
        label: session.label.to_string(),
        race_name: session.race_name.clone(),
        podium,
    };
    app.emit(FINISH_EVENT, finish).is_ok()
}

async fn tick(app: &AppHandle, poller: &Poller, state: &Arc<AppStateInner>, watcher: &mut Watcher) {
    // Лента F1 выключена пользователем: итоги не нужны.
    if !poller.config().f1_reminders {
        return;
    }
    let schedule =
        match fetch_with_cache(state.clone(), "jolpica".into(), SCHEDULE_PATH.into()).await {
            Ok(reply) if !reply.stale => reply.payload,
            _ => return,
        };
    let sessions = live_sessions(&schedule, now_ms());
    watcher.retain(&sessions.iter().map(session_key).collect());
    for session in sessions {
        let key = session_key(&session);
        if !watcher.due(&key, now_ms()) {
            continue;
        }
        let reply =
            match fetch_with_cache(state.clone(), "jolpica".into(), results_path(&session)).await {
                Ok(reply) if !reply.stale => reply,
                _ => {
                    watcher.failed(&key, now_ms());
                    continue;
                }
            };
        match podium(&session, &reply.payload) {
            None => watcher.unpublished(&key, now_ms()),
            Some(podium) => {
                let now = now_ms();
                let verdict = watcher.published(&key, now);
                announce(app, &state.cache, &session, podium, verdict, now);
            }
        }
    }
}

/// Точка входа из lib.rs.
pub fn start(app: AppHandle, poller: Arc<Poller>, state: Arc<AppStateInner>) {
    tauri::async_runtime::spawn(async move {
        sleep(STARTUP_DELAY).await;
        let mut watcher = Watcher::default();
        loop {
            tick(&app, &poller, &state, &mut watcher).await;
            sleep(TICK).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catchup::result_event;
    use crate::f1_reminders::parse_utc_ms;
    use serde_json::json;

    fn start(date: &str, time: &str) -> i64 {
        parse_utc_ms(date, time).unwrap()
    }

    fn schedule() -> Value {
        json!({"MRData":{"RaceTable":{"Races":[{
            "season":"2026","round":"21","raceName":"Abu Dhabi Grand Prix",
            "date":"2026-11-29","time":"13:00:00Z",
            "Qualifying":{"date":"2026-11-28","time":"14:00:00Z"},
            "Sprint":{"date":"2026-11-28","time":"10:00:00Z"},
            "FirstPractice":{"date":"2026-11-27","time":"09:30:00Z"}
        }]}}})
    }

    fn row(position: &str, text: &str, given: &str, family: &str, team: &str) -> Value {
        json!({
            "position": position, "positionText": text,
            "Driver": {"givenName": given, "familyName": family},
            "Constructor": {"constructorId": team.to_lowercase().replace(' ', "_"), "name": team}
        })
    }

    fn results(rows: Vec<Value>, key: &str) -> Value {
        json!({"MRData":{"RaceTable":{"Races":[{ key: rows }]}}})
    }

    fn race_session() -> F1Session {
        F1Session {
            season: "2026".into(),
            round: "21".into(),
            sid: "race",
            label: "Гонка",
            race_name: "Abu Dhabi Grand Prix".into(),
            ends_at: 0,
        }
    }

    fn full_results() -> Value {
        results(
            vec![
                row("1", "1", "Max", "Verstappen", "Red Bull"),
                row("2", "2", "Lando", "Norris", "McLaren"),
                row("3", "3", "Charles", "Leclerc", "Ferrari"),
                row("4", "R", "Someone", "Else", "Haas"),
            ],
            "Results",
        )
    }

    #[test]
    fn only_races_and_sprints_inside_their_window_are_watched() {
        let race = start("2026-11-29", "13:00:00Z");
        let sprint = start("2026-11-28", "10:00:00Z");
        let ids = |now| {
            live_sessions(&schedule(), now)
                .into_iter()
                .map(|s| s.sid)
                .collect::<Vec<_>>()
        };
        assert!(ids(race).is_empty());
        assert!(ids(race + HOUR - 1).is_empty());
        assert_eq!(ids(race + HOUR), ["race"]);
        assert_eq!(ids(race + 12 * HOUR), ["race"]);
        assert!(ids(race + 12 * HOUR + 1).is_empty());
        assert!(ids(sprint + 30 * MINUTE - 1).is_empty());
        assert_eq!(ids(sprint + 30 * MINUTE), ["sprint"]);
        assert_eq!(ids(sprint + 6 * HOUR), ["sprint"]);
        assert!(ids(sprint + 6 * HOUR + 1).is_empty());
        // Квалификация и практики финишного праздника не получают никогда:
        // через три часа после квалификации окно спринта уже закрыто, а гонки ещё нет.
        let qualifying = start("2026-11-28", "14:00:00Z");
        assert!(ids(qualifying + 3 * HOUR).is_empty());
        let practice = start("2026-11-27", "09:30:00Z");
        assert!(ids(practice + 2 * HOUR).is_empty());
    }

    #[test]
    fn a_session_without_a_start_time_is_never_watched() {
        let schedule = json!({"MRData":{"RaceTable":{"Races":[{
            "season":"2026","round":"1","raceName":"X Grand Prix","date":"2026-03-15"
        }]}}});
        assert!(live_sessions(&schedule, start("2026-03-15", "15:00:00Z")).is_empty());
    }

    #[test]
    fn podium_needs_three_classified_finishers_and_ignores_row_order() {
        let session = race_session();
        let found = podium(&session, &full_results()).unwrap();
        assert_eq!(
            found
                .iter()
                .map(|p| (p.position, p.driver.as_str()))
                .collect::<Vec<_>>(),
            [
                (1, "Max Verstappen"),
                (2, "Lando Norris"),
                (3, "Charles Leclerc")
            ]
        );
        assert_eq!(found[0].team.as_deref(), Some("Red Bull"));
        assert_eq!(found[0].constructor_id.as_deref(), Some("red_bull"));

        let shuffled = results(
            vec![
                row("3", "3", "Charles", "Leclerc", "Ferrari"),
                row("1", "1", "Max", "Verstappen", "Red Bull"),
                row("2", "2", "Lando", "Norris", "McLaren"),
            ],
            "Results",
        );
        assert_eq!(podium(&session, &shuffled).unwrap()[0].position, 1);

        // Неполные итоги — не подиум.
        let two = results(
            vec![
                row("1", "1", "Max", "Verstappen", "Red Bull"),
                row("2", "2", "Lando", "Norris", "McLaren"),
            ],
            "Results",
        );
        assert!(podium(&session, &two).is_none());
        // «R» вместо места — пилот не классифицирован.
        let retired_third = results(
            vec![
                row("1", "1", "Max", "Verstappen", "Red Bull"),
                row("2", "2", "Lando", "Norris", "McLaren"),
                row("3", "R", "Charles", "Leclerc", "Ferrari"),
            ],
            "Results",
        );
        assert!(podium(&session, &retired_third).is_none());
        // Пустой список гонок и пустые итоги — ещё ничего не опубликовано.
        assert!(podium(&session, &json!({"MRData":{"RaceTable":{"Races":[]}}})).is_none());
        assert!(podium(&session, &results(vec![], "Results")).is_none());
    }

    #[test]
    fn sprint_reads_sprint_results_and_qualifying_has_no_podium() {
        let mut session = race_session();
        session.sid = "sprint";
        let sprint = results(
            vec![
                row("1", "1", "Lando", "Norris", "McLaren"),
                row("2", "2", "Max", "Verstappen", "Red Bull"),
                row("3", "3", "Charles", "Leclerc", "Ferrari"),
            ],
            "SprintResults",
        );
        assert_eq!(podium(&session, &sprint).unwrap()[0].driver, "Lando Norris");
        // Итоги гонки не принимаются за итоги спринта.
        assert!(podium(&session, &full_results()).is_none());
        session.sid = "qualifying";
        assert!(podium(&session, &sprint).is_none());
    }

    #[test]
    fn center_event_matches_the_catch_up_event() {
        let session = race_session();
        let payload = full_results();
        let ours = finish_event(&session, &podium(&session, &payload).unwrap(), 5).unwrap();
        let theirs = result_event(&session, &payload).unwrap();
        assert_eq!(ours.id, theirs.id);
        assert_eq!(ours.title, theirs.title);
        assert_eq!(ours.body, theirs.body);
        assert_eq!(ours.id, "f1|result|2026|21|race");
        assert_eq!(ours.occurred_at, 5);
        assert!(finish_event(&session, &[], 5).is_none());
    }

    #[test]
    fn watcher_celebrates_only_what_it_saw_become_published() {
        let t0 = 1_000_000;
        let mut w = Watcher::default();
        // Итоги уже были при первом взгляде (запуск после гонки): без праздника.
        assert!(w.due("a", t0));
        assert_eq!(w.published("a", t0), Verdict::Silent);
        assert!(!w.due("a", t0 + HOUR));

        // Видели без итогов, затем появились — праздник один раз.
        w.unpublished("b", t0);
        assert!(!w.due("b", t0 + CHECK_EVERY_MS - 1));
        assert!(w.due("b", t0 + CHECK_EVERY_MS));
        assert_eq!(w.published("b", t0 + 10 * MINUTE), Verdict::Live);
        assert_eq!(w.published("b", t0 + 11 * MINUTE), Verdict::Silent);
        assert!(!w.due("b", t0 + HOUR));

        // Долгий перерыв (сон, сбой сети): уже не «живое».
        w.unpublished("c", t0);
        assert_eq!(w.published("c", t0 + LIVE_GAP_MS + 1), Verdict::Silent);
        w.unpublished("d", t0);
        assert_eq!(w.published("d", t0 + LIVE_GAP_MS), Verdict::Live);
    }

    #[test]
    fn failed_checks_retry_later_and_never_count_as_unpublished() {
        let t0 = 1_000_000;
        let mut w = Watcher::default();
        w.failed("a", t0);
        assert!(!w.due("a", t0 + CHECK_EVERY_MS - 1));
        assert!(w.due("a", t0 + CHECK_EVERY_MS));
        assert_eq!(w.published("a", t0 + CHECK_EVERY_MS), Verdict::Silent);
    }

    #[test]
    fn sessions_that_left_the_window_are_forgotten() {
        let mut w = Watcher::default();
        w.unpublished("a", 1);
        w.unpublished("b", 1);
        w.retain(&HashSet::from(["b".to_string()]));
        assert!(w.due("a", 1));
        assert!(!w.due("b", 1));
    }

    #[test]
    fn interface_payload_uses_camel_case() {
        let session = race_session();
        let finish = Finish {
            id: "f1|result|2026|21|race".into(),
            season: session.season.clone(),
            round: session.round.clone(),
            session: session.sid.into(),
            label: session.label.into(),
            race_name: session.race_name.clone(),
            podium: podium(&session, &full_results()).unwrap(),
        };
        let value = serde_json::to_value(&finish).unwrap();
        assert_eq!(value["raceName"], "Abu Dhabi Grand Prix");
        assert_eq!(value["podium"][0]["position"], 1);
        assert_eq!(value["podium"][0]["constructorId"], "red_bull");
        assert_eq!(value["podium"].as_array().unwrap().len(), 3);
    }
}
