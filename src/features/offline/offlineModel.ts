import type { MatchSummary } from '../football/types';

export const MAX_OFFLINE_SEASONS = 60;
export const MAX_OFFLINE_BYTES = 2_000_000;
export interface OfflineMatch {
  id: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  date: string;
  timeUtc: string | null;
  round: string;
}
export interface OfflineSeason {
  version: 1;
  leagueId: string;
  leagueName: string;
  season: string;
  fetchedAt: string;
  pinned: boolean;
  duplicates: number;
  matches: OfflineMatch[];
}
export interface Coverage {
  state: 'complete' | 'partial' | 'unverified';
  expected: number | null;
  finished: number;
  missingScores: number;
  missingDates: number;
  missingTimes: number;
}
export interface OfflineSummary extends Omit<OfflineSeason, 'matches'> {
  matches: number;
  bytes: number;
  coverage: Coverage;
}
export const seasonKey = (leagueId: string, season: string) => JSON.stringify([leagueId, season]);
export const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const bounded = (v: unknown, max: number, empty = false): v is string =>
  typeof v === 'string' && v.length <= max && (empty || !!v.trim());
const day = (v: unknown): v is string =>
  typeof v === 'string' &&
  (v === '' ||
    (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v));
export const instant = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 40 &&
  /(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
const score = (v: unknown) =>
  v === null || (Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 100);

export function validOfflineSeason(v: unknown): v is OfflineSeason {
  if (
    !isObject(v) ||
    v.version !== 1 ||
    !bounded(v.leagueId, 100) ||
    !bounded(v.leagueName, 200) ||
    !bounded(v.season, 30) ||
    !instant(v.fetchedAt) ||
    typeof v.pinned !== 'boolean' ||
    !Number.isSafeInteger(v.duplicates) ||
    Number(v.duplicates) < 0 ||
    !Array.isArray(v.matches) ||
    !v.matches.length ||
    v.matches.length > 2000
  )
    return false;
  const ids = new Set<string>();
  for (const m of v.matches) {
    if (
      !isObject(m) ||
      !bounded(m.id, 100) ||
      ids.has(m.id) ||
      !bounded(m.homeId, 100) ||
      !bounded(m.awayId, 100) ||
      m.homeId === m.awayId ||
      !bounded(m.homeName, 200) ||
      !bounded(m.awayName, 200) ||
      !score(m.homeScore) ||
      !score(m.awayScore) ||
      !bounded(m.status, 100) ||
      !day(m.date) ||
      !(m.timeUtc === null || instant(m.timeUtc)) ||
      !bounded(m.round, 200, true)
    )
      return false;
    ids.add(m.id);
  }
  return new TextEncoder().encode(JSON.stringify(v)).length <= MAX_OFFLINE_BYTES;
}

/** Explicitly bounded rules: a future competition format requires a new audit. */
export function expectedTeams(leagueId: string, season: string): number | null {
  if (!/^(202[1-6])\/202[2-7]$/.test(season)) return null;
  const year = Number(season.slice(0, 4));
  if (Number(season.slice(5)) !== year + 1) return null;
  if (['l_4WFCIZ', 'l_0ErfuF', 'l_0ALvwF'].includes(leagueId)) return 20;
  if (leagueId === 'l_1Isor4') return 18;
  if (leagueId === 'l_3FJFUl') return year >= 2023 ? 18 : 20;
  return null;
}
export function seasonCoverage(p: OfflineSeason): Coverage {
  const teams = expectedTeams(p.leagueId, p.season);
  const expected = teams === null ? null : teams * (teams - 1);
  const ids = new Set(p.matches.flatMap((m) => [m.homeId, m.awayId]));
  const pairs = new Set(p.matches.map((m) => JSON.stringify([m.homeId, m.awayId])));
  const missingDates = p.matches.filter((m) => !m.date).length;
  return {
    state:
      expected === null
        ? 'unverified'
        : p.matches.length === expected &&
            ids.size === teams &&
            pairs.size === expected &&
            !missingDates
          ? 'complete'
          : 'partial',
    expected,
    finished: p.matches.filter((m) => m.status === 'finished').length,
    missingScores: p.matches.filter(
      (m) => m.status === 'finished' && (m.homeScore === null || m.awayScore === null),
    ).length,
    missingDates,
    missingTimes: p.matches.filter((m) => m.timeUtc === null).length,
  };
}
export function summarizeSeason(p: OfflineSeason): OfflineSummary {
  return {
    ...p,
    matches: p.matches.length,
    bytes: new TextEncoder().encode(JSON.stringify(p)).length,
    coverage: seasonCoverage(p),
  };
}

export function offlineMatches(p: OfflineSeason): MatchSummary[] {
  return p.matches.map((m) => ({
    id: m.id,
    home_team: { id: m.homeId, name: m.homeName },
    away_team: { id: m.awayId, name: m.awayName },
    score_home: m.homeScore,
    score_away: m.awayScore,
    status: m.status,
    date: m.date || undefined,
    time_utc: m.timeUtc ?? undefined,
    round_name: m.round,
  }));
}
