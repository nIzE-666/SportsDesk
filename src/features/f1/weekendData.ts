import { api } from '../../lib/bridge';
import { classifyResult, parseQualifying, parseRaceResults } from './parsing';
import type { SeasonComparison, SeasonResults } from './seasonData';
import { buildSeasonComparison, fetchSeasonResults } from './seasonData';
import type { JolpicaQualifyingEntry, JolpicaResultEntry } from './types';

// Sprint results share the Results shape, reusing the race result entry type.
export type JolpicaRaceResultRow = import('./types').JolpicaRaceResultRow;

export interface QualifyingRace {
  season: string;
  round: string;
  raceName: string;
  QualifyingResults: JolpicaQualifyingEntry[];
}

export interface WeekendSeason extends SeasonResults {
  sprints: JolpicaRaceResultRow[] | null;
  qualifying: QualifyingRace[] | null;
  issues: string[];
}

export interface WeekendTotals {
  starts: number;
  wins: number;
  podiums: number;
  dnf: number;
  racePoints: number;
  sprintPoints: number | null;
  points: number | null;
  sprintStarts: number;
  sprintWins: number;
}

export interface WeekendPoint {
  round: number;
  name: string;
  aPosition: number | null;
  bPosition: number | null;
  aRacePoints: number | null;
  bRacePoints: number | null;
  aSprintPoints: number | null;
  bSprintPoints: number | null;
  aPoints: number | null;
  bPoints: number | null;
  aQualifying: number | null;
  bQualifying: number | null;
}

export interface WeekendComparison {
  series: WeekendPoint[];
  a: WeekendTotals;
  b: WeekendTotals;
  headToHead: { a: number; b: number; compared: number };
  qualifyingHeadToHead: { a: number; b: number; compared: number };
}

const PAGE_LIMIT = 100;
const MAX_PAGES = 12;
const MIN_YEAR = 1950;

type SourceName = 'sprint' | 'qualifying';

interface Page {
  rows: JolpicaRaceResultRow[];
  qualy: QualifyingRace[];
  total: number;
  fetchedAt: string;
  stale: boolean;
}

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

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

async function fetchPage(year: number, source: SourceName, offset: number): Promise<Page> {
  const reply = await api('jolpica', `${year}/${source}.json?limit=${PAGE_LIMIT}&offset=${offset}`);
  const mr = obj(obj(reply.payload)?.MRData);
  if (!mr) {
    throw new Error('Источник вернул неполные данные.');
  }
  const total = toInt(mr.total);
  if (total === null || total < 0) {
    throw new Error('Источник вернул неполные данные.');
  }
  const table = obj(mr.RaceTable);
  if (!table || !Array.isArray(table.Races)) {
    throw new Error('Источник вернул неполные данные.');
  }

  let rows: JolpicaRaceResultRow[] = [];
  let qualy: QualifyingRace[] = [];
  if (source === 'sprint') {
    rows = parseRaceResults({
      MRData: { ...mr, RaceTable: { Races: sprintRacesOf(table.Races) } },
    });
  } else {
    qualy = parseQualifyingRaces(table.Races);
  }

  const rowCount =
    source === 'sprint'
      ? rows.reduce((sum, r) => sum + r.Results.length, 0)
      : qualy.reduce((sum, r) => sum + r.QualifyingResults.length, 0);

  return { rows, qualy, total, fetchedAt: reply.fetchedAt, stale: reply.stale };
}

// Sprint pages carry RaceTable.Races[].SprintResults, not Results.
function sprintRacesOf(races: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of races) {
    const r = obj(raw);
    if (!r) continue;
    out.push({ ...r, Results: r.SprintResults });
  }
  return out;
}

function parseQualifyingRaces(races: unknown[]): QualifyingRace[] {
  const out: QualifyingRace[] = [];
  for (const raw of races) {
    const r = obj(raw);
    if (!r) continue;
    const round = str(r.round);
    if (!round) continue;
    const entries = parseQualifying({ MRData: { RaceTable: { Races: [r] } } });
    for (const entry of entries) {
      normalizeQualifyingEntry(entry);
    }
    out.push({
      season: str(r.season) ?? '',
      round,
      raceName: str(r.raceName) ?? `Раунд ${round}`,
      QualifyingResults: entries,
    });
  }
  return out;
}

// Qualifying never earns points; drop any stray points field defensively.
function normalizeQualifyingEntry(entry: JolpicaQualifyingEntry): void {
  delete (entry as { points?: unknown }).points;
  const position = toInt(entry.position);
  if (position === null || position < 1) {
    delete (entry as { position?: unknown }).position;
  }
}

function mergeSprints(
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
    const drivers = new Map<string, JolpicaResultEntry>();
    for (const r of current.Results) drivers.set(r.Driver.driverId, r);
    for (const r of row.Results) drivers.set(r.Driver.driverId, r);
    byRound.set(round, { ...current, ...row, Results: [...drivers.values()] });
  }
  return [...byRound.values()].sort((x, y) => (toInt(x.round) ?? 0) - (toInt(y.round) ?? 0));
}

function mergeQualifying(existing: QualifyingRace[], incoming: QualifyingRace[]): QualifyingRace[] {
  const byRound = new Map<number, QualifyingRace>();
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
    const drivers = new Map<string, JolpicaQualifyingEntry>();
    for (const r of current.QualifyingResults) drivers.set(r.Driver.driverId, r);
    for (const r of row.QualifyingResults) drivers.set(r.Driver.driverId, r);
    byRound.set(round, { ...current, ...row, QualifyingResults: [...drivers.values()] });
  }
  return [...byRound.values()].sort((x, y) => (toInt(x.round) ?? 0) - (toInt(y.round) ?? 0));
}

interface SecondaryResult {
  fetchedAt: string;
  stale: boolean;
}

async function fetchSprintSeason(
  year: number,
): Promise<{ sprints: JolpicaRaceResultRow[] } & SecondaryResult> {
  let rows: JolpicaRaceResultRow[] = [];
  let total = -1;
  let offset = 0;
  let pages = 0;
  let fetchedAt = '';
  let stale = false;

  while (offset < total || total < 0) {
    if (pages >= MAX_PAGES) {
      throw new Error(`слишком много спринтов (${total})`);
    }
    const page = await fetchPage(year, 'sprint', offset);
    pages += 1;
    if (total === -1) total = page.total;
    else if (page.total !== total) {
      throw new Error('Источник вернул противоречивые данные между страницами');
    }
    fetchedAt = earliest(fetchedAt, page.fetchedAt);
    if (page.stale) stale = true;
    rows = mergeSprints(rows, page.rows);
    const prevOffset = offset;
    offset += PAGE_LIMIT;
    if (total === 0) break;
    if (countRows(page.rows) === 0 && prevOffset < total) {
      throw new Error('Источник вернул пустую страницу до завершения загрузки');
    }
  }

  if (total < 0) throw new Error('не удалось определить число результатов спринтов');
  const counted = countRows(rows);
  if (counted !== total) {
    throw new Error(`неполные результаты спринтов (${counted} из ${total})`);
  }

  return { sprints: rows, fetchedAt, stale };
}

function countRows(rows: JolpicaRaceResultRow[]): number {
  return rows.reduce((sum, r) => sum + r.Results.length, 0);
}

function countQualy(rows: QualifyingRace[]): number {
  return rows.reduce((sum, r) => sum + r.QualifyingResults.length, 0);
}

async function fetchQualifyingSeason(
  year: number,
): Promise<{ qualifying: QualifyingRace[] } & SecondaryResult> {
  let rows: QualifyingRace[] = [];
  let total = -1;
  let offset = 0;
  let pages = 0;
  let fetchedAt = '';
  let stale = false;

  while (offset < total || total < 0) {
    if (pages >= MAX_PAGES) {
      throw new Error(`слишком много квалификаций (${total})`);
    }
    const page = await fetchPage(year, 'qualifying', offset);
    pages += 1;
    if (total === -1) total = page.total;
    else if (page.total !== total) {
      throw new Error('Источник вернул противоречивые данные между страницами');
    }
    fetchedAt = earliest(fetchedAt, page.fetchedAt);
    if (page.stale) stale = true;
    rows = mergeQualifying(rows, page.qualy);
    const prevOffset = offset;
    offset += PAGE_LIMIT;
    if (total === 0) break;
    if (countQualy(page.qualy) === 0 && prevOffset < total) {
      throw new Error('Источник вернул пустую страницу до завершения загрузки');
    }
  }

  if (total < 0) throw new Error('не удалось определить число результатов квалификаций');
  const counted = countQualy(rows);
  if (counted !== total) {
    throw new Error(`неполные результаты квалификаций (${counted} из ${total})`);
  }

  return { qualifying: rows, fetchedAt, stale };
}

function earliest(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta <= tb ? a : b;
}

export async function fetchWeekendSeason(year: number): Promise<WeekendSeason> {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > currentYear() + 1) {
    throw new Error(`Неподдерживаемый сезон ${year}. Допустимо: ${MIN_YEAR}–${currentYear() + 1}.`);
  }

  const base = await fetchSeasonResults(year);

  const [sprintResult, qualyResult] = await Promise.allSettled([
    fetchSprintSeason(year),
    fetchQualifyingSeason(year),
  ] as const);

  const issues: string[] = [];
  let sprints: JolpicaRaceResultRow[] | null = null;
  let qualifying: QualifyingRace[] | null = null;
  let fetchedAt = base.fetchedAt;
  let stale = base.stale;

  if (sprintResult && sprintResult.status === 'fulfilled') {
    sprints = sprintResult.value.sprints;
    fetchedAt = earliest(fetchedAt, sprintResult.value.fetchedAt);
    if (sprintResult.value.stale) stale = true;
  } else {
    const reason = sprintResult ? sanitizeMessage(sprintResult.reason) : 'нет ответа';
    issues.push(`Спринты сезона ${year} недоступны: ${reason}`);
  }

  if (qualyResult && qualyResult.status === 'fulfilled') {
    qualifying = qualyResult.value.qualifying;
    fetchedAt = earliest(fetchedAt, qualyResult.value.fetchedAt);
    if (qualyResult.value.stale) stale = true;
  } else {
    const reason = qualyResult ? sanitizeMessage(qualyResult.reason) : 'нет ответа';
    issues.push(`Квалификации сезона ${year} недоступны: ${reason}`);
  }

  return {
    races: base.races,
    fetchedAt: fetchedAt || base.fetchedAt,
    stale,
    sprints,
    qualifying,
    issues,
  };
}

interface SessionRow {
  position: number | null;
  points: number | null;
  classification: string;
}

function findEntry(
  session: JolpicaRaceResultRow | undefined,
  driverId: string,
): JolpicaResultEntry | null {
  if (!session) return null;
  return session.Results.find((r) => r.Driver.driverId === driverId) ?? null;
}

function sessionRow(
  session: JolpicaRaceResultRow | undefined,
  driverId: string,
): SessionRow | null {
  const entry = findEntry(session, driverId);
  if (!entry) return null;
  const classification = classifyResult(entry.status, entry.positionText);
  const position = toInt(entry.position);
  return {
    position: classification === 'finished' && position !== null && position > 0 ? position : null,
    points: toPoints(entry.points),
    classification,
  };
}

function qualyPosition(race: QualifyingRace | undefined, driverId: string): number | null {
  if (!race) return null;
  const entry = race.QualifyingResults.find((r) => r.Driver.driverId === driverId);
  if (!entry) return null;
  const position = toInt(entry.position);
  return position !== null && position > 0 ? position : null;
}

function emptyTotals(): WeekendTotals {
  return {
    starts: 0,
    wins: 0,
    podiums: 0,
    dnf: 0,
    racePoints: 0,
    sprintPoints: null,
    points: null,
    sprintStarts: 0,
    sprintWins: 0,
  };
}

function addRace(totals: WeekendTotals, row: SessionRow | null): void {
  if (!row) return;
  if (row.classification !== 'dns') totals.starts += 1;
  if (row.points !== null) totals.racePoints += row.points;
  if (row.classification === 'finished' && row.position !== null) {
    if (row.position === 1) totals.wins += 1;
    if (row.position >= 1 && row.position <= 3) totals.podiums += 1;
  } else if (row.classification === 'dnf') {
    totals.dnf += 1;
  }
}

function addSprint(totals: WeekendTotals, row: SessionRow | null): void {
  totals.sprintPoints = (totals.sprintPoints ?? 0) + (row?.points ?? 0);
  if (row && row.classification !== 'dns') {
    totals.sprintStarts += 1;
    if (row.classification === 'finished' && row.position === 1) totals.sprintWins += 1;
  }
}

function roundKey(round: string): number {
  return toInt(round) ?? 0;
}

export function buildWeekendComparison(
  data: WeekendSeason,
  a: string,
  b: string,
  round: string = 'season',
): WeekendComparison {
  const races = [...data.races].sort((x, y) => roundKey(x.round) - roundKey(y.round));
  const sprints = data.sprints
    ? [...data.sprints].sort((x, y) => roundKey(x.round) - roundKey(y.round))
    : null;
  const qualifying = data.qualifying
    ? [...data.qualifying].sort((x, y) => roundKey(x.round) - roundKey(y.round))
    : null;

  const raceByRound = new Map<string, JolpicaRaceResultRow>();
  for (const race of races) {
    const key = String(roundKey(race.round));
    if (!raceByRound.has(key)) raceByRound.set(key, race);
  }
  const sprintByRound = new Map<string, JolpicaRaceResultRow>();
  for (const sprint of sprints ?? []) {
    const key = String(roundKey(sprint.round));
    if (!sprintByRound.has(key)) sprintByRound.set(key, sprint);
  }
  const qualyByRound = new Map<string, QualifyingRace>();
  for (const q of qualifying ?? []) {
    const key = String(roundKey(q.round));
    if (!qualyByRound.has(key)) qualyByRound.set(key, q);
  }

  const isSeason = round === 'season' || round === '';
  const targetKey = isSeason ? null : String(roundKey(round));
  const roundSet = new Set<number>();
  const pushRounds = (list: Array<{ round: string }> | undefined | null) => {
    for (const item of list ?? []) roundSet.add(roundKey(item.round));
  };
  pushRounds(races);
  pushRounds(sprints);
  pushRounds(qualifying);

  const filteredRounds = [...roundSet]
    .filter((r) => descriptionRoundMatches(r, targetKey))
    .sort((x, y) => x - y);

  const names = new Map<number, string>();
  for (const race of races) names.set(roundKey(race.round), race.raceName);
  for (const sprint of sprints ?? []) {
    if (!names.has(roundKey(sprint.round))) names.set(roundKey(sprint.round), sprint.raceName);
  }
  for (const q of qualifying ?? []) {
    if (!names.has(roundKey(q.round))) names.set(roundKey(q.round), q.raceName);
  }

  // Base race totals from the shared race-only comparison for consistency.
  const baseRace = buildSeasonComparison(races, a, b);

  const aTotals = emptyTotals();
  const bTotals = emptyTotals();
  const series: WeekendPoint[] = [];
  let headA = 0;
  let headB = 0;
  let headCompared = 0;
  let qA = 0;
  let qB = 0;
  let qCompared = 0;

  const sprintAvailable = sprints !== null;
  const qualyAvailable = qualifying !== null;

  for (const r of filteredRounds) {
    const key = String(r);
    const race = raceByRound.get(key);
    const sprint = sprintByRound.get(key);
    const qualy = qualyByRound.get(key);

    const aRace = sessionRow(race, a);
    const bRace = sessionRow(race, b);
    const aSpr = sessionRow(sprint, a);
    const bSpr = sessionRow(sprint, b);
    const aQual = qualyPosition(qualy, a);
    const bQual = qualyPosition(qualy, b);

    // Full-weekend per-driver session accounting (starts/DNF/wins) for visible rows.
    addRace(aTotals, aRace);
    addRace(bTotals, bRace);
    if (sprintAvailable) {
      addSprint(aTotals, aSpr);
      addSprint(bTotals, bSpr);
    }

    // Race points always valid; sprint/total points follow sprint source availability.
    const aRacePoints = aRace && race ? aRace.points : null;
    const bRacePoints = bRace && race ? bRace.points : null;
    const aSprintPoints = sprintAvailable ? (aSpr && sprint ? aSpr.points : null) : null;
    const bSprintPoints = sprintAvailable ? (bSpr && sprint ? bSpr.points : null) : null;
    const aPoints =
      sprintAvailable && (aRace || aSpr) ? (aRacePoints ?? 0) + (aSprintPoints ?? 0) : null;
    const bPoints =
      sprintAvailable && (bRace || bSpr) ? (bRacePoints ?? 0) + (bSprintPoints ?? 0) : null;

    series.push({
      round: r,
      name: names.get(r) ?? `Раунд ${r}`,
      aPosition: aRace ? aRace.position : null,
      bPosition: bRace ? bRace.position : null,
      aRacePoints,
      bRacePoints,
      aSprintPoints,
      bSprintPoints,
      aPoints,
      bPoints,
      aQualifying: qualyAvailable ? aQual : null,
      bQualifying: qualyAvailable ? bQual : null,
    });

    // Head-to-head only for finished main races; sprint-only rounds contribute nothing here.
    if (aRace && bRace && aRace.position !== null && bRace.position !== null) {
      headCompared += 1;
      if (aRace.position < bRace.position) headA += 1;
      else if (bRace.position < aRace.position) headB += 1;
    }

    if (qualyAvailable && aQual !== null && bQual !== null) {
      qCompared += 1;
      if (aQual < bQual) qA += 1;
      else if (bQual < aQual) qB += 1;
    }
  }

  // Season race aggregates come from the shared race comparison over ALL main races.
  if (isSeason) {
    aTotals.starts = baseRace.a.starts;
    aTotals.wins = baseRace.a.wins;
    aTotals.podiums = baseRace.a.podiums;
    aTotals.dnf = baseRace.a.dnf;
    aTotals.racePoints = baseRace.a.points;
    bTotals.starts = baseRace.b.starts;
    bTotals.wins = baseRace.b.wins;
    bTotals.podiums = baseRace.b.podiums;
    bTotals.dnf = baseRace.b.dnf;
    bTotals.racePoints = baseRace.b.points;
    headA = baseRace.headToHead.a;
    headB = baseRace.headToHead.b;
    headCompared = baseRace.headToHead.compared;
  }

  if (sprintAvailable) {
    aTotals.sprintPoints ??= 0;
    bTotals.sprintPoints ??= 0;
  }
  aTotals.points = sprintAvailable ? aTotals.racePoints + (aTotals.sprintPoints ?? 0) : null;
  bTotals.points = sprintAvailable ? bTotals.racePoints + (bTotals.sprintPoints ?? 0) : null;

  if (!sprintAvailable) {
    aTotals.sprintPoints = null;
    bTotals.sprintPoints = null;
    aTotals.sprintStarts = 0;
    bTotals.sprintStarts = 0;
    aTotals.sprintWins = 0;
    bTotals.sprintWins = 0;
  }

  return {
    series,
    a: aTotals,
    b: bTotals,
    headToHead: { a: headA, b: headB, compared: headCompared },
    qualifyingHeadToHead: qualyAvailable
      ? { a: qA, b: qB, compared: qCompared }
      : { a: 0, b: 0, compared: 0 },
  };
}

function descriptionRoundMatches(round: number, target: string | null): boolean {
  if (target === null) return true;
  return String(round) === target;
}

// Convenience re-export for callers that still need the race-only comparison type.
export type { SeasonComparison };
