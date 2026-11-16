import { classifyMatchStatus, type MatchState } from '../../lib/sportsIdentity';
import { LEAGUES } from '../../lib/navigationMetadata';
import { CUP_COMPETITIONS } from '../ucl/cupMetadata';
import type { LeagueRef, MatchEvent, MatchSummary } from '../football/types';

/** The first and last local day of the «Главное» window, inclusive. */
export const WEEK_PAST_DAYS = 7;
export const WEEK_FUTURE_DAYS = 7;

/** Details are the long tail of the load; four at a time keeps the provider calm. */
export const EVENTS_CONCURRENCY = 4;

/**
 * The competitions the app follows. They are taken from the app's own
 * catalogue by id: the six leagues from the left panel plus the cups from the
 * «Сегодня»/«Матчи» live list. Names are never used — PitchAPI returns
 * unrelated leagues with the same names (Serie A from Brazil and Ecuador,
 * Premier League from Canada, Bundesliga from Austria).
 */
export const FOLLOWED_COMPETITION_IDS: readonly string[] = [
  ...LEAGUES.map((league) => league.id),
  ...CUP_COMPETITIONS.map((cup) => cup.id),
];

export interface WeekWindow {
  /** Local calendar days, oldest first (`YYYY-MM-DD`). */
  days: string[];
  /** First instant of the first local day, in UTC milliseconds. */
  startMs: number;
  /** First instant after the last local day, in UTC milliseconds. */
  endMs: number;
  /** UTC dates whose day lists can contain a match of the window. */
  utcDates: string[];
}

/** A match from `date/{date}`: the summary plus the league it belongs to. */
export interface DateMatchSummary extends MatchSummary {
  league?: LeagueRef;
}

export interface WeekMatch {
  summary: MatchSummary;
  leagueId: string;
  state: MatchState;
}

export interface WeekDay {
  date: string;
  matches: WeekMatch[];
}

export type WeekEventStatus = 'pending' | 'loaded' | 'missing' | 'failed';

export interface WeekEventState {
  status: WeekEventStatus;
  events: MatchEvent[];
  /** Only for `failed`; a failed request is unknown, never zero events. */
  error?: string;
}

export interface WeekError {
  scope: 'day' | 'season' | 'events';
  /** UTC date, league id or match id, depending on the scope. */
  key: string;
  message: string;
}

export interface WeekProgress {
  loaded: number;
  total: number;
  label: string;
}

function validDate(ms: number): Date | null {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar day of an instant in a time zone (`YYYY-MM-DD`). */
export function localDayKey(ms: number, timeZone: string): string {
  const date = validDate(ms);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Adds whole calendar days to a `YYYY-MM-DD` key without touching time zones. */
export function shiftDayKey(day: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Offset of the zone at an instant: local wall clock minus UTC, in milliseconds. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const date = validDate(ms);
  if (!date) return 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value ?? 0);
    const wallClock = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    );
    return wallClock - Math.floor(ms / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** First instant of a local calendar day, in UTC milliseconds. */
export function localMidnightUtc(day: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return Number.NaN;
  const wallClock = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let instant = wallClock - zoneOffsetMs(wallClock, timeZone);
  // Two passes settle ordinary zones and most daylight-saving changes.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = wallClock - zoneOffsetMs(instant, timeZone);
    if (next === instant) break;
    instant = next;
  }
  return instant;
}

function utcDay(ms: number): string {
  const date = validDate(ms);
  return date ? date.toISOString().slice(0, 10) : '';
}

/**
 * Seven local days back and seven ahead around `now`. PitchAPI day lists are
 * keyed by UTC date, so every UTC date overlapping the local window is listed.
 */
export function resolveWeekWindow(now: number, timeZone: string): WeekWindow {
  const today = localDayKey(now, timeZone);
  if (!today) {
    return { days: [], startMs: Number.NaN, endMs: Number.NaN, utcDates: [] };
  }
  const days: string[] = [];
  for (let offset = -WEEK_PAST_DAYS; offset <= WEEK_FUTURE_DAYS; offset += 1)
    days.push(shiftDayKey(today, offset));
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const startMs = localMidnightUtc(first, timeZone);
  const endMs = localMidnightUtc(shiftDayKey(last, 1), timeZone);
  const utcDates: string[] = [];
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    const lastUtc = utcDay(endMs - 1);
    for (let day = utcDay(startMs); day && day <= lastUtc; day = shiftDayKey(day, 1))
      utcDates.push(day);
  }
  return { days, startMs, endMs, utcDates };
}

/** Kickoff of a summary in UTC milliseconds; null when the provider gave no time. */
export function matchStartMs(summary: Pick<MatchSummary, 'time_utc'>): number | null {
  if (!summary.time_utc) return null;
  const ms = Date.parse(summary.time_utc);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Keeps matches of the followed leagues whose local kickoff is inside the
 * window. A league is matched by id only; a match without a league id cannot
 * be proven followed and is left out.
 */
export function selectWeekMatches(
  summaries: readonly DateMatchSummary[],
  followed: ReadonlySet<string>,
  window: WeekWindow,
): WeekMatch[] {
  const byId = new Map<string, WeekMatch>();
  for (const raw of summaries) {
    if (!raw || typeof raw.id !== 'string' || !raw.home_team || !raw.away_team) continue;
    const leagueId = raw.league?.id;
    if (!leagueId || !followed.has(leagueId)) continue;
    const kickoff = matchStartMs(raw);
    if (kickoff === null || kickoff < window.startMs || kickoff >= window.endMs) continue;
    if (!byId.has(raw.id)) {
      byId.set(raw.id, {
        summary: raw,
        leagueId,
        state: classifyMatchStatus(raw.status, raw.status_text),
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      (matchStartMs(a.summary) ?? 0) - (matchStartMs(b.summary) ?? 0) ||
      a.summary.id.localeCompare(b.summary.id),
  );
}

/** Groups already filtered matches into the local days of the window. */
export function buildWeekDays(
  window: WeekWindow,
  matches: Iterable<WeekMatch>,
  timeZone: string,
): WeekDay[] {
  const byDay = new Map<string, WeekMatch[]>(window.days.map((day) => [day, []]));
  for (const match of matches) {
    const kickoff = matchStartMs(match.summary);
    if (kickoff === null) continue;
    const day = localDayKey(kickoff, timeZone);
    const list = byDay.get(day);
    if (!list || list.some((item) => item.summary.id === match.summary.id)) continue;
    list.push(match);
  }
  return window.days.map((date) => ({
    date,
    matches: (byDay.get(date) ?? []).sort(
      (a, b) =>
        (matchStartMs(a.summary) ?? 0) - (matchStartMs(b.summary) ?? 0) ||
        a.summary.id.localeCompare(b.summary.id),
    ),
  }));
}

/**
 * Finished matches whose events are worth loading, newest first. Postponed
 * and cancelled matches are not finished and are never queued.
 */
export function orderFinishedForEvents(matches: Iterable<WeekMatch>): WeekMatch[] {
  const byId = new Map<string, WeekMatch>();
  for (const match of matches) {
    if (match.state === 'finished' && match.summary.id) byId.set(match.summary.id, match);
  }
  return [...byId.values()].sort(
    (a, b) =>
      (matchStartMs(b.summary) ?? 0) - (matchStartMs(a.summary) ?? 0) ||
      a.summary.id.localeCompare(b.summary.id),
  );
}

export interface TaskQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
}

/**
 * A small FIFO pool. Every request of the week goes through it, so the app
 * never sends more than `limit` requests at once.
 */
export function createTaskQueue(limit: number = EVENTS_CONCURRENCY): TaskQueue {
  const cap = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  const waiting: Array<() => void> = [];
  let active = 0;

  const next = () => {
    while (active < cap && waiting.length > 0) {
      active += 1;
      waiting.shift()!();
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              next();
            });
        });
        next();
      });
    },
    get active() {
      return active;
    },
    get pending() {
      return waiting.length;
    },
  };
}

function unwrap(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const outer = payload as Record<string, unknown>;
  const data =
    outer.data && typeof outer.data === 'object' ? (outer.data as Record<string, unknown>) : outer;
  return data && typeof data === 'object' ? data : null;
}

export function parseDateMatches(payload: unknown): DateMatchSummary[] | null {
  const data = unwrap(payload);
  if (!data || !Array.isArray(data.matches)) return null;
  return data.matches.filter(
    (match): match is DateMatchSummary => !!match && typeof match === 'object',
  );
}

export function parseSeasonMatches(payload: unknown): MatchSummary[] | null {
  const data = unwrap(payload);
  if (!data || !Array.isArray(data.matches)) return null;
  return data.matches.filter(
    (match): match is MatchSummary => !!match && typeof match === 'object',
  );
}

export function parseEvents(payload: unknown): MatchEvent[] | null {
  const data = unwrap(payload);
  if (!data || !Array.isArray(data.events)) return null;
  return data.events.filter((event): event is MatchEvent => !!event && typeof event === 'object');
}

export function earlierFetchedAt(
  current: string | null,
  next: string | null | undefined,
): string | null {
  if (!next || !Number.isFinite(Date.parse(next))) return current;
  if (!current || !Number.isFinite(Date.parse(current))) return next;
  return Date.parse(current) <= Date.parse(next) ? current : next;
}

export function appendError(errors: WeekError[], next: WeekError): WeekError[] {
  if (errors.some((error) => error.scope === next.scope && error.key === next.key)) return errors;
  return [...errors, next];
}

export function weekProgress(
  events: Readonly<Record<string, WeekEventState>>,
  total: number,
): WeekProgress {
  const loaded = Object.values(events).filter((event) => event.status === 'loaded').length;
  return { loaded, total, label: `загружено ${loaded} из ${total}` };
}
