import { getJson, setJson } from '../football/storage';
import type { MatchEvent, MatchSummary } from '../football/types';
import {
  FOLLOWED_COMPETITION_IDS,
  matchStartMs,
  parseDateMatches,
  parseEvents,
  shiftDayKey,
  type DateMatchSummary,
} from './weekData';

const PREFIX = 'sportsdesk.home.archive.';
const RETENTION_MS = 35 * 24 * 60 * 60 * 1000;
const followed = new Set(FOLLOWED_COMPETITION_IDS);

interface ArchivedDay {
  matches: DateMatchSummary[];
  fetchedAt: string;
}

interface ArchivedEvents {
  result: string;
  events: MatchEvent[];
}

function matchDay(match: MatchSummary): string | null {
  const start = matchStartMs(match);
  return start === null ? null : new Date(start).toISOString().slice(0, 10);
}

function resultKey(match: MatchSummary): string | null {
  if (
    typeof match.score_home !== 'number' ||
    typeof match.score_away !== 'number' ||
    !Number.isSafeInteger(match.score_home) ||
    !Number.isSafeInteger(match.score_away) ||
    match.score_home < 0 ||
    match.score_away < 0
  )
    return null;
  return `${match.score_home}:${match.score_away}`;
}

export function readArchivedDay(date: string): ArchivedDay | null {
  const saved = getJson<ArchivedDay | null>(`${PREFIX}day.${date}`, null);
  const matches = parseDateMatches(saved);
  if (!matches || !saved || !Number.isFinite(Date.parse(saved.fetchedAt))) return null;
  return { matches, fetchedAt: saved.fetchedAt };
}

export function archiveDay(date: string, matches: DateMatchSummary[], fetchedAt: string): void {
  if (!Number.isFinite(Date.parse(fetchedAt))) return;
  const current = readArchivedDay(date);
  if (current && Date.parse(current.fetchedAt) > Date.parse(fetchedAt)) return;
  setJson(`${PREFIX}day.${date}`, {
    matches: matches.filter((match) => match.league && followed.has(match.league.id)),
    fetchedAt,
  });
}

function canArchive(result: string, events: MatchEvent[]): boolean {
  const goals = events.filter((event) => event.event_type === 'goal');
  const total = result
    .split(':')
    .map(Number)
    .reduce((sum, value) => sum + value, 0);
  // An empty (or incomplete) feed shortly after full time must be retried.
  return events.length > 0 && goals.length >= total;
}

export function readArchivedEvents(match: MatchSummary): MatchEvent[] | null {
  const day = matchDay(match);
  const result = resultKey(match);
  if (!day || !result) return null;
  const saved = getJson<ArchivedEvents | null>(`${PREFIX}events.${day}.${match.id}`, null);
  const events = parseEvents(saved);
  return saved?.result === result && events && canArchive(result, events) ? events : null;
}

export function archiveEvents(match: MatchSummary, events: MatchEvent[]): void {
  const day = matchDay(match);
  const result = resultKey(match);
  if (!day || !result || !canArchive(result, events)) return;
  setJson(`${PREFIX}events.${day}.${match.id}`, { result, events });
}

export function pruneWeekArchive(now: number): void {
  const cutoff = now - RETENTION_MS;
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (!key.startsWith(PREFIX)) continue;
      const date = key.slice(PREFIX.length).split('.')[1] ?? '';
      if (Date.parse(date) < cutoff) localStorage.removeItem(key);
    }
  } catch {
    // Browsing still works if storage is unavailable.
  }
}

/** The planner needs selected cup fixtures as well as the league schedules it already loads. */
export function archivedPlannedFixtures(today: string, includes: (id: string) => boolean) {
  const matches = new Map<string, DateMatchSummary>();
  for (let offset = -2; offset <= 8; offset += 1) {
    for (const match of readArchivedDay(shiftDayKey(today, offset))?.matches ?? []) {
      if (typeof match.id === 'string' && match.home_team && match.away_team && includes(match.id))
        matches.set(match.id, match);
    }
  }
  return matches;
}
