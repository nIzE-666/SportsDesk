import { api } from '../../lib/bridge';
import { classifyResult, parseRaceResults } from './parsing';
import type { JolpicaRaceResultRow } from './types';

export interface SeasonResults {
  races: JolpicaRaceResultRow[];
  fetchedAt: string;
  stale: boolean;
}

export interface ComparisonPoint {
  round: number;
  name: string;
  aPosition: number | null;
  bPosition: number | null;
  aPoints: number | null;
  bPoints: number | null;
}

export interface ComparisonTotals {
  starts: number;
  points: number;
  wins: number;
  podiums: number;
  dnf: number;
}

export interface SeasonComparison {
  series: ComparisonPoint[];
  a: ComparisonTotals;
  b: ComparisonTotals;
  headToHead: { a: number; b: number; compared: number };
}

const PAGE_LIMIT = 100;
const MAX_PAGES = 12;
const MIN_YEAR = 1950;

function currentYear(): number {
  return new Date().getFullYear();
}

function sanitizeMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 240);
  return cleaned || 'Неизвестная ошибка.';
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function toPoints(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const points = Number(value);
  return Number.isFinite(points) && points >= 0 ? points : null;
}

interface Page {
  rows: JolpicaRaceResultRow[];
  total: number;
  resultCount: number;
  fetchedAt: string;
  stale: boolean;
}

function paginationInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function fetchPage(year: number, offset: number): Promise<Page> {
  const reply = await api('jolpica', `${year}/results.json?limit=${PAGE_LIMIT}&offset=${offset}`);
  const mr = (reply.payload as { MRData?: Record<string, unknown> } | null)?.MRData;
  if (!mr || typeof mr !== 'object') {
    throw new Error('Источник вернул неполные данные.');
  }
  const total = paginationInt(mr.total);
  if (total === null) {
    throw new Error('Источник вернул неполные данные.');
  }
  if (paginationInt(mr.offset) !== offset || paginationInt(mr.limit) !== PAGE_LIMIT) {
    throw new Error('Источник вернул некорректные данные страницы.');
  }

  const table = mr.RaceTable;
  const rawRaces =
    table && typeof table === 'object' && !Array.isArray(table)
      ? (table as Record<string, unknown>).Races
      : null;
  if (!Array.isArray(rawRaces)) {
    throw new Error('Источник вернул неполные данные.');
  }
  const rawResultCounts = rawRaces.map((race) => {
    if (!race || typeof race !== 'object' || Array.isArray(race)) {
      throw new Error('Источник вернул некорректную гонку.');
    }
    const results = (race as Record<string, unknown>).Results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('Источник вернул некорректный список результатов гонки.');
    }
    return results.length;
  });
  const rows = parseRaceResults(reply.payload);
  if (
    rows.length !== rawRaces.length ||
    rows.some((row, index) => row.Results.length !== rawResultCounts[index])
  ) {
    throw new Error('Не удалось разобрать все результаты страницы.');
  }
  for (const row of rows) {
    const round = paginationInt(row.round);
    if (
      row.season !== String(year) ||
      round === null ||
      round === 0 ||
      !row.raceName ||
      !row.date
    ) {
      throw new Error('Источник вернул некорректные данные гонки.');
    }
  }
  const resultCount = rawResultCounts.reduce((sum, count) => sum + count, 0);
  const expected = Math.min(PAGE_LIMIT, Math.max(0, total - offset));
  if (resultCount !== expected) {
    throw new Error(
      `Источник вернул неполную или избыточную страницу (${resultCount} из ${expected}).`,
    );
  }
  return { rows, total, resultCount, fetchedAt: reply.fetchedAt, stale: reply.stale };
}

function mergeRaces(
  existing: JolpicaRaceResultRow[],
  incoming: JolpicaRaceResultRow[],
): JolpicaRaceResultRow[] {
  const byRound = new Map<number, JolpicaRaceResultRow>();
  for (const row of existing) {
    const round = toInt(row.round);
    if (round !== null) byRound.set(round, row);
  }
  for (const row of incoming) {
    const round = toInt(row.round);
    if (round === null) continue;
    const current = byRound.get(round);
    if (!current) {
      byRound.set(round, row);
      continue;
    }
    if (
      current.season !== row.season ||
      current.raceName !== row.raceName ||
      current.date !== row.date ||
      current.time !== row.time ||
      current.Circuit.circuitId !== row.Circuit.circuitId ||
      current.Circuit.circuitName !== row.Circuit.circuitName
    ) {
      throw new Error('Источник вернул противоречивые данные одного раунда.');
    }
    const drivers = new Map<string, (typeof row.Results)[number]>();
    for (const r of current.Results) drivers.set(r.Driver.driverId, r);
    for (const r of row.Results) {
      if (drivers.has(r.Driver.driverId)) {
        throw new Error('Источник вернул повторный результат пилота в одном раунде.');
      }
      drivers.set(r.Driver.driverId, r);
    }
    byRound.set(round, {
      ...current,
      ...row,
      Results: [...drivers.values()],
    });
  }
  return [...byRound.values()].sort((x, y) => (toInt(x.round) ?? 0) - (toInt(y.round) ?? 0));
}

export async function fetchSeasonResults(year: number): Promise<SeasonResults> {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > currentYear() + 1) {
    throw new Error(`Неподдерживаемый сезон ${year}. Допустимо: ${MIN_YEAR}–${currentYear() + 1}.`);
  }

  let races: JolpicaRaceResultRow[] = [];
  let fetchedAt = '';
  let stale = false;
  let total = -1;
  let offset = 0;
  let pages = 0;
  let resultCount = 0;

  try {
    while (offset < total || total < 0) {
      if (pages >= MAX_PAGES) {
        throw new Error(
          `Слишком много результатов (${total}); загрузка ограничена ${MAX_PAGES} страницами.`,
        );
      }
      const page = await fetchPage(year, offset);
      pages += 1;
      if (total === -1) total = page.total;
      else if (page.total !== total) {
        throw new Error('Источник вернул противоречивые данные между страницами.');
      }
      fetchedAt = page.fetchedAt;
      if (page.stale) stale = true;
      for (const race of page.rows) {
        const drivers = new Set(race.Results.map((result) => result.Driver.driverId));
        if (drivers.size !== race.Results.length) {
          throw new Error('Источник вернул повторный результат пилота в одном раунде.');
        }
      }
      races = mergeRaces(races, page.rows);
      resultCount += page.resultCount;
      offset += PAGE_LIMIT;
      if (total === 0) break;
    }

    if (total < 0) {
      throw new Error('Не удалось определить общее число результатов сезона.');
    }

    if (resultCount !== total) {
      throw new Error('Не получены все результаты сезона.');
    }

    return {
      races,
      fetchedAt: fetchedAt || new Date().toISOString(),
      stale,
    };
  } catch (err) {
    throw new Error(`Не удалось загрузить результаты сезона ${year}: ${sanitizeMessage(err)}`);
  }
}

export function buildSeasonComparison(
  races: JolpicaRaceResultRow[],
  a: string,
  b: string,
): SeasonComparison {
  const series: ComparisonPoint[] = [];
  const aTotals: ComparisonTotals = { starts: 0, points: 0, wins: 0, podiums: 0, dnf: 0 };
  const bTotals: ComparisonTotals = { starts: 0, points: 0, wins: 0, podiums: 0, dnf: 0 };
  let headA = 0;
  let headB = 0;
  let compared = 0;

  const ordered = [...races].sort((x, y) => (toInt(x.round) ?? 0) - (toInt(y.round) ?? 0));

  for (const race of ordered) {
    const round = toInt(race.round) ?? 0;
    const name = race.raceName || `Раунд ${round}`;
    const aEntry = race.Results.find((r) => r.Driver.driverId === a);
    const bEntry = race.Results.find((r) => r.Driver.driverId === b);

    const aClass = aEntry ? classifyResult(aEntry.status, aEntry.positionText) : 'unknown';
    const bClass = bEntry ? classifyResult(bEntry.status, bEntry.positionText) : 'unknown';

    const aPosRaw = aEntry ? toInt(aEntry.position) : null;
    const bPosRaw = bEntry ? toInt(bEntry.position) : null;
    const aPointsRaw = aEntry ? toPoints(aEntry.points) : null;
    const bPointsRaw = bEntry ? toPoints(bEntry.points) : null;

    const aPos = aClass === 'finished' ? aPosRaw : null;
    const bPos = bClass === 'finished' ? bPosRaw : null;
    const aPts = aPointsRaw !== null && aPointsRaw >= 0 ? aPointsRaw : null;
    const bPts = bPointsRaw !== null && bPointsRaw >= 0 ? bPointsRaw : null;

    series.push({
      round,
      name,
      aPosition: aPos,
      bPosition: bPos,
      aPoints: aPts,
      bPoints: bPts,
    });

    if (aEntry) updateTotals(aTotals, aClass, aPos, aPts);
    if (bEntry) updateTotals(bTotals, bClass, bPos, bPts);

    if (aPos !== null && bPos !== null) {
      compared += 1;
      if (aPos < bPos) headA += 1;
      else if (bPos < aPos) headB += 1;
    }
  }

  return {
    series,
    a: aTotals,
    b: bTotals,
    headToHead: { a: headA, b: headB, compared },
  };
}

function updateTotals(
  totals: ComparisonTotals,
  classification: string,
  position: number | null,
  points: number | null,
): void {
  if (classification !== 'dns') totals.starts += 1;
  if (points !== null) totals.points += points;
  if (classification === 'finished' && position !== null) {
    if (position === 1) totals.wins += 1;
    if (position >= 1 && position <= 3) totals.podiums += 1;
  } else if (classification === 'dnf') {
    totals.dnf += 1;
  }
}
