import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  Flag,
  Goal,
  Star,
  TriangleAlert,
} from 'lucide-react';
import { useNow } from '../../lib/useNow';
import { WatchEventButton } from '../../lib/watchIntent';
import { useViewState } from '../../lib/useViewState';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import TeamBadge from '../../components/TeamBadge';
import { FavoritesProvider, useFavorites } from '../football/FavoritesProvider';
import { getJson, getUserTimezone, setJson } from '../football/storage';
import { useFootballData } from '../football/useFootballData';
import { useApiResource } from '../f1/api';
import { parseSchedule } from '../f1/parsing';
import { racePresentation } from '../f1/calendarModel';
import type { JolpicaRace } from '../f1/types';
import {
  buildViewingEvents,
  filterViewingEventsByDay,
  findViewingConflicts,
  groupViewingEventsByDay,
  viewingDayKey,
  type ViewingEvent,
} from './plannerData';
import './planner.css';

const PRIORITIES_KEY = 'sportsdesk.planner.priorities';
function time(timestamp: number, tz: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(timestamp);
}
function dayLabel(date: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}
function overlap(a: ViewingEvent, b: ViewingEvent) {
  return a.id !== b.id && a.start < b.end && b.start < a.end;
}
function title(event: ViewingEvent) {
  return event.kind === 'f1'
    ? `${racePresentation(event.race).title} · ${event.sessionLabel}`
    : event.title;
}
interface Props {
  onOpenMatch: (id: string, leagueId?: string) => void;
  onOpenWeekend: (race: JolpicaRace) => void;
}

function PlannerBody({ onOpenMatch, onOpenWeekend }: Props) {
  const now = useNow(),
    tz = getUserTimezone(),
    today = viewingDayKey(now, tz);
  const year = Number(today.slice(0, 4));
  const football = useFootballData();
  const { teamIds, favoriteTeamNames, seedFromCatalogue } = useFavorites();
  useEffect(() => seedFromCatalogue(football.teams), [football.teams, seedFromCatalogue]);
  const schedule = useApiResource(`planner.${year}`, `${year}.json?limit=100`, parseSchedule);
  const needsNextYear = today.slice(5, 7) >= '11';
  const nextSchedule = useApiResource(
    `planner.${year + 1}`,
    needsNextYear ? `${year + 1}.json?limit=100` : null,
    parseSchedule,
  );
  const races = useMemo(
    () => [...(schedule.data?.races ?? []), ...(nextSchedule.data?.races ?? [])],
    [schedule.data, nextSchedule.data],
  );
  const plan = useMemo(
    () => buildViewingEvents(football.allMatches, races, teamIds, favoriteTeamNames, now),
    [football.allMatches, races, teamIds, favoriteTeamNames, now],
  );
  const [range, setRange] = useViewState<'week' | 'day'>(
    'planner.range',
    'week',
    (v) => v === 'week' || v === 'day',
  );
  const [day, setDay] = useViewState<string>(
    'planner.day',
    today,
    (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  );
  const [onlyPlan, setOnlyPlan] = useViewState<boolean>(
    'planner.only-plan',
    false,
    (v) => typeof v === 'boolean',
  );
  const [priorities, setPriorities] = useState<string[]>(() => {
    const raw = getJson<unknown>(PRIORITIES_KEY, []);
    return Array.isArray(raw)
      ? [...new Set(raw.filter((v): v is string => typeof v === 'string'))].slice(-500)
      : [];
  });
  useEffect(() => setJson(PRIORITIES_KEY, priorities), [priorities]);
  const weekEnd = new Date(`${today}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const weekEndDay = weekEnd.toISOString().slice(0, 10);
  const periodEvents =
    range === 'day'
      ? filterViewingEventsByDay(plan.events, day, tz)
      : plan.events.filter((e) => viewingDayKey(e.start, tz) < weekEndDay);
  const nextDay =
    range === 'week' && !onlyPlan && !periodEvents.length
      ? groupViewingEventsByDay(
          plan.events.filter((event) => event.start >= now),
          tz,
        )[0]
      : undefined;
  const inRange = nextDay?.events ?? periodEvents;
  const shown = onlyPlan ? inRange.filter((e) => priorities.includes(e.id)) : inRange;
  const groups = groupViewingEventsByDay(shown, tz);
  const conflicts = findViewingConflicts(inRange);
  const selected = inRange.filter((e) => priorities.includes(e.id));
  const selectedConflicts = findViewingConflicts(selected);
  const toggle = (event: ViewingEvent) =>
    setPriorities((prev) =>
      prev.includes(event.id)
        ? prev.filter((id) => id !== event.id)
        : [...prev, event.id].slice(-500),
    );
  const open = (event: ViewingEvent) => {
    if (event.kind === 'f1') onOpenWeekend(event.race);
    else {
      const league = football.leagues.find((l) =>
        football.matchesForLeague(l.id).some((m) => m.id === event.match.id),
      );
      onOpenMatch(event.match.id, league?.id);
    }
  };
  const refreshed = [football.fetchedAt, schedule.fetchedAt]
    .filter((v): v is string => !!v)
    .sort()[0];
  return (
    <div className="viewing-planner">
      <section className="planner-hero">
        <div>
          <span className="eyebrow">ФУТБОЛ + ФОРМУЛА-1 · {tz}</span>
          <h1>Мой спортивный вечер</h1>
          <p>
            Любимые клубы и весь гоночный уикенд на одной шкале. Отметьте, что хотите смотреть, и
            заранее проверьте пересечения.
          </p>
        </div>
        <CalendarClock size={52} />
      </section>
      {inRange.length > 0 && (
        <div className="planner-insights">
          <div>
            <strong>{inRange.length}</strong>
            <span>событий в периоде</span>
          </div>
          <div>
            <strong>{selected.length}</strong>
            <span>выбрано смотреть</span>
          </div>
          <div>
            <strong>{conflicts.length}</strong>
            <span>групп пересечений</span>
          </div>
        </div>
      )}
      <section className="panel planner-toolbar">
        <div className="analysis-control-group" role="group" aria-label="Период плана">
          <button
            className={range === 'week' ? 'ghost-btn active' : 'ghost-btn'}
            aria-pressed={range === 'week'}
            onClick={() => setRange('week')}
          >
            Ближайшие 7 дней
          </button>
          <button
            className={range === 'day' ? 'ghost-btn active' : 'ghost-btn'}
            aria-pressed={range === 'day'}
            onClick={() => {
              setDay(today);
              setRange('day');
            }}
          >
            Сегодня
          </button>
          <label>
            <span>Выбрать день</span>
            <input
              type="date"
              aria-label="День спортивного плана"
              value={day}
              onChange={(e) => {
                if (e.target.value) {
                  setDay(e.target.value);
                  setRange('day');
                }
              }}
            />
          </label>
        </div>
        <label className="planner-filter">
          <input
            type="checkbox"
            checked={onlyPlan}
            onChange={(e) => setOnlyPlan(e.target.checked)}
          />{' '}
          Только мой план
        </label>
        <button
          className="ghost-btn"
          disabled={football.matchesLoading || schedule.loading}
          onClick={() => {
            football.reload();
            schedule.reload();
            if (needsNextYear) nextSchedule.reload();
          }}
        >
          Обновить расписание
        </button>
      </section>
      <p className="planner-estimate">
        <Clock3 size={15} /> Начало — по данным источника. Окончание приблизительное: матч около 2
        часов, гонка около 2 часов; задержки и дополнительное время могут изменить пересечения.
      </p>
      {!!selectedConflicts.length && (
        <div className="planner-conflict-banner" role="status">
          <TriangleAlert size={19} />
          <div>
            <strong>В вашем плане есть пересечения</strong>
            <p>
              Выбранные трансляции накладываются по предполагаемому времени. Можно оставить обе или
              снять отметку у одной.
            </p>
          </div>
        </div>
      )}
      {football.matchesLoading && !football.allMatches.length && (
        <LoadingBlock label="Загружаем футбольное расписание…" rows={2} />
      )}
      {schedule.loading && !schedule.data && (
        <LoadingBlock label="Загружаем сессии Формулы-1…" rows={2} />
      )}
      {football.matchesError && (
        <ErrorBlock
          title="Часть футбольного расписания недоступна"
          message={football.matchesError}
          onRetry={football.reload}
        />
      )}
      {schedule.error && !schedule.data && (
        <ErrorBlock
          title="Расписание F1 недоступно"
          message={schedule.error}
          onRetry={schedule.reload}
        />
      )}
      {nextSchedule.error && needsNextYear && (
        <p className="muted small">
          Расписание F1 следующего года пока недоступно; показаны загруженные события.
        </p>
      )}
      {nextDay && (
        <p className="muted small">
          За ближайшие 7 дней событий нет. Следующие события — {dayLabel(nextDay.date)}.
        </p>
      )}
      {!shown.length && !football.matchesLoading && !schedule.loading && (
        <EmptyBlock
          title={onlyPlan ? 'В плане пока ничего нет' : 'В этом периоде нет событий'}
          message={
            onlyPlan
              ? 'Отключите «Только мой план» и отметьте нужные события кнопкой «Буду смотреть».'
              : 'Выберите другой день. Футбол берётся из расписаний отслеживаемых клубов; F1 — из опубликованного календаря.'
          }
        />
      )}
      {groups.map((group) => (
        <section className="planner-day" key={group.date}>
          <div className="planner-day-heading">
            <h2>
              {range === 'day' && group.date < day
                ? 'Переходит с предыдущего дня'
                : dayLabel(group.date)}
            </h2>
            <span>{group.events.length} событий</span>
          </div>
          <div className="planner-events">
            {group.events.map((event) => {
              const overlaps = inRange.filter((other) => overlap(event, other));
              const watching = priorities.includes(event.id);
              return (
                <article
                  className={`panel planner-event ${event.kind} ${watching ? 'chosen' : ''}`}
                  key={event.id}
                >
                  <div className="planner-time">
                    <strong>{time(event.start, tz)}</strong>
                    <span>до ≈ {time(event.end, tz)}</span>
                    {viewingDayKey(event.start, tz) !== viewingDayKey(event.end, tz) && (
                      <small>окончание на следующий день</small>
                    )}
                  </div>
                  <div className="planner-event-content">
                    <div className="planner-event-badges">
                      <span className="chip">
                        {event.kind === 'football' ? <Goal size={12} /> : <Flag size={12} />}{' '}
                        {event.kind === 'football' ? 'Футбол' : 'Формула-1'}
                      </span>
                      {event.state === 'underway' && (
                        <span className="chip">
                          {event.isLive ? 'Матч идёт' : 'Идёт по расписанию'}
                        </span>
                      )}
                      {watching && (
                        <span className="chip">
                          <Check size={12} /> Мой план
                        </span>
                      )}
                    </div>
                    <button className="planner-title" onClick={() => open(event)}>
                      {event.kind === 'football' && (
                        <span className="planner-crests" aria-hidden="true">
                          <TeamBadge
                            name={event.match.home_team.name}
                            imageUrl={event.match.home_team.image_url}
                            size={22}
                          />
                          <TeamBadge
                            name={event.match.away_team.name}
                            imageUrl={event.match.away_team.image_url}
                            size={22}
                          />
                        </span>
                      )}
                      {title(event)}
                      <ChevronRight size={15} />
                    </button>
                    <p>
                      {event.kind === 'f1'
                        ? event.race.Circuit.circuitName
                        : 'Матч отслеживаемого клуба'}
                      {event.liveExtended ? ' · матч продолжается, окончание уточняется' : ''}
                    </p>
                    {!!overlaps.length && (
                      <div className="planner-overlaps">
                        <TriangleAlert size={13} />
                        <span>
                          Пересекается: {overlaps.slice(0, 2).map(title).join('; ')}
                          {overlaps.length > 2 ? ` и ещё ${overlaps.length - 2}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    className={watching ? 'ghost-btn active' : 'ghost-btn'}
                    aria-pressed={watching}
                    aria-label={`${watching ? 'Убрать из плана' : 'Буду смотреть'}: ${title(event)}`}
                    onClick={() => toggle(event)}
                  >
                    <Star size={15} fill={watching ? 'currentColor' : 'none'} />
                    {watching ? 'В плане' : 'Буду смотреть'}
                  </button>
                  <WatchEventButton
                    intent={{ sport: event.kind, key: event.id, title: title(event) }}
                  />
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {!!plan.unscheduled.length && (
        <details className="panel planner-unknown">
          <summary>Время уточняется · {plan.unscheduled.length} событий вне точной шкалы</summary>
          {plan.unscheduled.slice(0, 30).map((event) => (
            <p key={event.id}>
              {event.date ?? 'Дата уточняется'} · {event.title}
            </p>
          ))}
          <p>
            Для этих событий источник не указал точное время. Они не участвуют в расчёте
            пересечений.
          </p>
        </details>
      )}
      <div className="analysis-footer">
        <span>
          Источники: PitchAPI и Jolpica
          {refreshed
            ? ` · обновлено ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(refreshed))}`
            : ''}
          {football.stale || schedule.stale ? ' · есть сохранённые данные' : ''}. Выбранные события
          сохраняются на этом ПК.
        </span>
      </div>
    </div>
  );
}
export function ViewingPlanner(props: Props) {
  return (
    <FavoritesProvider>
      <PlannerBody {...props} />
    </FavoritesProvider>
  );
}
