import { api } from '../../lib/bridge';
import type { MatchSummary, TeamRef } from '../football/types';

/**
 * Generic cup-competition data layer, parameterized by PitchAPI league id.
 * Built on the Champions League implementation; all seasons, match IDs,
 * numbers and logos come from live providers only — no demo data.
 */

const CATALOG_TTL_MS = 10 * 60 * 1000;
const PITCH = 'pitch' as const;
const SPORTSCORE = 'sportscore' as const;

/** Supported cup competitions (PitchAPI id + SportScore slug where available). */
export interface CupCompetition {
  id: string;
  /** UI title. */
  title: string;
  /** Hero eyebrow. */
  eyebrow: string;
  /** SportScore standings slug (current season only); undefined = no table. */
  sportscoreSlug?: string;
  /** Theme accent used by the app-root data-theme. */
  theme: string;
  bracketFormat?: 'two-leg' | 'single-leg';
}

export const CUP_COMPETITIONS: CupCompetition[] = [
  {
    id: 'l_0bfbkO',
    title: 'Лига чемпионов',
    eyebrow: 'CHAMPIONS LEAGUE / EUROPE',
    sportscoreSlug: 'uefa-champions-league',
    theme: 'ucl',
  },
  {
    id: 'l_38d9HA',
    title: 'Лига Европы',
    eyebrow: 'EUROPA LEAGUE / EUROPE',
    sportscoreSlug: 'uefa-europa-league',
    theme: 'ucl',
  },
  {
    id: 'l_2WZ2tt',
    title: 'Лига конференций',
    eyebrow: 'CONFERENCE LEAGUE / EUROPE',
    sportscoreSlug: 'uefa-europa-conference-league',
    theme: 'ucl',
  },
  {
    id: 'l_1XLtP0',
    title: 'Чемпионат мира',
    eyebrow: 'WORLD CUP / INTERNATIONAL',
    theme: 'ucl',
    bracketFormat: 'single-leg',
  },
];

export function findCup(id: string): CupCompetition | undefined {
  return CUP_COMPETITIONS.find((c) => c.id === id);
}

// -----
// Helpers
// -----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asInt(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n === undefined || !Number.isInteger(n)) return null;
  return n;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Current cross-year season label (July-June). Single-year tournaments
 * (World Cup) use their own year from the catalogue seasons list.
 */
export function currentCrossSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

// -----
// League catalogue (memory-cached 10 minutes)
// -----

interface CatalogCache {
  expiresAt: number;
  /** seasons by league id */
  seasonsByLeague: Map<string, string[]>;
}

let catalogCache: CatalogCache | null = null;
let catalogInFlight: Promise<Map<string, string[]>> | null = null;

function sortSeasonsDesc(seasons: string[]): string[] {
  const unique = Array.from(new Set(seasons.filter((s) => s.trim() !== '')));
  return unique.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
}

async function loadCatalog(): Promise<Map<string, string[]>> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.seasonsByLeague;
  }
  if (catalogInFlight) return catalogInFlight;

  const request = (async () => {
    const reply = await api(PITCH, 'leagues');
    const data =
      isRecord(reply.payload) && isRecord(reply.payload.data) ? reply.payload.data : undefined;
    const leagues = data ? asArray(data.leagues) : [];
    const map = new Map<string, string[]>();
    for (const raw of leagues) {
      if (!isRecord(raw)) continue;
      const id = asString(raw.id);
      if (!id) continue;
      const seasons = asArray(raw.seasons)
        .map(asString)
        .filter((s): s is string => s !== undefined);
      map.set(id, sortSeasonsDesc(seasons));
    }
    catalogCache = {
      expiresAt: reply.stale ? 0 : Date.now() + CATALOG_TTL_MS,
      seasonsByLeague: map,
    };
    return map;
  })();

  catalogInFlight = request;
  try {
    return await request;
  } finally {
    if (catalogInFlight === request) catalogInFlight = null;
  }
}

export async function cupSeasons(leagueId: string): Promise<string[]> {
  const map = await loadCatalog();
  return map.get(leagueId) ?? [];
}

/** Picks the catalogue season closest to today (cross-year or single-year). */
export async function currentSeasonFor(leagueId: string): Promise<string | undefined> {
  const seasons = await cupSeasons(leagueId);
  if (seasons.length === 0) return undefined;
  const cross = currentCrossSeason();
  if (seasons.includes(cross)) return cross;
  return seasons[0];
}

// -----
// Season matches
// -----

export type CupSeasonData = {
  matches: MatchSummary[];
  seasons: string[];
  fetchedAt: string;
  stale: boolean;
  season: string;
};

function parseTeamRef(raw: unknown): TeamRef | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw.id);
  const name = asString(raw.name);
  if (!id || !name) return undefined;
  const team: TeamRef = { id, name };
  const image = asString(raw.image_url);
  if (image) team.image_url = image;
  return team;
}

function parseMatch(raw: unknown): MatchSummary | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw.id);
  if (!id) return undefined;

  const home_team = parseTeamRef(raw.home_team);
  const away_team = parseTeamRef(raw.away_team);
  if (!home_team || !away_team) return undefined;

  const match: MatchSummary = {
    id,
    status: asString(raw.status) ?? 'unknown',
    home_team,
    away_team,
    score_home: asInt(raw.score_home),
    score_away: asInt(raw.score_away),
  };

  const date = asString(raw.date);
  const timeUtc = asString(raw.time_utc);
  const roundName = asString(raw.round_name);
  if (date) match.date = date;
  if (timeUtc) match.time_utc = timeUtc;
  if (roundName) match.round_name = roundName;

  return match;
}

export async function fetchCupSeason(leagueId: string, season: string): Promise<CupSeasonData> {
  const requested = season.trim();
  if (!requested) throw new Error('Сезон не выбран.');

  const seasons = await cupSeasons(leagueId);
  if (seasons.length > 0 && !seasons.includes(requested)) {
    throw new Error(`Сезон ${requested} недоступен в PitchAPI.`);
  }

  const path = `leagues/${leagueId}/matches?season=${encodeURIComponent(requested)}&status=all`;
  const reply = await api(PITCH, path);

  const payload = reply.payload;
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : undefined;
  if (!data) throw new Error('PitchAPI вернул неожиданный формат матчей.');

  const matches = asArray(data.matches)
    .map(parseMatch)
    .filter((m): m is MatchSummary => m !== undefined)
    .sort((a, b) => (a.time_utc ?? a.date ?? '').localeCompare(b.time_utc ?? b.date ?? ''));

  return {
    matches,
    seasons,
    fetchedAt: reply.fetchedAt,
    stale: Boolean(reply.stale),
    season: requested,
  };
}

// -----
// Standings (SportScore, current season only)
// -----

export type CupTableRow = {
  position: number;
  team: string;
  logo?: string;
  slug?: string;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  gf: number | null;
  ga: number | null;
  gd: number | null;
  points: number | null;
};

function parseTableRow(raw: unknown): CupTableRow | undefined {
  if (!isRecord(raw)) return undefined;
  const team = asString(raw.team);
  const position = asInt(raw.pos);
  if (!team || position === null) return undefined;
  return {
    position,
    team,
    logo: asString(raw.team_logo),
    slug: asString(raw.team_slug),
    played: asInt(raw.p),
    wins: asInt(raw.w),
    draws: asInt(raw.d),
    losses: asInt(raw.l),
    gf: asInt(raw.gf),
    ga: asInt(raw.ga),
    gd: asInt(raw.gd),
    points: asInt(raw.pts),
  };
}

export async function fetchCupStandings(slug: string): Promise<{
  rows: CupTableRow[];
  fetchedAt: string;
  stale: boolean;
}> {
  const reply = await api(SPORTSCORE, `standings/?sport=football&slug=${encodeURIComponent(slug)}`);

  const payload = reply.payload;
  if (!isRecord(payload)) throw new Error('SportScore вернул неожиданный формат таблицы.');

  const tables = asArray(payload.tables).filter(isRecord);
  if (tables.length === 0) throw new Error('Таблица пока недоступна на SportScore.');

  const rows: CupTableRow[] = [];
  for (const table of tables) {
    for (const rawRow of asArray(table.rows)) {
      const row = parseTableRow(rawRow);
      if (row) rows.push(row);
    }
  }

  rows.sort((a, b) => a.position - b.position);
  return { rows, fetchedAt: reply.fetchedAt, stale: Boolean(reply.stale) };
}
