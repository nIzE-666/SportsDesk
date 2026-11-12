import { classifyMatchStatus, canonicalTeamName } from '../../lib/sportsIdentity';
import type { MatchSummary } from '../football/types';
import type { JolpicaRace } from '../f1/types';
import { weekendSchedule } from '../f1/weekendSchedule';

export const DEFAULT_VIEWING_TIMEZONE = 'Asia/Yakutsk';
const MINUTE = 60_000;

interface ViewingSource {
  id: string;
  title: string;
}

interface FootballSource extends ViewingSource {
  kind: 'football';
  match: MatchSummary;
}

interface F1Source extends ViewingSource {
  kind: 'f1';
  race: JolpicaRace;
  sessionId: string;
  sessionLabel: string;
}

type Source = FootballSource | F1Source;

interface ViewingInterval {
  /** UTC milliseconds. No date-only fixture is assigned an invented midnight. */
  start: number;
  end: number;
  /** Includes ordinary breaks, but cannot predict extra time, red flags or delays. */
  durationMinutes: number;
  estimatedEnd: true;
  /** Live status outlasted the usual duration; end is a rolling planning window. */
  liveExtended?: boolean;
  /** 'underway' describes the scheduled interval, not a verified live feed. */
  state: 'upcoming' | 'underway';
  /** True only when a football provider explicitly reports a live status. */
  isLive: boolean;
}

export type ViewingEvent = Source & ViewingInterval;

/** Kept outside the precise timeline until the provider supplies a valid time. */
export type UnscheduledViewingEvent = Source & {
  date: string | null;
  reason: 'time-unknown' | 'invalid-time';
};

export interface ViewingPlan {
  events: ViewingEvent[];
  unscheduled: UnscheduledViewingEvent[];
}

export interface ViewingConflictGroup {
  id: string;
  eventIds: string[];
  events: ViewingEvent[];
  /** Extent of this connected group; not every pair necessarily overlaps. */
  start: number;
  end: number;
}

export interface ViewingDayGroup {
  date: string;
  events: ViewingEvent[];
}

const terminalStatuses = new Set(['finished', 'cancelled', 'postponed']);
const liveStatuses = new Set(['live']);
const statusKey = classifyMatchStatus;
const nameKey = canonicalTeamName;
const eventOrder = (a: ViewingEvent, b: ViewingEvent) =>
  a.start - b.start || a.id.localeCompare(b.id);
const key = (...parts: string[]) => parts.map(encodeURIComponent).join(':');

function validDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/** UTC-labelled timestamps without an offset are explicitly UTC, never host-local. */
function footballStart(match: MatchSummary): number | null {
  const raw = (match.time_utc || match.date || '').trim();
  const parts =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      raw,
    );
  if (
    !parts ||
    !validDate(parts[1]) ||
    Number(parts[2]) > 23 ||
    Number(parts[3]) > 59 ||
    Number(parts[4] ?? 0) > 59
  )
    return null;
  const value = `${parts[1]}T${parts[2]}:${parts[3]}:${parts[4] ?? '00'}${parts[5] ?? ''}${parts[6] ?? 'Z'}`;
  const start = Date.parse(value);
  return Number.isFinite(start) ? start : null;
}

/** Planning estimates, not broadcast end times. */
export function viewingDurationMinutes(kind: 'football' | 'f1', sessionId?: string): number {
  if (kind === 'football' || sessionId === 'race') return 120;
  if (sessionId === 'sprint') return 45;
  if (sessionId === 'sprint-qualifying') return 45;
  return 60;
}

/**
 * Only favorite-team fixtures and provided F1 sessions are included. Unknown
 * future football status aliases are retained; explicit terminal states are not.
 * Last occurrence wins when the same provider identifier appears more than once.
 */
export function buildViewingEvents(
  matches: readonly MatchSummary[],
  races: readonly JolpicaRace[],
  favoriteIds: readonly string[],
  favoriteNames: readonly string[] = [],
  now: number = Date.now(),
): ViewingPlan {
  const events: ViewingEvent[] = [];
  const unscheduled: UnscheduledViewingEvent[] = [];
  if (!Number.isFinite(now)) return { events, unscheduled };
  const ids = new Set(favoriteIds.filter(Boolean));
  const names = new Set(favoriteNames.map(nameKey).filter(Boolean));
  // Date-only records have no UTC instant. Keep a one-day boundary margin so a
  // current local-date fixture is not discarded solely due to the user's zone.
  const oldestUnknownDate = new Date(now - 24 * 60 * MINUTE).toISOString().slice(0, 10);
  const add = (
    source: Source,
    start: number | null,
    date: string | null,
    rawTime: string | null,
    isLive = false,
  ) => {
    if (start === null) {
      if (isLive || !date || date >= oldestUnknownDate)
        unscheduled.push({
          ...source,
          date,
          reason: rawTime && !/^\d{4}-\d{2}-\d{2}$/.test(rawTime) ? 'invalid-time' : 'time-unknown',
        });
      return;
    }
    const usualDuration = viewingDurationMinutes(
      source.kind,
      source.kind === 'f1' ? source.sessionId : undefined,
    );
    // A confirmed live feed takes precedence over our ordinary duration estimate.
    // This 15-minute rolling window is for conflict planning, not a prediction of
    // the final whistle. Without an explicit live status, stale intervals expire.
    const liveExtended = isLive && start + usualDuration * MINUTE <= now;
    const durationMinutes = liveExtended ? Math.ceil((now - start) / MINUTE) + 15 : usualDuration;
    const end = start + durationMinutes * MINUTE;
    if (end <= now) return;
    events.push({
      ...source,
      start,
      end,
      durationMinutes,
      estimatedEnd: true,
      liveExtended,
      state: isLive || start <= now ? 'underway' : 'upcoming',
      isLive,
    });
  };

  const uniqueMatches = new Map(
    matches.filter((match) => Boolean(match.id)).map((match) => [match.id, match]),
  );
  for (const match of uniqueMatches.values()) {
    if (
      !ids.has(match.home_team.id) &&
      !ids.has(match.away_team.id) &&
      !names.has(nameKey(match.home_team.name)) &&
      !names.has(nameKey(match.away_team.name))
    )
      continue;
    const status = statusKey(match.status);
    if (terminalStatuses.has(status)) continue;
    const source: FootballSource = {
      kind: 'football',
      id: key('football', match.id),
      title: `${match.home_team.name} — ${match.away_team.name}`,
      match,
    };
    const date = validDate(match.date) ?? validDate(match.time_utc?.slice(0, 10));
    add(
      source,
      footballStart(match),
      date,
      match.time_utc?.trim() || null,
      liveStatuses.has(status),
    );
  }

  const uniqueRaces = new Map(
    races
      .filter((race) => race.season && race.round)
      .map((race) => [key(race.season, race.round), race]),
  );
  for (const race of uniqueRaces.values()) {
    for (const session of weekendSchedule(race)) {
      const source: F1Source = {
        kind: 'f1',
        id: key('f1', race.season, race.round, session.id),
        title: `${race.raceName} · ${session.label}`,
        race,
        sessionId: session.id,
        sessionLabel: session.label,
      };
      add(
        source,
        session.start?.getTime() ?? null,
        validDate(session.date ?? undefined),
        session.time,
      );
    }
  }
  events.sort(eventOrder);
  unscheduled.sort(
    (a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.id.localeCompare(b.id),
  );
  return { events, unscheduled };
}

/** Connected overlap groups; A↔B↔C is one choice even when A and C do not overlap. */
export function findViewingConflicts(events: readonly ViewingEvent[]): ViewingConflictGroup[] {
  const sorted = [
    ...new Map(
      events
        .filter(
          (event) =>
            Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start,
        )
        .map((event) => [event.id, event]),
    ).values(),
  ].sort(eventOrder);
  const groups: ViewingConflictGroup[] = [];
  let pending: ViewingEvent[] = [];
  let latestEnd = -Infinity;
  const finish = () => {
    const first = pending[0];
    if (first && pending.length > 1) {
      const eventIds = pending.map((event) => event.id);
      groups.push({
        id: `overlap:${JSON.stringify([...eventIds].sort())}`,
        eventIds,
        events: pending,
        start: first.start,
        end: latestEnd,
      });
    }
  };
  for (const event of sorted) {
    if (event.start >= latestEnd) {
      finish();
      pending = [];
      latestEnd = -Infinity;
    }
    pending.push(event);
    latestEnd = Math.max(latestEnd, event.end);
  }
  finish();
  return groups;
}

/** Gregorian date in an explicit IANA zone, independent of the host timezone. */
export function viewingDayKey(timestamp: number, timeZone = DEFAULT_VIEWING_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Groups by the local start date. Overnight intervals remain one event. */
export function groupViewingEventsByDay(
  events: readonly ViewingEvent[],
  timeZone = DEFAULT_VIEWING_TIMEZONE,
): ViewingDayGroup[] {
  const groups = new Map<string, ViewingEvent[]>();
  for (const event of [...events].sort(eventOrder)) {
    const date = viewingDayKey(event.start, timeZone);
    const group = groups.get(date) ?? [];
    group.push(event);
    groups.set(date, group);
  }
  return [...groups].map(([date, dayEvents]) => ({ date, events: dayEvents }));
}

/** Includes an interval continuing from the previous day; midnight touch is not overlap. */
export function filterViewingEventsByDay(
  events: readonly ViewingEvent[],
  date: string,
  timeZone = DEFAULT_VIEWING_TIMEZONE,
): ViewingEvent[] {
  if (!validDate(date)) return [];
  return events
    .filter(
      (event) =>
        viewingDayKey(event.start, timeZone) <= date &&
        viewingDayKey(event.end - 1, timeZone) >= date,
    )
    .sort(eventOrder);
}

/** Russian plural form for a count: 1 событие, 2 события, 5 событий, 21 событие. */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const hundred = Math.abs(count) % 100;
  const unit = hundred % 10;
  if (hundred > 10 && hundred < 20) return many;
  if (unit === 1) return one;
  return unit >= 2 && unit <= 4 ? few : many;
}

/** Whole calendar days from one `YYYY-MM-DD` day to another; negative when it is earlier. */
export function calendarDaysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000,
  );
}

/** How far a day is from today: «сегодня», «завтра», «через 9 дней». */
export function inDaysLabel(days: number): string {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${pluralRu(days, 'день', 'дня', 'дней')}`;
}

/**
 * Choosing a period can change the list only when the events fall on more than one day;
 * with a single day every period shows the same events (or none).
 */
export function periodChoiceUseful(
  events: readonly ViewingEvent[],
  timeZone = DEFAULT_VIEWING_TIMEZONE,
): boolean {
  return new Set(events.map((event) => viewingDayKey(event.start, timeZone))).size > 1;
}

/**
 * «Только мой план» changes the list only while some, but not all, of the listed events are
 * chosen. Without a choice it would empty the list, with every event chosen it changes nothing.
 */
export function planFilterUseful(
  listed: readonly ViewingEvent[],
  chosenIds: readonly string[],
): boolean {
  const chosen = listed.filter((event) => chosenIds.includes(event.id)).length;
  return chosen > 0 && chosen < listed.length;
}

export type PlannerTileId = 'events' | 'chosen' | 'overlaps';
/**
 * Figures worth a tile: no zero, no count of a single event, and no count of the "next events"
 * list that the day heading already gives.
 */
export function plannerTiles(
  listed: number,
  chosen: number,
  overlapGroups: number,
  nextEvents: boolean,
): { id: PlannerTileId; value: number }[] {
  const tiles: { id: PlannerTileId; value: number }[] = [];
  if (listed > 1 && !nextEvents) tiles.push({ id: 'events', value: listed });
  if (chosen > 0) tiles.push({ id: 'chosen', value: chosen });
  if (overlapGroups > 0) tiles.push({ id: 'overlaps', value: overlapGroups });
  return tiles;
}
