import { api, type ApiReply } from '../../lib/bridge';
import type { OpenF1Session } from './types';

// Fields and units: https://openf1.org/docs/#laps, #pit and #stints.
// Pit lane time is lane_duration; pit_duration is its deprecated alias,
// never the stationary stop time (stop_duration).
export interface RacePaceDriverData {
  driverNumber: number;
  laps: unknown[];
  stints: unknown[];
  pits: unknown[];
  stintsAvailable: boolean;
  pitsAvailable: boolean;
  fetchedAt: string | null;
  stale: boolean;
  warnings: string[];
}

export interface RacePaceData {
  sessionKey: number;
  driverA: RacePaceDriverData;
  driverB: RacePaceDriverData;
  fetchedAt: string | null;
  stale: boolean;
  warnings: string[];
}

export interface RacePaceLap {
  lapNumber: number;
  durationSeconds: number | null;
  /** Null for absent/invalid laps and, by default, pit in/out laps. */
  paceSeconds: number | null;
  compound: string | null;
  stintNumber: number | null;
  pitIn: boolean;
  pitOut: boolean;
  pitLaneSeconds: number | null;
  pitStopSeconds: number | null;
  excludedReason: 'missing' | 'invalid-duration' | 'pit' | null;
}

export interface RacePaceSummary {
  driverNumber: number;
  recordedLapCount: number;
  validLapCount: number;
  excludedPitLapCount: number;
  meanSeconds: number | null;
  medianSeconds: number | null;
  bestSeconds: number | null;
}

export interface RacePaceComparison {
  sessionKey: number;
  excludePitLaps: boolean;
  /** Every integer lap from 1 to the last recorded lap; missing data stays null. */
  rows: { lapNumber: number; a: RacePaceLap; b: RacePaceLap; deltaSeconds: number | null }[];
  a: RacePaceSummary;
  b: RacePaceSummary;
  paired: {
    lapCount: number;
    meanASeconds: number | null;
    meanBSeconds: number | null;
    /** A minus B on matching, included laps only. A negative value means A was quicker. */
    meanDeltaSeconds: number | null;
    medianDeltaSeconds: number | null;
  };
  warnings: string[];
}

type Row = Record<string, unknown>;
const MAX_LAP_NUMBER = 1_000; // Defensive allocation bound, well beyond an F1 race.
const HISTORICAL_DELAY_MS = 30 * 60_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 96;
const responseCache = new Map<string, { reply: ApiReply; expiresAt: number }>();
const inFlight = new Map<string, Promise<ApiReply>>();
let requestQueue: Promise<void> = Promise.resolve();
let starts: number[] = [];

function object(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  const result = numeric(value);
  return result !== null && Number.isInteger(result) && result > 0 && result <= max ? result : null;
}

function positive(value: unknown): number | null {
  const result = numeric(value);
  return result !== null && result > 0 ? result : null;
}

function nonNegative(value: unknown): number | null {
  const result = numeric(value);
  return result !== null && result >= 0 ? result : null;
}

function scopedRows(rows: unknown[], sessionKey: number, driverNumber: number): Row[] {
  return rows.flatMap((value) => {
    const row = object(value);
    if (!row || integer(row.driver_number) !== driverNumber) return [];
    // The endpoint filter scopes rows that omit session_key; an explicit
    // different session is never admitted to a comparison.
    if (row.session_key !== undefined && integer(row.session_key) !== sessionKey) return [];
    return [row];
  });
}

function oldestFetchedAt(replies: { fetchedAt: string | null }[]): string | null {
  return (
    replies
      .map((reply) => reply.fetchedAt)
      .filter(
        (value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)),
      )
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
  );
}

/** Queue request starts, not entire requests. No polling or telemetry queries. */
function requestSlot(): Promise<void> {
  const next = requestQueue.then(async () => {
    const now = Date.now();
    starts = starts.filter((start) => start > now - 60_000);
    const last = starts[starts.length - 1];
    const nextSecond = last === undefined ? now : last + 350;
    const nextMinute = starts.length < 30 ? now : (starts[0] ?? now) + 60_001;
    const delay = Math.max(0, nextSecond - now, nextMinute - now);
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    const startedAt = Date.now();
    starts = starts.filter((start) => start > startedAt - 60_000);
    starts.push(startedAt);
  });
  requestQueue = next.catch(() => undefined);
  return next;
}

async function readEndpoint(path: string, refresh: boolean): Promise<ApiReply> {
  const pending = inFlight.get(path);
  if (pending) return pending;
  const cached = responseCache.get(path);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    responseCache.delete(path);
    responseCache.set(path, cached);
    return cached.reply;
  }
  const request = (async () => {
    await requestSlot();
    const reply = await api('openf1', path);
    if (!Array.isArray(reply.payload))
      throw new Error('Источник вернул некорректный список данных.');
    responseCache.delete(path);
    responseCache.set(path, { reply, expiresAt: Date.now() + CACHE_TTL_MS });
    while (responseCache.size > MAX_CACHE_ENTRIES) {
      const first = responseCache.keys().next().value;
      if (first === undefined) break;
      responseCache.delete(first);
    }
    return reply;
  })();
  inFlight.set(path, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(path) === request) inFlight.delete(path);
  }
}

async function loadDriver(
  sessionKey: number,
  driverNumber: number,
  refresh: boolean,
): Promise<RacePaceDriverData> {
  const filter = `session_key=${sessionKey}&driver_number=${driverNumber}`;
  const [laps, stints, pits] = await Promise.allSettled([
    readEndpoint(`laps?${filter}`, refresh),
    readEndpoint(`stints?${filter}`, refresh),
    readEndpoint(`pit?${filter}`, refresh),
  ]);
  if (laps.status === 'rejected') {
    throw new Error(`Не удалось загрузить круги пилота №${driverNumber}. Повторите загрузку.`);
  }
  const warnings: string[] = [];
  if (stints.status === 'rejected') warnings.push(`№${driverNumber}: составы шин недоступны.`);
  if (pits.status === 'rejected')
    warnings.push(
      `№${driverNumber}: пит-лейн недоступен; круги заезда нельзя полностью исключить.`,
    );
  const replies = [
    laps.value,
    ...(stints.status === 'fulfilled' ? [stints.value] : []),
    ...(pits.status === 'fulfilled' ? [pits.value] : []),
  ];
  return {
    driverNumber,
    laps: laps.value.payload,
    stints: stints.status === 'fulfilled' ? stints.value.payload : [],
    pits: pits.status === 'fulfilled' ? pits.value.payload : [],
    stintsAvailable: stints.status === 'fulfilled',
    pitsAvailable: pits.status === 'fulfilled',
    warnings,
    fetchedAt: oldestFetchedAt(replies),
    stale: replies.some((reply) => reply.stale),
  };
}

/** Historical sessions only: OpenF1's free window begins 30 minutes after date_end. */
export function isRacePaceSessionAvailable(session: OpenF1Session, now = Date.now()): boolean {
  const end = session.date_end ? Date.parse(session.date_end) : NaN;
  return (
    integer(session.session_key) !== null &&
    Number.isFinite(end) &&
    end >= Date.UTC(2023, 0, 1) &&
    end + HISTORICAL_DELAY_MS <= now &&
    (session.year === undefined || session.year >= 2023)
  );
}

/** Six bounded endpoint queries at most; shared drivers/pending requests are reused. */
export async function loadRacePace(
  session: OpenF1Session,
  driverA: number,
  driverB: number,
  options: { refresh?: boolean; now?: number } = {},
): Promise<RacePaceData> {
  if (!isRacePaceSessionAvailable(session, options.now)) {
    throw new Error(
      'Сравнение доступно для завершённых сессий с 2023 года, спустя 30 минут после окончания.',
    );
  }
  if (integer(driverA, 99) === null || integer(driverB, 99) === null || driverA === driverB) {
    throw new Error('Выберите двух разных пилотов этой сессии.');
  }
  const [a, b] = await Promise.all([
    loadDriver(session.session_key, driverA, options.refresh === true),
    loadDriver(session.session_key, driverB, options.refresh === true),
  ]);
  return {
    sessionKey: session.session_key,
    driverA: a,
    driverB: b,
    fetchedAt: oldestFetchedAt([a, b]),
    stale: a.stale || b.stale,
    warnings: [...a.warnings, ...b.warnings],
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function driverLaps(
  data: RacePaceDriverData,
  sessionKey: number,
  excludePitLaps: boolean,
): Map<number, RacePaceLap> {
  const laps = scopedRows(data.laps, sessionKey, data.driverNumber);
  const pits = scopedRows(data.pits, sessionKey, data.driverNumber);
  const stints = scopedRows(data.stints, sessionKey, data.driverNumber);
  const result = new Map<number, RacePaceLap>();
  const grouped = new Map<number, Row[]>();
  for (const raw of laps) {
    const lapNumber = integer(raw.lap_number, MAX_LAP_NUMBER);
    if (lapNumber === null) continue;
    grouped.set(lapNumber, [...(grouped.get(lapNumber) ?? []), raw]);
  }
  for (const [lapNumber, records] of grouped) {
    // Exact repeats cannot count twice. Conflicting valid timings are unsafe:
    // leave a visible gap rather than arbitrarily selecting a faster lap.
    const timings = new Set(
      records
        .map((row) => positive(row.lap_duration))
        .filter((value): value is number => value !== null),
    );
    const durationSeconds = timings.size === 1 ? [...timings][0]! : null;
    const pit = pits.find((row) => integer(row.lap_number, MAX_LAP_NUMBER) === lapNumber);
    const stint = stints.find((row) => {
      const start = integer(row.lap_start, MAX_LAP_NUMBER);
      const end = integer(row.lap_end, MAX_LAP_NUMBER);
      return (
        start !== null && end !== null && start <= end && start <= lapNumber && lapNumber <= end
      );
    });
    const pitIn = !!pit;
    const pitOut = records.some((row) => row.is_pit_out_lap === true);
    const pitExcluded = excludePitLaps && (pitIn || pitOut);
    const next: RacePaceLap = {
      lapNumber,
      durationSeconds,
      paceSeconds: pitExcluded ? null : durationSeconds,
      compound:
        typeof stint?.compound === 'string' && stint.compound.trim()
          ? stint.compound.toUpperCase()
          : null,
      stintNumber: integer(stint?.stint_number),
      pitIn,
      pitOut,
      pitLaneSeconds: positive(pit?.lane_duration) ?? positive(pit?.pit_duration),
      pitStopSeconds: nonNegative(pit?.stop_duration),
      excludedReason: durationSeconds === null ? 'invalid-duration' : pitExcluded ? 'pit' : null,
    };
    result.set(lapNumber, next);
  }
  return result;
}

function missingLap(lapNumber: number): RacePaceLap {
  return {
    lapNumber,
    durationSeconds: null,
    paceSeconds: null,
    compound: null,
    stintNumber: null,
    pitIn: false,
    pitOut: false,
    pitLaneSeconds: null,
    pitStopSeconds: null,
    excludedReason: 'missing',
  };
}

function summary(driverNumber: number, laps: Map<number, RacePaceLap>): RacePaceSummary {
  const points = [...laps.values()];
  const included = points
    .map((lap) => lap.paceSeconds)
    .filter((value): value is number => value !== null);
  return {
    driverNumber,
    recordedLapCount: points.length,
    validLapCount: included.length,
    excludedPitLapCount: points.filter((lap) => lap.excludedReason === 'pit').length,
    meanSeconds: mean(included),
    medianSeconds: median(included),
    bestSeconds: included.length ? Math.min(...included) : null,
  };
}

/**
 * Means/medians describe measured lap times, not race gaps or driver ability.
 * Fuel, traffic, SC/VSC, weather, tyre age and deleted laps are not normalised.
 * Missing laps remain explicit null points: charts must use connectNulls=false.
 */
export function buildRacePaceComparison(
  data: RacePaceData,
  options: { excludePitLaps?: boolean } = {},
): RacePaceComparison {
  const excludePitLaps = options.excludePitLaps !== false;
  const a = driverLaps(data.driverA, data.sessionKey, excludePitLaps);
  const b = driverLaps(data.driverB, data.sessionKey, excludePitLaps);
  const lastLap = Math.max(0, ...a.keys(), ...b.keys());
  const rows = Array.from({ length: lastLap }, (_, index) => {
    const lapNumber = index + 1;
    const lapA = a.get(lapNumber) ?? missingLap(lapNumber);
    const lapB = b.get(lapNumber) ?? missingLap(lapNumber);
    return {
      lapNumber,
      a: lapA,
      b: lapB,
      deltaSeconds:
        lapA.paceSeconds !== null && lapB.paceSeconds !== null
          ? lapA.paceSeconds - lapB.paceSeconds
          : null,
    };
  });
  const paired = rows.filter((row) => row.deltaSeconds !== null);
  return {
    sessionKey: data.sessionKey,
    excludePitLaps,
    rows,
    a: summary(data.driverA.driverNumber, a),
    b: summary(data.driverB.driverNumber, b),
    paired: {
      lapCount: paired.length,
      meanASeconds: mean(paired.map((row) => row.a.paceSeconds!)),
      meanBSeconds: mean(paired.map((row) => row.b.paceSeconds!)),
      meanDeltaSeconds: mean(paired.map((row) => row.deltaSeconds!)),
      medianDeltaSeconds: median(paired.map((row) => row.deltaSeconds!)),
    },
    warnings: [...data.warnings],
  };
}
