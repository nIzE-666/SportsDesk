import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/bridge';
import type { MatchSummary } from './types';
import { getString, getUserTimezone } from './storage';
import { clubKey } from './clubNames';
import {
  espnSlugForLeague,
  onLocalDay,
  parseEspnScoreboard,
  parseLiveScore,
  type LiveMatch,
  type LiveSource,
} from './liveSources';

/**
 * Loading and careful polling for the two unofficial live sources. Parsing stays in
 * `liveSources.ts`; this module only chooses request paths, combines the answers and keeps
 * the last known values when a request fails.
 */

export const LIVE_SOURCE_KEY = 'sportsdesk.football.liveSource';
export type LiveSourceChoice = 'auto' | 'livescore' | 'espn';

export interface LiveData {
  matches: LiveMatch[];
  source: LiveSource | null;
  fetchedAt: string | null;
  stale: boolean;
}

export interface LiveLoadOptions {
  leagueIds: readonly string[];
  timeZone: string;
  /** The local day and the live window are both calculated from this instant. */
  now?: Date;
  automatic?: boolean;
}

export interface UseLiveMatchesResult extends LiveData {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_INTERVAL_MS = HOUR_MS;
const LIVE_INTERVAL_MS = MINUTE_MS;
const STARTING_SOON_MS = 15 * MINUTE_MS;
const RECENT_KICKOFF_MS = 150 * MINUTE_MS;
const MAX_BACKOFF_MS = 15 * MINUTE_MS;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DayParts {
  year: number;
  month: number;
  day: number;
}

interface ZonedParts extends DayParts {
  hour: number;
  minute: number;
  second: number;
}

interface DayRequest {
  path: string;
  offset: number;
}

function readDay(value: string): DayParts | null {
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return { year, month, day };
}

function compactDay(value: string): string {
  return value.replace(/-/g, '');
}

function isoDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const parts = readDay(value);
  if (!parts) return value;
  return isoDayFromMs(Date.UTC(parts.year, parts.month - 1, parts.day + days));
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return null;
  }
}

function zonedParts(date: Date, formatter: Intl.DateTimeFormat): ZonedParts | null {
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  return { year, month, day, hour, minute, second };
}

function wallClockAsUtc(parts: ZonedParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/**
 * UTC offset of `timeZone` at local noon on `day`, in minutes. Noon avoids most DST
 * transitions, and any transition still keeps the requested calendar day intact.
 */
function offsetMinutesAtLocalNoon(day: string, timeZone: string): number | null {
  const parts = readDay(day);
  const formatter = zoneFormatter(timeZone);
  if (!parts || !formatter) return null;
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, 12);
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = zonedParts(new Date(instant), formatter);
    if (!local) return null;
    instant = target - (wallClockAsUtc(local) - instant);
  }
  const local = zonedParts(new Date(instant), formatter);
  if (!local) return null;
  return Math.round((wallClockAsUtc(local) - instant) / MINUTE_MS);
}

/** The first UTC instant of the local calendar day. */
function localMidnightUtcMs(day: string, timeZone: string): number | null {
  const parts = readDay(day);
  const formatter = zoneFormatter(timeZone);
  if (!parts || !formatter) return null;
  const target = Date.UTC(parts.year, parts.month - 1, parts.day);
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = zonedParts(new Date(instant), formatter);
    if (!local) return null;
    instant = target - (wallClockAsUtc(local) - instant);
  }
  return instant;
}

/** The local calendar day at `now`, e.g. `2026-11-08`. */
export function localDayIso(now: Date, timeZone: string): string | null {
  const formatter = zoneFormatter(timeZone);
  if (!formatter) return null;
  const parts = zonedParts(now, formatter);
  if (!parts) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day,
  ).padStart(2, '0')}`;
}

/** UTC dates touched by the local calendar day, oldest first. */
export function utcDatesForLocalDay(day: string, timeZone: string): string[] {
  const start = localMidnightUtcMs(day, timeZone);
  const next = localMidnightUtcMs(addDays(day, 1), timeZone);
  if (start === null || next === null) return [day];
  const dates: string[] = [];
  let cursor = Date.UTC(
    new Date(start).getUTCFullYear(),
    new Date(start).getUTCMonth(),
    new Date(start).getUTCDate(),
  );
  while (cursor < next && dates.length < 3) {
    dates.push(isoDayFromMs(cursor));
    cursor += 24 * HOUR_MS;
  }
  return dates.length > 0 ? dates : [day];
}

/**
 * LiveScore takes its whole local day through one offset, but only whole hours exist in the
 * URL. Fractional zones ask for the two UTC days that cover the local day instead.
 */
function liveScoreDayRequests(day: string, timeZone: string): DayRequest[] {
  const offset = offsetMinutesAtLocalNoon(day, timeZone);
  if (offset !== null && offset % 60 === 0) {
    const hours = offset / 60;
    return [{ path: `date/soccer/${compactDay(day)}/${hours}?MD=1`, offset: hours }];
  }
  return utcDatesForLocalDay(day, timeZone).map((date) => ({
    path: `date/soccer/${compactDay(date)}/0?MD=1`,
    offset: 0,
  }));
}

function liveScoreOffset(day: string, timeZone: string): number {
  const offset = offsetMinutesAtLocalNoon(day, timeZone);
  return offset !== null && offset % 60 === 0 ? offset / 60 : 0;
}

function sortMatches(matches: readonly LiveMatch[]): LiveMatch[] {
  return [...matches].sort((a, b) => {
    const time = (a.kickoffUtc ?? '9999').localeCompare(b.kickoffUtc ?? '9999');
    if (time !== 0) return time;
    const competition = a.competition.localeCompare(b.competition, 'ru');
    if (competition !== 0) return competition;
    return a.id.localeCompare(b.id);
  });
}

function uniqueMatches(matches: readonly LiveMatch[]): LiveMatch[] {
  const byId = new Map<string, LiveMatch>();
  for (const match of matches) byId.set(match.id, match);
  return [...byId.values()];
}

interface ReplyTimes {
  fetchedAt: string | null;
  stale: boolean;
}

function replyTimes(replies: ReadonlyArray<{ fetchedAt?: string; stale: boolean }>): ReplyTimes {
  let fetchedAt: string | null = null;
  for (const reply of replies) {
    if (reply.fetchedAt && (!fetchedAt || reply.fetchedAt > fetchedAt)) fetchedAt = reply.fetchedAt;
  }
  return { fetchedAt, stale: replies.some((reply) => reply.stale) };
}

export function readLiveSourceChoice(): LiveSourceChoice {
  const value = getString(LIVE_SOURCE_KEY);
  return value === 'livescore' || value === 'espn' ? value : 'auto';
}

async function loadEspnDay(options: LiveLoadOptions): Promise<LiveData> {
  const now = options.now ?? new Date();
  const day = localDayIso(now, options.timeZone);
  if (!day) throw new Error('Не удалось определить местную дату.');
  const dates = utcDatesForLocalDay(day, options.timeZone).map(compactDay);
  const slugs = [
    ...new Set(
      options.leagueIds
        .map(espnSlugForLeague)
        .filter((slug): slug is string => typeof slug === 'string'),
    ),
  ];
  if (slugs.length === 0) return { matches: [], source: 'espn', fetchedAt: null, stale: false };
  const paths = slugs.flatMap((slug) => dates.map((date) => `${slug}/scoreboard?dates=${date}`));
  const replies = await Promise.all(
    paths.map((path) => api('espn', path, { automatic: options.automatic })),
  );
  const parsed = replies.flatMap((reply) => parseEspnScoreboard(reply.payload));
  const times = replyTimes(replies);
  return {
    matches: sortMatches(onLocalDay(uniqueMatches(parsed), day, options.timeZone)),
    source: 'espn',
    fetchedAt: times.fetchedAt,
    stale: times.stale,
  };
}

/** The whole local day. Auto tries LiveScore first and ESPN only when LiveScore has nothing. */
export async function loadLiveDay(options: LiveLoadOptions): Promise<LiveData> {
  const choice = readLiveSourceChoice();
  const now = options.now ?? new Date();
  if (choice !== 'espn') {
    const day = localDayIso(now, options.timeZone);
    if (day) {
      try {
        const requests = liveScoreDayRequests(day, options.timeZone);
        const replies = await Promise.all(
          requests.map((request) =>
            api('livescore', request.path, { automatic: options.automatic }),
          ),
        );
        const parsed = replies.flatMap((reply, index) =>
          parseLiveScore(reply.payload, requests[index]!.offset),
        );
        if (parsed.length > 0 || choice === 'livescore') {
          const times = replyTimes(replies);
          return {
            matches: sortMatches(onLocalDay(uniqueMatches(parsed), day, options.timeZone)),
            source: 'livescore',
            fetchedAt: times.fetchedAt,
            stale: times.stale,
          };
        }
      } catch (error) {
        if (choice === 'livescore') throw error;
      }
    } else if (choice === 'livescore') {
      throw new Error('Не удалось определить местную дату.');
    }
  }
  return loadEspnDay(options);
}

/**
 * Matches in progress. The live sheet always uses the source of the current day sheet:
 * ESPN is only read when ESPN answered the day, so one list never mixes the two sources.
 */
export async function loadLiveNow(
  options: LiveLoadOptions & { source: LiveSource },
): Promise<LiveData> {
  if (options.source === 'espn') return loadEspnDay(options);
  const now = options.now ?? new Date();
  const day = localDayIso(now, options.timeZone);
  if (!day) throw new Error('Не удалось определить местную дату.');
  const offset = liveScoreOffset(day, options.timeZone);
  const reply = await api('livescore', `live/soccer/${offset}?MD=1`, {
    automatic: options.automatic,
  });
  return {
    matches: sortMatches(parseLiveScore(reply.payload, offset)),
    source: 'livescore',
    fetchedAt: reply.fetchedAt ?? null,
    stale: reply.stale,
  };
}

/**
 * A live request is worth making only while a followed match is running, starts within
 * fifteen minutes, or kicked off less than two and a half hours ago and is not finished.
 */
export function needsLiveUpdates(
  matches: readonly LiveMatch[],
  leagueIds: readonly string[],
  nowMs: number,
): boolean {
  const followed = new Set(leagueIds);
  return matches.some((match) => {
    if (!match.leagueId || !followed.has(match.leagueId)) return false;
    if (match.state === 'live') return true;
    if (match.state === 'finished' || match.state === 'cancelled' || match.state === 'postponed')
      return false;
    if (!match.kickoffUtc) return false;
    const kickoff = Date.parse(match.kickoffUtc);
    if (!Number.isFinite(kickoff)) return false;
    const until = kickoff - nowMs;
    if (until >= 0) return until <= STARTING_SOON_MS;
    return nowMs - kickoff < RECENT_KICKOFF_MS;
  });
}

function backoffMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, LIVE_INTERVAL_MS * 2 ** Math.max(0, failures - 1));
}

interface SheetMeta {
  source: LiveSource | null;
  fetchedAt: string | null;
  stale: boolean;
}

/**
 * One day sheet and one live sheet. Successful answers replace their own sheet; failures
 * keep both the matches and the fetch time already shown.
 */
export function useLiveMatches({
  leagueIds,
}: {
  leagueIds: readonly string[];
}): UseLiveMatchesResult {
  const leagueKey = leagueIds.join(',');
  const [data, setData] = useState<LiveData>({
    matches: [],
    source: null,
    fetchedAt: null,
    stale: false,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayRef = useRef<LiveMatch[]>([]);
  const liveRef = useRef<LiveMatch[]>([]);
  const dayMetaRef = useRef<SheetMeta>({ source: null, fetchedAt: null, stale: false });
  const liveMetaRef = useRef<SheetMeta>({ source: null, fetchedAt: null, stale: false });
  const dayDateRef = useRef<string | null>(null);
  const nextDayAtRef = useRef(0);
  const nextLiveAtRef = useRef(0);
  const dayFailuresRef = useRef(0);
  const liveFailuresRef = useRef(0);
  const dayInFlightRef = useRef(false);
  const liveInFlightRef = useRef(false);
  const firstDayDoneRef = useRef(false);
  const mountedRef = useRef(true);
  const leagueKeyRef = useRef(leagueKey);
  leagueKeyRef.current = leagueKey;

  const merged = useCallback((): LiveMatch[] => {
    const byId = new Map<string, LiveMatch>();
    for (const match of dayRef.current) byId.set(match.id, match);
    // Only a live sheet from the same source as the day sheet may update it.
    if (
      dayMetaRef.current.source !== null &&
      liveMetaRef.current.source === dayMetaRef.current.source
    ) {
      for (const match of liveRef.current) byId.set(match.id, match);
    }
    return sortMatches([...byId.values()]);
  }, []);

  const push = useCallback(() => {
    const matches = merged();
    let meta = dayMetaRef.current;
    const live = liveMetaRef.current;
    if (
      live.source === meta.source &&
      live.fetchedAt &&
      (!meta.fetchedAt || live.fetchedAt >= meta.fetchedAt)
    )
      meta = live;
    setData({ matches, source: meta.source, fetchedAt: meta.fetchedAt, stale: meta.stale });
  }, [merged]);

  const syncBusy = useCallback(() => {
    if (mountedRef.current) setRefreshing(dayInFlightRef.current || liveInFlightRef.current);
  }, []);

  const loadLive = useCallback(
    async (automatic: boolean) => {
      if (liveInFlightRef.current) return;
      const source = dayMetaRef.current.source;
      if (!source) return;
      liveInFlightRef.current = true;
      syncBusy();
      const startedAt = Date.now();
      const timeZone = getUserTimezone();
      const requestedDay = localDayIso(new Date(startedAt), timeZone);
      try {
        const result = await loadLiveNow({
          leagueIds: leagueKeyRef.current.split(',').filter(Boolean),
          timeZone,
          now: new Date(startedAt),
          automatic,
          source,
        });
        if (!mountedRef.current) return;
        const currentDay = localDayIso(new Date(), timeZone);
        if (requestedDay && currentDay && requestedDay !== currentDay) return;
        if (dayMetaRef.current.source !== source) return;
        liveRef.current = result.matches;
        liveMetaRef.current = {
          source: result.source,
          fetchedAt: result.fetchedAt,
          stale: result.stale,
        };
        liveFailuresRef.current = 0;
        nextLiveAtRef.current = Date.now() + LIVE_INTERVAL_MS;
        setError(null);
        push();
      } catch (caught) {
        if (!mountedRef.current) return;
        const currentDay = localDayIso(new Date(), timeZone);
        if (requestedDay && currentDay && requestedDay !== currentDay) return;
        if (dayMetaRef.current.source !== source) return;
        liveFailuresRef.current += 1;
        nextLiveAtRef.current = Date.now() + backoffMs(liveFailuresRef.current);
        setError(caught instanceof Error ? caught.message : 'Матчи недоступны');
      } finally {
        liveInFlightRef.current = false;
        syncBusy();
      }
    },
    [push, syncBusy],
  );

  const loadDay = useCallback(
    async (automatic: boolean) => {
      if (dayInFlightRef.current) return;
      dayInFlightRef.current = true;
      syncBusy();
      const startedAt = Date.now();
      const timeZone = getUserTimezone();
      const requestedDay = localDayIso(new Date(startedAt), timeZone);
      try {
        const result = await loadLiveDay({
          leagueIds: leagueKeyRef.current.split(',').filter(Boolean),
          timeZone,
          now: new Date(startedAt),
          automatic,
        });
        if (!mountedRef.current) return;
        if (dayDateRef.current && requestedDay && dayDateRef.current !== requestedDay) return;
        const previousSource = dayMetaRef.current.source;
        dayRef.current = result.matches;
        dayMetaRef.current = {
          source: result.source,
          fetchedAt: result.fetchedAt,
          stale: result.stale,
        };
        if (previousSource !== result.source) {
          liveRef.current = [];
          liveMetaRef.current = { source: null, fetchedAt: null, stale: false };
        }
        dayDateRef.current = requestedDay;
        dayFailuresRef.current = 0;
        nextDayAtRef.current = Date.now() + DAY_INTERVAL_MS;
        setError(null);
        push();
        if (
          Date.now() >= nextLiveAtRef.current &&
          needsLiveUpdates(merged(), leagueKeyRef.current.split(',').filter(Boolean), Date.now())
        )
          void loadLive(automatic);
      } catch (caught) {
        if (!mountedRef.current) return;
        if (dayDateRef.current && requestedDay && dayDateRef.current !== requestedDay) return;
        dayFailuresRef.current += 1;
        nextDayAtRef.current = Date.now() + backoffMs(dayFailuresRef.current);
        setError(caught instanceof Error ? caught.message : 'Матчи недоступны');
      } finally {
        dayInFlightRef.current = false;
        if (!firstDayDoneRef.current) {
          firstDayDoneRef.current = true;
          if (mountedRef.current) setLoading(false);
        }
        syncBusy();
      }
    },
    [loadLive, merged, push, syncBusy],
  );

  useEffect(() => {
    mountedRef.current = true;
    const ids = leagueKey.split(',').filter(Boolean);
    if (!ids.length) {
      mountedRef.current = false;
      setLoading(false);
      return;
    }
    nextDayAtRef.current = Date.now() + DAY_INTERVAL_MS;
    nextLiveAtRef.current = 0;
    void loadDay(false);

    const tick = () => {
      if (!mountedRef.current) return;
      const now = Date.now();
      const timeZone = getUserTimezone();
      const day = localDayIso(new Date(now), timeZone);
      if (day && dayDateRef.current && day !== dayDateRef.current) {
        dayDateRef.current = day;
        liveRef.current = [];
        liveMetaRef.current = { source: null, fetchedAt: null, stale: false };
        nextDayAtRef.current = 0;
        nextLiveAtRef.current = 0;
        push();
        void loadDay(true);
        return;
      }
      if (now >= nextDayAtRef.current) void loadDay(true);
      if (now >= nextLiveAtRef.current && needsLiveUpdates(merged(), ids, now)) void loadLive(true);
    };
    const timer = window.setInterval(tick, LIVE_INTERVAL_MS);
    const onLiveRefresh = () => {
      if (Date.now() >= nextLiveAtRef.current && needsLiveUpdates(merged(), ids, Date.now()))
        void loadLive(true);
    };
    window.addEventListener('sportsdesk-live-refresh', onLiveRefresh);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener('sportsdesk-live-refresh', onLiveRefresh);
    };
  }, [leagueKey, loadDay, loadLive, merged, push]);

  const refresh = useCallback(() => {
    if (!leagueKeyRef.current) return;
    dayFailuresRef.current = 0;
    liveFailuresRef.current = 0;
    nextDayAtRef.current = 0;
    nextLiveAtRef.current = 0;
    setError(null);
    void loadDay(false);
  }, [loadDay]);

  return { ...data, loading, refreshing, error, refresh };
}

export interface PitchMatchReference {
  leagueId: string;
  match: MatchSummary;
}

/**
 * Finds the same fixture among the PitchAPI matches the app has already loaded. Both clubs
 * must have the same `clubKey`, the league must match, and the kick-off may differ by up to
 * three hours (sources publish slightly different times).
 */
export function findPitchMatchId(
  live: LiveMatch,
  references: readonly PitchMatchReference[],
): string | null {
  if (!live.leagueId || !live.kickoffUtc) return null;
  const kickoff = Date.parse(live.kickoffUtc);
  if (!Number.isFinite(kickoff)) return null;
  for (const reference of references) {
    if (reference.leagueId !== live.leagueId) continue;
    const pitchKickoff = Date.parse(reference.match.time_utc ?? '');
    if (!Number.isFinite(pitchKickoff)) continue;
    if (Math.abs(pitchKickoff - kickoff) > 3 * HOUR_MS) continue;
    if (clubKey(reference.match.home_team.name) !== live.home.clubKey) continue;
    if (clubKey(reference.match.away_team.name) !== live.away.clubKey) continue;
    return reference.match.id;
  }
  return null;
}
