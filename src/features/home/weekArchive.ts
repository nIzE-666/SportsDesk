import { getJson } from '../football/storage';
import type { MatchEvent, MatchSummary } from '../football/types';
import {
  FOLLOWED_COMPETITION_IDS,
  goalSteps,
  matchStartMs,
  parseDateMatches,
  parseEvents,
  scoreValue,
  shiftDayKey,
  type DateMatchSummary,
} from './weekData';

const PREFIX = 'sportsdesk.home.archive.';
const RETENTION_MS = 35 * 24 * 60 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 1024 * 1024;
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
  const home = scoreValue(match.score_home);
  const away = scoreValue(match.score_away);
  return home === null || away === null ? null : `${home}:${away}`;
}

function trimWeekArchive(now: number, limit: number, replacing?: string): void {
  const cutoff = now - RETENTION_MS;
  const retained: Array<{ key: string; date: number; size: number }> = [];
  let used = 0;
  Object.keys(localStorage)
    .filter((key) => key.startsWith(PREFIX) && key !== replacing)
    .forEach((key) => {
      const date = Date.parse(key.slice(PREFIX.length).split('.')[1] ?? '');
      if (!Number.isFinite(date) || date < cutoff) {
        localStorage.removeItem(key);
        return;
      }
      const size = 2 * (key.length + (localStorage.getItem(key)?.length ?? 0));
      retained.push({ key, date, size });
      used += size;
    });
  for (const item of retained.sort((a, b) => a.date - b.date)) {
    if (used <= limit) break;
    localStorage.removeItem(item.key);
    used -= item.size;
  }
}

function saveArchive(key: string, data: ArchivedDay | ArchivedEvents): void {
  try {
    const value = JSON.stringify(data);
    const size = 2 * (key.length + value.length);
    if (size > MAX_ARCHIVE_BYTES || localStorage.getItem(key) === value) return;
    trimWeekArchive(Date.now(), MAX_ARCHIVE_BYTES - size, key);
    localStorage.setItem(key, value);
  } catch {
    // The archive is optional when storage is unavailable.
  }
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
  saveArchive(`${PREFIX}day.${date}`, {
    matches: matches.filter((match) => match.league && followed.has(match.league.id)),
    fetchedAt,
  });
}

function canArchive(match: MatchSummary, events: MatchEvent[]): boolean {
  // Persist only feeds that can show the scoring sequence for the final result.
  const goals = goalSteps(match, events);
  const home = goals.filter((goal) => goal.side === 'home').length;
  return events.length > 0 && home === match.score_home && goals.length - home === match.score_away;
}

export function readArchivedEvents(match: MatchSummary): MatchEvent[] | null {
  const day = matchDay(match);
  const result = resultKey(match);
  if (!day || !result) return null;
  const saved = getJson<ArchivedEvents | null>(`${PREFIX}events.${day}.${match.id}`, null);
  const events = parseEvents(saved);
  return saved?.result === result && events && canArchive(match, events) ? events : null;
}

export function archiveEvents(match: MatchSummary, events: MatchEvent[]): void {
  const day = matchDay(match);
  const result = resultKey(match);
  if (!day || !result || !canArchive(match, events)) return;
  saveArchive(`${PREFIX}events.${day}.${match.id}`, { result, events });
}

export function pruneWeekArchive(now: number): void {
  try {
    trimWeekArchive(now, MAX_ARCHIVE_BYTES);
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
