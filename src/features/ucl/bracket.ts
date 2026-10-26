import { api } from '../../lib/bridge';
import type { MatchSummary } from '../football/types';

export type UclKnockoutRound = 'playoff' | 'r16' | 'quarter' | 'semi' | 'third' | 'final';
export type BracketFormat = 'two-leg' | 'single-leg';

export interface BracketLeg {
  id: string;
  date?: string;
  homeId: string;
  awayId: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
}

export interface BracketTeam {
  id: string;
  name: string;
  image_url?: string | null;
}

export interface BracketTie {
  id: string;
  round: UclKnockoutRound;
  home: BracketTeam;
  away: BracketTeam;
  legs: BracketLeg[];
  aggregateHome: number | null;
  aggregateAway: number | null;
  winnerId: string | null;
  complete: boolean;
}

export interface BracketData {
  ties: BracketTie[];
  fetchedAt: string | null;
  stale: boolean;
  missingDetails: number;
}

const ROUND_ORDER: UclKnockoutRound[] = ['playoff', 'r16', 'quarter', 'semi', 'third', 'final'];
const EXPECTED_LEGS: Record<UclKnockoutRound, number> = {
  playoff: 2,
  r16: 2,
  quarter: 2,
  semi: 2,
  third: 1,
  final: 1,
};

const DETAIL_TTL_MS = 15 * 60 * 1000;
const CONCURRENCY = 3;
const MAX_CANDIDATES = 100;

const FINISHED_STATUSES = new Set([
  'finished',
  'ft',
  'full-time',
  'fulltime',
  'full time',
  'ended',
  'after extra time',
  'aet',
  'pen',
  'penalties',
  'after penalties',
]);

interface DetailCacheEntry {
  at: number;
  promise: Promise<DetailResult>;
}

interface DetailResult {
  fetchedAt: string | null;
  stale: boolean;
  leg: DetailLeg | null;
}

interface DetailLeg {
  id: string;
  round: UclKnockoutRound;
  date?: string;
  status: string;
  home: BracketTeam;
  away: BracketTeam;
  homeScore: number | null;
  awayScore: number | null;
}

const detailCache = new Map<string, DetailCacheEntry>();

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isFinishedStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  if (s === '') return false;
  if (FINISHED_STATUSES.has(s)) return true;
  return s.includes('finished') || s.includes('full-time') || s.includes('ended');
}

function scoreIfFinished(
  status: string,
  home: number | null,
  away: number | null,
): { h: number | null; a: number | null } {
  if (!isFinishedStatus(status)) return { h: null, a: null };
  if (home === null || away === null) return { h: null, a: null };
  return { h: home, a: away };
}

export function normalizeKnockoutRound(raw: string | undefined): UclKnockoutRound | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (t === '') return null;
  if (
    /^(third place|third-place|third place play-off|third place playoff|3rd place|3rd place play-off|3rd place playoff|bronze)$/.test(
      t,
    )
  )
    return 'third';
  if (/^\d+$/.test(t)) return null;

  if (
    t === '1/16' ||
    t === '1-16' ||
    t === '16' ||
    t === 'round of 32' ||
    t === 'r32' ||
    t === 'playoff' ||
    t === 'play-off' ||
    t === 'playoffs'
  ) {
    return 'playoff';
  }
  if (
    t === '1/8' ||
    t === '1-8' ||
    t === '8' ||
    t === 'round of 16' ||
    t === 'r16' ||
    t === 'last 16'
  ) {
    return 'r16';
  }
  if (
    t === '1/4' ||
    t === '1-4' ||
    t === '4' ||
    t === 'quarter' ||
    t === 'quarterfinal' ||
    t === 'quarterfinals' ||
    t === 'quarter-final' ||
    t === 'quarter-finals'
  ) {
    return 'quarter';
  }
  if (
    t === '1/2' ||
    t === '1-2' ||
    t === '2' ||
    t === 'semi' ||
    t === 'semifinal' ||
    t === 'semifinals' ||
    t === 'semi-final' ||
    t === 'semi-finals'
  ) {
    return 'semi';
  }
  if (t === 'final' || t === 'f') {
    return 'final';
  }

  // numeric league-phase rounds (1..8) and any other numeric label -> not knockout
  return null;
}

function teamFromRaw(raw: unknown, fallbackId: string): BracketTeam | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = str(r.id) ?? str(r.team_id) ?? str(r.slug) ?? fallbackId;
  const name = str(r.name) ?? str(r.title) ?? '';
  if (!id && !name) return null;
  const image = str(r.image_url) ?? str(r.logo) ?? str(r.image) ?? str(r.logo_url) ?? null;
  return { id: id || name, name: name || id, image_url: image };
}

function detailFromResponse(matchId: string, payload: unknown): DetailLeg | null {
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.data) ?? root;
  const matchRaw = asRecord(data.match) ?? data;
  if (!matchRaw) return null;

  const id = str(matchRaw.id) ?? matchId;
  const roundRaw = str(matchRaw.round_name) ?? str(matchRaw.round) ?? str(matchRaw.roundName);
  const round = normalizeKnockoutRound(roundRaw);
  if (!round) return null;

  const home = teamFromRaw(matchRaw.home_team ?? matchRaw.homeTeam ?? matchRaw.home, '');
  const away = teamFromRaw(matchRaw.away_team ?? matchRaw.awayTeam ?? matchRaw.away, '');
  if (!home || !away) return null;

  const status = (str(matchRaw.status) ?? '').toLowerCase();
  const rawHome = numOrNull(matchRaw.score_home ?? matchRaw.home_score);
  const rawAway = numOrNull(matchRaw.score_away ?? matchRaw.away_score);
  const scores = scoreIfFinished(status, rawHome, rawAway);

  const date = str(matchRaw.time_utc) ?? str(matchRaw.date) ?? undefined;

  return {
    id,
    round,
    date,
    status,
    home,
    away,
    homeScore: scores.h,
    awayScore: scores.a,
  };
}

async function fetchDetail(matchId: string): Promise<DetailResult> {
  const reply = await api('pitch', `matches/${encodeURIComponent(matchId)}`);
  const leg = detailFromResponse(matchId, reply.payload);
  return {
    fetchedAt: reply.fetchedAt ?? null,
    stale: Boolean(reply.stale),
    leg,
  };
}

function getDetail(matchId: string): Promise<DetailResult> {
  const now = Date.now();
  const cached = detailCache.get(matchId);
  if (cached && now - cached.at < DETAIL_TTL_MS) {
    return cached.promise;
  }
  const entry: DetailCacheEntry = {
    at: now,
    promise: fetchDetail(matchId).catch(() => ({ fetchedAt: null, stale: false, leg: null })),
  };
  detailCache.set(matchId, entry);
  return entry.promise;
}

function orientLeg(leg: DetailLeg, firstTeamId: string, secondTeamId: string): BracketLeg {
  const firstIsHome = leg.home.id === firstTeamId;
  const reverse = !firstIsHome;
  const homeId = reverse ? leg.away.id : leg.home.id;
  const awayId = reverse ? leg.home.id : leg.away.id;
  const homeScore = reverse ? leg.awayScore : leg.homeScore;
  const awayScore = reverse ? leg.homeScore : leg.awayScore;
  return {
    id: leg.id,
    date: leg.date,
    homeId,
    awayId,
    homeScore,
    awayScore,
    status: leg.status,
  };
}

function teamRefs(leg: DetailLeg): { first: BracketTeam; second: BracketTeam } {
  const homeFirst = leg.home.id <= leg.away.id;
  const first = homeFirst ? leg.home : leg.away;
  const second = homeFirst ? leg.away : leg.home;
  return { first, second };
}

export function groupBracket(details: unknown[], format: BracketFormat = 'two-leg'): BracketTie[] {
  interface Group {
    round: UclKnockoutRound;
    firstTeamId: string;
    secondTeamId: string;
    legs: DetailLeg[];
  }

  const groups = new Map<string, Group>();

  for (const raw of details) {
    const leg = parseDetailLeg(raw);
    if (!leg) continue;
    if (leg.home.id === leg.away.id) continue;
    const { first, second } = teamRefs(leg);
    const key = `${leg.round}::${first.id}::${second.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        round: leg.round,
        firstTeamId: first.id,
        secondTeamId: second.id,
        legs: [],
      };
      groups.set(key, g);
    }
    g.legs.push(leg);
  }

  const ties: BracketTie[] = [];

  for (const g of groups.values()) {
    if (g.legs.length === 0) continue;
    const expected = format === 'single-leg' ? 1 : EXPECTED_LEGS[g.round];
    const sortedLegs = [...g.legs].sort((a, b) => {
      const da = a.date ? Date.parse(a.date) : NaN;
      const db = b.date ? Date.parse(b.date) : NaN;
      if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
      if (Number.isFinite(da) && !Number.isFinite(db)) return -1;
      if (!Number.isFinite(da) && Number.isFinite(db)) return 1;
      return a.id.localeCompare(b.id);
    });

    const firstLeg = sortedLegs[0];
    if (!firstLeg) continue;
    const { first, second } = teamRefs(firstLeg);

    const legs: BracketLeg[] = sortedLegs.map((l) => orientLeg(l, g.firstTeamId, g.secondTeamId));

    const finishedLegs = legs.filter(
      (l) => isFinishedStatus(l.status) && l.homeScore !== null && l.awayScore !== null,
    );

    let aggregateHome: number | null = null;
    let aggregateAway: number | null = null;

    let ah = 0;
    let aa = 0;
    let ok = legs.length > 0;
    for (const l of legs) {
      if (!isFinishedStatus(l.status) || l.homeScore === null || l.awayScore === null) {
        ok = false;
        break;
      }
      ah += l.homeScore;
      aa += l.awayScore;
    }
    if (ok) {
      aggregateHome = ah;
      aggregateAway = aa;
    }

    const allExpectedFinished = finishedLegs.length === expected && legs.length === expected;
    const complete = allExpectedFinished;

    let winnerId: string | null = null;
    if (
      allExpectedFinished &&
      aggregateHome !== null &&
      aggregateAway !== null &&
      aggregateHome !== aggregateAway
    ) {
      winnerId = aggregateHome > aggregateAway ? first.id : second.id;
    }

    const id = buildTieId(g.round, g.firstTeamId, g.secondTeamId, legs);

    ties.push({
      id,
      round: g.round,
      home: first,
      away: second,
      legs,
      aggregateHome,
      aggregateAway,
      winnerId,
      complete,
    });
  }

  ties.sort((a, b) => {
    const ra = ROUND_ORDER.indexOf(a.round);
    const rb = ROUND_ORDER.indexOf(b.round);
    if (ra !== rb) return ra - rb;
    const da = firstLegDate(a);
    const db = firstLegDate(b);
    if (da !== null && db !== null && da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  return ties;
}

function firstLegDate(tie: BracketTie): number | null {
  const d = tie.legs[0]?.date;
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

function buildTieId(
  round: UclKnockoutRound,
  firstId: string,
  secondId: string,
  legs: BracketLeg[],
): string {
  if (legs.length === 0) return `${round}:${firstId}:${secondId}`;
  const sortedIds = legs.map((l) => l.id).sort();
  return `${round}:${sortedIds.join('|')}`;
}

function parseDetailLeg(raw: unknown): DetailLeg | null {
  const r = asRecord(raw);
  if (!r) return null;

  // Accept either a wrapped {data:{match}} style payload or an already-lightweight leg object.
  if (r.data || r.match) {
    const id = str(r.id) ?? '__x';
    const leg = detailFromResponse(id, raw);
    return leg;
  }

  const roundRaw = str(r.round_name) ?? str(r.round) ?? str(r.roundName);
  const round = normalizeKnockoutRound(roundRaw);
  if (!round) return null;

  const home = teamFromRaw(r.home_team ?? r.homeTeam ?? r.home, '');
  const away = teamFromRaw(r.away_team ?? r.awayTeam ?? r.away, '');
  if (!home || !away) return null;
  if (home.id === away.id) return null;

  const status = (str(r.status) ?? '').toLowerCase();
  const rawHome = numOrNull(r.homeScore ?? r.score_home ?? r.home_score);
  const rawAway = numOrNull(r.awayScore ?? r.score_away ?? r.away_score);
  const scores = scoreIfFinished(status, rawHome, rawAway);
  const date = str(r.time_utc) ?? str(r.date) ?? undefined;
  const id = str(r.id) ?? '';

  return {
    id: id || `${round}:${home.id}:${away.id}`,
    round,
    date,
    status,
    home,
    away,
    homeScore: scores.h,
    awayScore: scores.a,
  };
}

function seasonEndYear(season: string): number | null {
  const m = /^(\d{4})\s*[/\u002d]\s*(\d{4})$/.exec(season.trim());
  if (m && m[2]) return Number(m[2]);
  const single = /^(\d{4})$/.exec(season.trim());
  if (single && single[1]) return Number(single[1]);
  return null;
}

function isKoCandidate(match: MatchSummary, endYear: number, format: BracketFormat): boolean {
  const dateStr = match.date ?? match.time_utc;
  if (!dateStr) return false;
  const t = Date.parse(dateStr.length <= 10 ? `${dateStr}T00:00:00Z` : dateStr);
  if (!Number.isFinite(t)) return false;
  if (format === 'single-leg')
    return t >= Date.UTC(endYear, 0, 1) && t < Date.UTC(endYear + 1, 0, 1);
  const cutoff = Date.UTC(endYear, 0, 31, 23, 59, 59);
  return t > cutoff && t < Date.UTC(endYear, 6, 1);
}

function matchIdOf(match: MatchSummary): string | null {
  return typeof match.id === 'string' && match.id ? match.id : null;
}

export async function fetchUclBracket(
  matches: MatchSummary[],
  season: string,
  onProgress?: (done: number, total: number) => void,
): Promise<BracketData> {
  return fetchBracketFor(matches, season, onProgress);
}

/**
 * Generic knockout-bracket fetcher for any cup competition: takes the
 * competition's season matches and returns grouped two-legged ties.
 */
export async function fetchBracketFor(
  matches: MatchSummary[],
  season: string,
  onProgress?: (done: number, total: number) => void,
  format: BracketFormat = 'two-leg',
): Promise<BracketData> {
  const endYear = seasonEndYear(season);
  if (endYear === null) {
    return { ties: [], fetchedAt: null, stale: false, missingDetails: 0 };
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const ordered = [...(Array.isArray(matches) ? matches : [])];
  if (format === 'single-leg')
    ordered.sort((a, b) => (b.time_utc ?? b.date ?? '').localeCompare(a.time_utc ?? a.date ?? ''));
  for (const match of ordered) {
    const id = matchIdOf(match);
    if (!id || seen.has(id)) continue;
    if (!isKoCandidate(match, endYear, format)) continue;
    seen.add(id);
    candidates.push(id);
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  if (candidates.length === 0) {
    return { ties: [], fetchedAt: null, stale: false, missingDetails: 0 };
  }

  const total = candidates.length;
  let done = 0;
  if (onProgress) {
    try {
      onProgress(0, total);
    } catch {
      /* progress callbacks must not break fetching */
    }
  }

  const results: Array<DetailResult | null> = new Array<DetailResult | null>(total).fill(null);

  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      const id = candidates[index];
      if (!id) {
        results[index] = { fetchedAt: null, stale: false, leg: null };
        done += 1;
        continue;
      }
      let result: DetailResult;
      try {
        result = await getDetail(id);
      } catch {
        result = { fetchedAt: null, stale: false, leg: null };
      }
      results[index] = result;
      done += 1;
      if (onProgress) {
        try {
          onProgress(done, total);
        } catch {
          /* ignore */
        }
      }
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(CONCURRENCY, total);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const detailLegs: DetailLeg[] = [];
  let missingDetails = 0;
  let fetchedAt: string | null = null;
  let stale = false;

  for (const r of results) {
    if (!r) {
      missingDetails += 1;
      continue;
    }
    if (r.stale) stale = true;
    if (r.fetchedAt) {
      if (fetchedAt === null) {
        fetchedAt = r.fetchedAt;
      } else {
        const a = Date.parse(fetchedAt);
        const b = Date.parse(r.fetchedAt);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          if (b > a) fetchedAt = r.fetchedAt;
        } else if (r.fetchedAt > fetchedAt) {
          fetchedAt = r.fetchedAt;
        }
      }
    }
    if (!r.leg) {
      missingDetails += 1;
      continue;
    }
    detailLegs.push(r.leg);
  }

  let ties: BracketTie[] = [];
  try {
    ties = groupBracket(detailLegs, format);
  } catch {
    ties = [];
  }

  return {
    ties,
    fetchedAt,
    stale,
    missingDetails,
  };
}
