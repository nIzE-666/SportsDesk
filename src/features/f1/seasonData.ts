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
  fetchedAt: string;
  stale: boolean;
}

async function fetchPage(year: number, offset: number): Promise<Page> {
  const reply = await api('jolpica', `${year}/results.json?limit=${PAGE_LIMIT}&offset=${offset}`);
  const mr = (reply.payload as { MRData?: Record<string, unknown> } | null)?.MRData;
  if (!mr || typeof mr !== 'object') {
    throw new Error('В ответе Jolpica отсутствует MRData.');
  }
  const total = toInt(mr.total);
  if (total === null || total < 0) {
    throw new Error('В ответе Jolpica отсутствует корректный total.');
  }
  const rows = parseRaceResults(reply.payload);
  return { rows, total, fetchedAt: reply.fetchedAt, stale: reply.stale };
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
    const drivers = new Map<string, (typeof row.Results)[number]>();
    for (const r of current.Results) drivers.set(r.Driver.driverId, r);
    for (const r of row.Results) drivers.set(r.Driver.driverId, r);
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
        throw new Error('Jolpica вернул противоречивый total между страницами.');
      }
      fetchedAt = page.fetchedAt;
      if (page.stale) stale = true;
      races = mergeRaces(races, page.rows);
      const prevOffset = offset;
      offset += PAGE_LIMIT;
      if (total === 0) break;
      if (page.rows.length === 0 && prevOffset < total) {
        throw new Error('Jolpica вернул пустую страницу до завершения загрузки.');
      }
    }

    if (total < 0) {
      throw new Error('Не удалось определить общее число результатов сезона.');
    }

    const expectedRounds = Math.min(total, Number.MAX_SAFE_INTEGER);
    if (races.length === 0 && expectedRounds > 0) {
      throw new Error('Не получено ни одного результата сезона.');
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
