import { api } from '../../lib/bridge';
import type { MatchSummary, PlayerMatchEntry } from './types';

export interface SeasonMetric {
  key: string;
  label: string;
  type: string;
  value: number;
  total?: number;
  matches: number;
  kind: 'total' | 'average' | 'fraction';
}

export interface PlayerSeasonStats {
  metrics: SeasonMetric[];
  matches: { id: string; date?: string; minutes: number | null; rating: number | null }[];
  scanned: number;
  available: number;
  failed: number;
  totalCandidates: number;
  minutes: number;
  fetchedAt: string | null;
  stale: boolean;
}

const MAX_CANDIDATES = 60;
const CONCURRENCY = 3;
const CACHE_TTL_MS = 15 * 60 * 1000;

interface RawStatValue {
  type?: string;
  value?: number | string | null;
  total?: number | string | null;
}

interface RawStatItem {
  key?: string;
  title?: string;
  stats?: Record<string, { key?: string; stat?: RawStatValue } | undefined>;
}

interface RawPlayersPayload {
  data?: PlayerMatchEntry[] | null;
}

export interface CachedPlayers {
  entries: PlayerMatchEntry[];
  fetchedAt: string;
  stale: boolean;
}

interface AggregatedValue {
  key: string;
  label: string;
  type: string;
  kind: 'total' | 'average' | 'fraction';
  value: number;
  total?: number;
  matches: number;
}

const cache = new Map<string, Promise<CachedPlayers>>();

function pruneCache(): void {
  // Bound memory: drop oldest entries beyond a soft limit as well as providing reject-evict behavior.
  while (cache.size > 400) {
    const first = cache.keys().next();
    if (first.done) break;
    cache.delete(first.value);
  }
}

export function loadMatchPlayers(matchId: string): Promise<CachedPlayers> {
  const existing = cache.get(matchId);
  if (existing) return existing;

  const promise = (async (): Promise<CachedPlayers> => {
    const reply = await api('pitch', `matches/${encodeURIComponent(matchId)}/players`);
    const payload = reply.payload as RawPlayersPayload | null | undefined;
    const raw = payload && Array.isArray(payload.data) ? payload.data : null;
    if (!raw) {
      throw new Error('Ответ PitchAPI не содержит данных игроков матча.');
    }
    return {
      entries: raw,
      fetchedAt: typeof reply.fetchedAt === 'string' ? reply.fetchedAt : new Date().toISOString(),
      stale: reply.stale === true,
    };
  })();

  const cached = promise.then(
    (value) => value,
    (error) => {
      // Never keep a rejected promise: evict so a retry can re-request.
      cache.delete(matchId);
      throw error;
    },
  );

  cache.set(matchId, cached);
  pruneCache();

  const timer = setTimeout(() => {
    if (cache.get(matchId) === cached) cache.delete(matchId);
  }, CACHE_TTL_MS);
  // Allow the process to exit in non-browser contexts.
  const maybeUnref = timer as unknown as { unref?: () => void };
  if (typeof maybeUnref.unref === 'function') maybeUnref.unref();

  return cached;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed.replace('%', ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const NUMERIC_TYPES = new Set(['integer', 'double', 'number', 'float']);
const FRACTION_TYPE = 'fractionWithPercentage';

// Fields that must never be summed as count totals.
const EXCLUDED_KEYS = new Set([
  'minutes_played',
  'minutes',
  'rating_title',
  'rating',
  'position',
  'position_id',
  'fantasy_points',
  'fantasypoints',
]);

// Use-count whitelist for general additive integer-like metrics.
// Rating, minutes, position, booleans and fantasy points are intentionally absent.
const COUNT_KEYS = new Set([
  'goals',
  'assists',
  'chances_created',
  'defensive_actions',
  'corners',
  'touches',
  'dispossessed',
  'line_breaking_passes',
  'passes_into_final_third',
  'touches_opp_box',
  'blocked_shots',
  'shotsofftarget',
  'shotsontarget',
  'total_shots',
  'interceptions',
  'clearances',
  'fouls',
  'red_cards',
  'yellow_cards',
  'yellowcard',
  'redcard',
  'saves',
  'duels_won',
  'ground_duels_won',
  'aerials_won',
  'tackles_won',
  'big_chances_created',
  'big_chances_missed',
  'final_third_entries',
  'penalty_area_entries',
  'recoveries',
  'possession_won_final_3rd',
  'passes',
  'successful_passes',
  'accurate_passes',
  'accurate_crosses',
  'long_balls_accurate',
  'final_third_passes',
  'key_passes',
  'offsides',
  'xgot',
]);

// Known additive xG/xA family keys (doubles).
const XG_XA_KEYS = new Set([
  'expected_goals',
  'expected_assists',
  'expected_goals_on_target_variant',
  'xg_and_xa',
  'expected_goals_non_penalty',
  'xg',
  'xa',
]);

const LABEL_OVERRIDES: Record<string, string> = {
  goals: 'Голы',
  assists: 'Передачи',
  expected_goals: 'xG',
  expected_assists: 'xA',
  xg_and_xa: 'xG + xA',
  expected_goals_on_target_variant: 'xGOT',
  expected_goals_non_penalty: 'xG без пенальти',
  chances_created: 'Создано моментов',
  minutes_played: 'Минуты',
  rating_title: 'Рейтинг',
  accurate_passes: 'Точные передачи',
  total_shots: 'Удары',
  interceptions: 'Перехваты',
  clearances: 'Выносы',
  fouls: 'Фолы',
  red_cards: 'Красные карточки',
};

const TYPE_LABELS: Record<string, string> = {
  integer: 'шт.',
  double: 'шт.',
  [FRACTION_TYPE]: '%',
};

function safeLabel(key: string, rawTitle: string | undefined): string {
  const override = LABEL_OVERRIDES[key];
  if (override) return override;
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (title.length > 0 && title.length <= 80 && !/[<>]/.test(title)) return title;
  return key.replace(/_/g, ' ');
}

function normalizeKey(rawKey: string | undefined): string {
  return typeof rawKey === 'string' ? rawKey.trim() : '';
}

interface FlatStat {
  key: string;
  label: string;
  type: string;
  value: number;
  total?: number;
}

/** Extract deduped stats for a given player from a match players response. */
function extractPlayerStats(entries: PlayerMatchEntry[], playerId: string): FlatStat[] {
  const deduped = new Map<string, FlatStat>();
  const seenRealKey = new Set<string>();

  for (const entry of entries) {
    if (!entry || !entry.player || entry.player.id !== playerId) continue;
    const groups = Array.isArray(entry.stats) ? entry.stats : [];
    for (const group of groups as RawStatItem[]) {
      if (!group || !group.stats || typeof group.stats !== 'object') continue;
      for (const labelKey of Object.keys(group.stats)) {
        const wrapped = group.stats[labelKey];
        if (!wrapped || !wrapped.stat) continue;
        const stat = wrapped.stat;
        const realKey =
          normalizeKey(wrapped.key) || normalizeKey(stat && (stat as { key?: string }).key);
        if (!realKey) continue; // e.g. shotmap button has empty key
        const type = typeof stat.type === 'string' ? stat.type : '';
        if (!type) continue;
        const value = toNumber(stat.value);
        if (value === null) continue;
        if (seenRealKey.has(realKey)) continue;
        seenRealKey.add(realKey);

        const total = toNumber(stat.total);
        const flat: FlatStat = {
          key: realKey,
          label: safeLabel(
            realKey,
            group.title ? `$'${labelKey}'`.replace(/\$'(.+)'/, '$1') : labelKey,
          ),
          type,
          value,
        };
        if (total !== null && type === FRACTION_TYPE) flat.total = total;
        deduped.set(realKey, flat);
      }
    }
    // Only one entry per player should exist; stop after finding it.
    if (deduped.size > 0) break;
  }

  return Array.from(deduped.values());
}

function isCountable(stat: FlatStat): boolean {
  if (EXCLUDED_KEYS.has(stat.key.toLowerCase())) return false;
  if (stat.type === 'boolean' || stat.type === 'fantasyPoints') return false;
  if (stat.type === FRACTION_TYPE) return false;
  if (!NUMERIC_TYPES.has(stat.type)) return false;
  return COUNT_KEYS.has(stat.key.toLowerCase());
}

function isXgXa(stat: FlatStat): boolean {
  if (!NUMERIC_TYPES.has(stat.type)) return false;
  return XG_XA_KEYS.has(stat.key.toLowerCase());
}

function isFraction(stat: FlatStat): boolean {
  return (
    stat.type === FRACTION_TYPE && typeof stat.total === 'number' && Number.isFinite(stat.total)
  );
}

function isRating(stat: FlatStat): boolean {
  return stat.key.toLowerCase() === 'rating_title' || stat.key.toLowerCase() === 'rating';
}

function isMinutes(stat: FlatStat): boolean {
  return stat.key.toLowerCase() === 'minutes_played' || stat.key.toLowerCase() === 'minutes';
}

export async function fetchPlayerSeasonStats(
  playerId: string,
  teamId: string,
  matches: MatchSummary[],
  onProgress?: (done: number, total: number) => void,
): Promise<PlayerSeasonStats> {
  const candidateMap = new Map<string, MatchSummary>();
  if (Array.isArray(matches) && playerId && teamId) {
    for (const match of matches) {
      if (!match || !match.id) continue;
      const status = typeof match.status === 'string' ? match.status.toLowerCase() : '';
      if (status !== 'finished') continue;
      const homeId = match.home_team && match.home_team.id;
      const awayId = match.away_team && match.away_team.id;
      if (homeId !== teamId && awayId !== teamId) continue;
      if (!candidateMap.has(match.id)) candidateMap.set(match.id, match);
    }
  }

  const candidates = Array.from(candidateMap.values()).slice(0, MAX_CANDIDATES);
  const totalCandidates = candidateMap.size;
  const total = candidates.length;

  const perMatch: {
    id: string;
    date?: string;
    minutes: number | null;
    rating: number | null;
    stats: FlatStat[];
  }[] = [];

  let available = 0;
  let failed = 0;
  let done = 0;
  let staleAny = false;
  let latestFetchedAt: string | null = null;

  const handleResult = (match: MatchSummary, cached: CachedPlayers): void => {
    if (cached.stale) staleAny = true;
    if (!latestFetchedAt || cached.fetchedAt > latestFetchedAt) latestFetchedAt = cached.fetchedAt;

    const stats = extractPlayerStats(cached.entries, playerId);
    const nonEmptyStats = stats.filter(
      (s) => !(s.type === 'boolean') && (s.type !== FRACTION_TYPE || typeof s.total === 'number'),
    );

    let minutes: number | null = null;
    let rating: number | null = null;
    for (const stat of nonEmptyStats) {
      if (isMinutes(stat)) {
        const val = toNumber(stat.value);
        if (val !== null) minutes = (minutes ?? 0) + val;
      } else if (isRating(stat)) {
        const val = toNumber(stat.value);
        if (val !== null) rating = val;
      }
    }

    // Bench / no appearance: no minutes and no rating and no countable stats.
    const countable = nonEmptyStats.filter((s) => isCountable(s) || isXgXa(s) || isFraction(s));
    if (minutes === null && rating === null && countable.length === 0) {
      // Not an appearance; do not record.
      return;
    }

    perMatch.push({
      id: match.id,
      date: match.date,
      minutes,
      rating,
      stats: nonEmptyStats,
    });
    available += 1;
  };

  const queue = candidates.slice();
  const runWorker = async (): Promise<void> => {
    for (;;) {
      const match = queue.shift();
      if (!match) return;
      try {
        const cached = await loadMatchPlayers(match.id);
        handleResult(match, cached);
      } catch {
        failed += 1;
      } finally {
        done += 1;
        if (onProgress) {
          try {
            onProgress(done, total);
          } catch {
            // ignore consumer progress errors
          }
        }
      }
    }
  };

  const workerCount = Math.min(CONCURRENCY, Math.max(1, total));
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i += 1) workers.push(runWorker());
  await Promise.all(workers);

  // Aggregate metrics.
  const aggregated = new Map<string, AggregatedValue>();
  let totalMinutes = 0;
  let minutesKnownMatches = 0;
  const ratingValues: number[] = [];

  for (const match of perMatch) {
    const seenInMatch = new Set<string>();
    for (const stat of match.stats) {
      if (seenInMatch.has(stat.key)) continue;
      seenInMatch.add(stat.key);

      if (isMinutes(stat)) {
        if (typeof match.minutes === 'number' && Number.isFinite(match.minutes)) {
          minutesKnownMatches += 1;
        }
        continue;
      }

      if (isRating(stat)) {
        if (typeof match.rating === 'number' && Number.isFinite(match.rating)) {
          ratingValues.push(match.rating);
        }
        continue;
      }

      if (isXgXa(stat) || isCountable(stat)) {
        const existing = aggregated.get(stat.key);
        if (existing && existing.kind === 'total') {
          existing.value += stat.value;
          existing.matches += 1;
        } else if (!existing) {
          aggregated.set(stat.key, {
            key: stat.key,
            label: stat.label,
            type: stat.type,
            kind: 'total',
            value: stat.value,
            matches: 1,
          });
        }
        continue;
      }

      if (isFraction(stat)) {
        const total = stat.total as number;
        const existing = aggregated.get(stat.key);
        if (existing && existing.kind === 'fraction') {
          existing.value += stat.value;
          existing.total = (existing.total ?? 0) + total;
          existing.matches += 1;
        } else if (!existing) {
          aggregated.set(stat.key, {
            key: stat.key,
            label: stat.label,
            type: stat.type,
            kind: 'fraction',
            value: stat.value,
            total,
            matches: 1,
          });
        }
      }
    }
    if (typeof match.minutes === 'number' && Number.isFinite(match.minutes)) {
      totalMinutes += match.minutes;
    }
  }

  const metrics: SeasonMetric[] = [];

  const goalsLike = aggregated.get('goals');
  const assistsLike = aggregated.get('assists');
  const playsCount = perMatch.length;

  if (goalsLike) {
    metrics.push({
      key: 'goals',
      label: 'Голы',
      type: goalsLike.type,
      value: goalsLike.value,
      matches: goalsLike.matches,
      kind: 'total',
    });
  }
  if (assistsLike) {
    metrics.push({
      key: 'assists',
      label: 'Передачи',
      type: assistsLike.type,
      value: assistsLike.value,
      matches: assistsLike.matches,
      kind: 'total',
    });
  }

  if (playsCount > 0) {
    metrics.push({
      key: 'appearances',
      label: 'Матчи с данными',
      type: 'integer',
      value: playsCount,
      matches: playsCount,
      kind: 'total',
    });
  }

  const perMatchRatings = ratingValues;
  if (perMatchRatings.length > 0) {
    const avg = perMatchRatings.reduce((sum, v) => sum + v, 0) / perMatchRatings.length;
    metrics.push({
      key: 'rating_avg',
      label: 'Средний рейтинг',
      type: 'double',
      value: Math.round(avg * 100) / 100,
      matches: perMatchRatings.length,
      kind: 'average',
    });
  }

  const xg = aggregated.get('expected_goals');
  if (xg) {
    metrics.push({
      key: 'xg',
      label: 'xG',
      type: xg.type,
      value: Math.round(xg.value * 100) / 100,
      matches: xg.matches,
      kind: 'total',
    });
  }
  const xa = aggregated.get('expected_assists');
  if (xa) {
    metrics.push({
      key: 'xa',
      label: 'xA',
      type: xa.type,
      value: Math.round(xa.value * 100) / 100,
      matches: xa.matches,
      kind: 'total',
    });
  }
  const xgXa = aggregated.get('xg_and_xa');
  if (xgXa) {
    metrics.push({
      key: 'xg_xa',
      label: 'xG + xA',
      type: xgXa.type,
      value: Math.round(xgXa.value * 100) / 100,
      matches: xgXa.matches,
      kind: 'total',
    });
  }

  const passes = aggregated.get('accurate_passes');
  if (passes && passes.kind === 'fraction' && passes.total && passes.total > 0) {
    metrics.push({
      key: 'pass_accuracy',
      label: 'Точность передач',
      type: FRACTION_TYPE,
      value: Math.round((passes.value / passes.total) * 1000) / 10,
      total: passes.total,
      matches: passes.matches,
      kind: 'fraction',
    });
  }

  // Add remaining countable metrics (excluding the ones already rendered explicitly).
  const alreadyPushed = new Set([
    'goals',
    'assists',
    'expected_goals',
    'expected_assists',
    'xg_and_xa',
    'accurate_passes',
  ]);
  const leftovers = Array.from(aggregated.values())
    .filter((m) => m.kind === 'total' && !alreadyPushed.has(m.key))
    .sort((a, b) => b.value - a.value);
  for (const m of leftovers) {
    const rounded =
      m.type === 'integer' || m.type === 'number' ? m.value : Math.round(m.value * 100) / 100;
    metrics.push({
      key: m.key,
      label: m.label,
      type: m.type,
      value: rounded,
      matches: m.matches,
      kind: 'total',
    });
  }

  // Fraction leftovers (excluding pass accuracy) - sum numerator/denominator.
  const fractionLeftovers = Array.from(aggregated.values())
    .filter((m) => m.kind === 'fraction' && m.key !== 'accurate_passes' && m.total && m.total > 0)
    .sort((a, b) => b.value - a.value);
  for (const m of fractionLeftovers) {
    const pct = (m.value / (m.total as number)) * 100;
    if (!Number.isFinite(pct)) continue;
    metrics.push({
      key: m.key,
      label: m.label,
      type: FRACTION_TYPE,
      value: Math.round(pct * 10) / 10,
      total: m.total,
      matches: m.matches,
      kind: 'fraction',
    });
  }

  return {
    metrics,
    matches: perMatch.map((m) => ({
      id: m.id,
      date: m.date,
      minutes: m.minutes,
      rating: m.rating,
    })),
    scanned: total,
    available,
    failed,
    totalCandidates,
    minutes: totalMinutes,
    fetchedAt: latestFetchedAt,
    stale: staleAny,
  };
}
