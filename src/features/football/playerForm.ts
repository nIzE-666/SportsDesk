import { loadMatchPlayers } from './playerAnalytics';
import type { MatchSummary, PlayerMatchEntry } from './types';

export type PlayerFormWindow = 5 | 10;
export type PlayerFormMetricKey = 'rating' | 'minutes' | 'goals' | 'assists';
export type PlayerFormStatus = 'available' | 'missing' | 'not-played' | 'failed';

export interface PlayerFormRow {
  id: string;
  match: MatchSummary;
  /** A calendar date or normalized fixture time, or null when neither is usable. */
  date: string | null;
  status: PlayerFormStatus;
  playerPresent: boolean;
  rating: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
}

export interface PlayerFormMetric {
  mean: number | null;
  total: number | null;
  /** Each metric has its own denominator. Missing metrics never count as zero. */
  observed: number;
}

export interface PlayerFormSummary {
  fixtures: number;
  available: number;
  missing: number;
  failed: number;
  /** A subset of available: only an explicitly reported zero-minute appearance. */
  notPlayed: number;
  from: string | null;
  to: string | null;
  metrics: Record<PlayerFormMetricKey, PlayerFormMetric>;
}

export interface PlayerForm {
  window: PlayerFormWindow;
  /** Chronological latest N team fixtures, including missing/failed observations. */
  rows: PlayerFormRow[];
  /** Chronological latest 60 fixtures at most; this is the loaded subset, not a career. */
  baselineRows: PlayerFormRow[];
  recent: PlayerFormSummary;
  baseline: PlayerFormSummary;
  totalCandidates: number;
  scanned: number;
  available: number;
  failed: number;
  fetchedAt: string | null;
  stale: boolean;
}

const METRICS: PlayerFormMetricKey[] = ['rating', 'minutes', 'goals', 'assists'];
const METRIC_KEYS: Record<PlayerFormMetricKey, readonly string[]> = {
  rating: ['rating_title', 'rating'],
  minutes: ['minutes_played', 'minutes'],
  goals: ['goals'],
  assists: ['assists'],
};
const NUMERIC_TYPES = new Set(['integer', 'double', 'number', 'float']);
const MAX_BASELINE = 60;
const CONCURRENCY = 3;

function sourceTimestamp(raw: string | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  const parts =
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(
      value,
    );
  if (!parts) return null;
  const day = parts[1]!;
  const calendarDay = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== day)
    return null;
  if (!parts[2]) return calendarDay.getTime();
  if (Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4] ?? 0) > 59) return null;
  // Both provider fields are UTC-labelled. Unlike Date.parse(offsetless), this
  // never treats a space-separated time as local to the Windows host. A date-only
  // record remains its UTC calendar day for ordering; no kickoff time is claimed.
  const iso = `${day}T${parts[2]}:${parts[3]}:${parts[4] ?? '00'}${parts[5] ?? ''}${parts[6] ?? 'Z'}`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function fixtureTime(match: MatchSummary): number | null {
  // A malformed time_utc must not hide an otherwise valid calendar date.
  return sourceTimestamp(match.time_utc) ?? sourceTimestamp(match.date);
}

function fixtureDate(match: MatchSummary): string | null {
  for (const value of [match.time_utc, match.date]) {
    const time = sourceTimestamp(value);
    if (time === null || !value) continue;
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : new Date(time).toISOString();
  }
  return null;
}

function compareFixtures(a: MatchSummary, b: MatchSummary): number {
  const at = fixtureTime(a);
  const bt = fixtureTime(b);
  if (at !== bt) {
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function duplicateKey(match: MatchSummary): string {
  // Stable tie-break for repeated fixture copies; independent of input list order.
  return JSON.stringify([
    match.time_utc ?? '',
    match.date ?? '',
    match.home_team.id,
    match.away_team.id,
    match.home_team.name,
    match.away_team.name,
    match.score_home,
    match.score_away,
  ]);
}

/** Exact club membership and finished status only. Undated fixtures sort last. */
export function selectPlayerFormFixtures(teamId: string, matches: MatchSummary[]): MatchSummary[] {
  const unique = new Map<string, MatchSummary>();
  if (!teamId || !Array.isArray(matches)) return [];
  for (const match of matches) {
    if (!match?.id || match.status?.toLowerCase() !== 'finished') continue;
    if (match.home_team?.id !== teamId && match.away_team?.id !== teamId) continue;
    const prior = unique.get(match.id);
    if (
      !prior ||
      compareFixtures(match, prior) < 0 ||
      (compareFixtures(match, prior) === 0 && duplicateKey(match) < duplicateKey(prior))
    ) {
      unique.set(match.id, match);
    }
  }
  return Array.from(unique.values()).sort(compareFixtures);
}

function numericValue(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function emptyRow(match: MatchSummary, status: PlayerFormStatus): PlayerFormRow {
  return {
    id: match.id,
    match,
    date: fixtureDate(match),
    status,
    playerPresent: false,
    rating: null,
    minutes: null,
    goals: null,
    assists: null,
  };
}

export function playerFormRow(
  match: MatchSummary,
  entries: PlayerMatchEntry[],
  playerId: string,
  teamId: string,
): PlayerFormRow {
  const row = emptyRow(match, 'missing');
  const values = new Map<string, number>();
  for (const entry of entries) {
    if (entry?.player?.id !== playerId || entry.team_id !== teamId) continue;
    row.playerPresent = true;
    for (const group of Array.isArray(entry.stats) ? entry.stats : []) {
      if (!group?.stats || typeof group.stats !== 'object') continue;
      for (const wrapped of Object.values(group.stats)) {
        if (!wrapped?.stat || !NUMERIC_TYPES.has(wrapped.stat.type)) continue;
        const key = typeof wrapped.key === 'string' ? wrapped.key.trim().toLowerCase() : '';
        const value = numericValue(wrapped.stat.value);
        if (key && value !== null && !values.has(key)) values.set(key, value);
      }
    }
  }
  for (const metric of METRICS) {
    for (const key of METRIC_KEYS[metric]) {
      const value = values.get(key);
      if (value !== undefined) {
        row[metric] = value;
        break;
      }
    }
  }
  if (METRICS.some((metric) => row[metric] !== null)) row.status = 'available';
  // Absence or an empty statistics object is unknown, never proof that he did not play.
  if (
    row.minutes === 0 &&
    (row.rating ?? 0) === 0 &&
    (row.goals ?? 0) === 0 &&
    (row.assists ?? 0) === 0
  ) {
    row.status = 'not-played';
  }
  return row;
}

export function summarizePlayerFormRows(rows: PlayerFormRow[]): PlayerFormSummary {
  const metrics = {} as Record<PlayerFormMetricKey, PlayerFormMetric>;
  for (const metric of METRICS) {
    const values = rows
      .map((row) => row[metric])
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const total = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    metrics[metric] = {
      total,
      mean: total === null ? null : total / values.length,
      observed: values.length,
    };
  }
  const dates = rows
    .map((row) => row.date)
    .filter((date): date is string => date !== null)
    .sort();
  return {
    fixtures: rows.length,
    available: rows.filter((row) => row.status === 'available' || row.status === 'not-played')
      .length,
    missing: rows.filter((row) => row.status === 'missing').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    notPlayed: rows.filter((row) => row.status === 'not-played').length,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    metrics,
  };
}

/** Re-slice an already loaded baseline without making requests when switching 5/10. */
export function selectPlayerFormWindow(form: PlayerForm, window: PlayerFormWindow): PlayerForm {
  const rows = form.baselineRows.slice(-window);
  return { ...form, window, rows, recent: summarizePlayerFormRows(rows) };
}

export async function fetchPlayerForm(
  playerId: string,
  teamId: string,
  matches: MatchSummary[],
  window: PlayerFormWindow = 5,
  onProgress?: (done: number, total: number) => void,
): Promise<PlayerForm> {
  const allCandidates = playerId ? selectPlayerFormFixtures(teamId, matches) : [];
  const candidates = allCandidates.slice(0, MAX_BASELINE);
  const rows: PlayerFormRow[] = new Array(candidates.length);
  let next = 0;
  let done = 0;
  let fetchedAt: string | null = null;
  let stale = false;
  async function worker(): Promise<void> {
    while (next < candidates.length) {
      const index = next++;
      const match = candidates[index]!;
      try {
        const cached = await loadMatchPlayers(match.id);
        rows[index] = playerFormRow(match, cached.entries, playerId, teamId);
        stale ||= cached.stale;
        if (!fetchedAt || cached.fetchedAt > fetchedAt) fetchedAt = cached.fetchedAt;
      } catch {
        rows[index] = emptyRow(match, 'failed');
      } finally {
        done += 1;
        try {
          onProgress?.(done, candidates.length);
        } catch {
          /* Consumer progress cannot discard data. */
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker()),
  );
  // Workers populate predetermined slots; completion order never changes chronology.
  const baselineRows = rows.reverse();
  const baseline = summarizePlayerFormRows(baselineRows);
  const form: PlayerForm = {
    window,
    rows: [],
    baselineRows,
    recent: summarizePlayerFormRows([]),
    baseline,
    totalCandidates: allCandidates.length,
    scanned: candidates.length,
    available: baseline.available,
    failed: baseline.failed,
    fetchedAt,
    stale,
  };
  return selectPlayerFormWindow(form, window);
}
