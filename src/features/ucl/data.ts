import { api } from '../../lib/bridge';
import type { MatchSummary, TeamRef } from '../football/types';

/**
 * Champions League data layer.
 * All seasons, match IDs, numbers and logos come from live providers only.
 * No demo data, no invented seasons or metric units.
 */

export const UCL_ID = 'l_0bfbkO';

const CATALOG_TTL_MS = 10 * 60 * 1000;
const PITCH = 'pitch' as const;
const SPORTSCORE = 'sportscore' as const;
const SPORTSCORE_UCL_SLUG = 'uefa-champions-league';

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
/** Only integers become numbers; negatives are preserved (goal difference can be negative). */
function asInt(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n === undefined || !Number.isInteger(n)) return null;
  return n;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Current UCL season label, July-June. E.g. 2026-09 -> '2026/2027',
 * 2026-03 -> '2025/2026'.
 */
export function currentUclSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based; July = 6
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

// -----
// League catalogue (memory-cached 10 minutes)
// -----

interface CatalogCache {
  expiresAt: number;
  seasons: string[];
}

let catalogCache: CatalogCache | null = null;
let catalogInFlight: Promise<string[]> | null = null;

function sortSeasonsDesc(seasons: string[]): string[] {
  const unique = Array.from(new Set(seasons.filter((s) => s.trim() !== '')));
  return unique.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
}

function extractSeasonsFromCatalog(payload: unknown): string[] {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : undefined;
  const leagues = data ? asArray(data.leagues) : [];
  const entry = leagues.filter(isRecord).find((league) => league.id === UCL_ID);
  if (!entry) return [];
  const seasons = asArray(entry.seasons)
    .map(asString)
    .filter((s): s is string => s !== undefined);
  return sortSeasonsDesc(seasons);
}

async function loadSeasons(): Promise<string[]> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.seasons;
  }
  if (catalogInFlight) return catalogInFlight;

  const request = (async () => {
    const reply = await api(PITCH, 'leagues');
    const seasons = extractSeasonsFromCatalog(reply.payload);
    if (seasons.length === 0) {
      throw new Error('Сезоны Лиги чемпионов недоступны.');
    }
    catalogCache = { expiresAt: reply.stale ? 0 : Date.now() + CATALOG_TTL_MS, seasons };
    return seasons;
  })();

  catalogInFlight = request;
  try {
    return await request;
  } finally {
    if (catalogInFlight === request) catalogInFlight = null;
  }
}

// -----
// Season matches
// -----

export type UclSeasonData = {
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

  const status = asString(raw.status) ?? 'unknown';
  const score_home = asInt(raw.score_home);
  const score_away = asInt(raw.score_away);

  const match: MatchSummary = {
    id,
    status,
    home_team,
    away_team,
    score_home,
    score_away,
  };

  const date = asString(raw.date);
  const statusText = asString(raw.status_text);
  const timeUtc = asString(raw.time_utc);
  const roundName = asString(raw.round_name);
  if (date) match.date = date;
  if (statusText) match.status_text = statusText;
  if (timeUtc) match.time_utc = timeUtc;
  if (roundName) match.round_name = roundName;

  return match;
}

export async function fetchUclSeason(season: string): Promise<UclSeasonData> {
  const requested = season.trim();
  if (!requested) {
    throw new Error('Сезон Лиги чемпионов не выбран.');
  }

  const seasons = await loadSeasons();
  if (!seasons.includes(requested)) {
    throw new Error(`Сезон ${requested} недоступен в источнике.`);
  }

  const path = `leagues/${UCL_ID}/matches?season=${encodeURIComponent(requested)}&status=all`;
  const reply = await api(PITCH, path);

  const payload = reply.payload;
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : undefined;
  if (!data) {
    throw new Error('Источник вернул неожиданный формат матчей Лиги чемпионов.');
  }

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

export type UclTableRow = {
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

function parseTableRow(raw: unknown): UclTableRow | undefined {
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

export async function fetchUclStandings(): Promise<{
  rows: UclTableRow[];
  fetchedAt: string;
  stale: boolean;
}> {
  const reply = await api(
    SPORTSCORE,
    `standings/?sport=football&slug=${encodeURIComponent(SPORTSCORE_UCL_SLUG)}`,
  );

  const payload = reply.payload;
  if (!isRecord(payload)) {
    throw new Error('Источник вернул неожиданный формат таблицы Лиги чемпионов.');
  }

  const tables = asArray(payload.tables).filter(isRecord);
  if (tables.length === 0) {
    throw new Error('Таблица Лиги чемпионов пока недоступна.');
  }

  const rows: UclTableRow[] = [];
  for (const table of tables) {
    for (const rawRow of asArray(table.rows)) {
      const row = parseTableRow(rawRow);
      if (row) rows.push(row);
    }
  }

  rows.sort((a, b) => a.position - b.position);

  return {
    rows,
    fetchedAt: reply.fetchedAt,
    stale: Boolean(reply.stale),
  };
}

// -----
// Top scorers (SportScore)
// -----

export type UclScorer = {
  rank: number;
  name: string;
  photo?: string;
  slug?: string;
  team: string;
  teamLogo?: string;
  goals: number | null;
  assists: number | null;
  matches: number | null;
  minutes: number | null;
};

function parseScorer(raw: unknown): UclScorer | undefined {
  if (!isRecord(raw)) return undefined;
  const name = asString(raw.player);
  const team = asString(raw.team);
  const rank = asInt(raw.rank);
  if (!name || !team || rank === null) return undefined;
  return {
    rank,
    name,
    photo: asString(raw.player_logo),
    slug: asString(raw.player_slug),
    team,
    teamLogo: asString(raw.team_logo),
    goals: asInt(raw.goals),
    assists: asInt(raw.assists),
    matches: asInt(raw.matches),
    minutes: asInt(raw.minutes),
  };
}

export async function fetchUclScorers(
  stat: 'goals' | 'assists' = 'goals',
): Promise<{ players: UclScorer[]; fetchedAt: string; stale: boolean }> {
  const path =
    `topscorers/?sport=football&slug=${encodeURIComponent(SPORTSCORE_UCL_SLUG)}` +
    `&limit=50&stat=${encodeURIComponent(stat)}`;
  const reply = await api(SPORTSCORE, path);

  const payload = reply.payload;
  if (!isRecord(payload)) {
    throw new Error('Источник вернул неожиданный формат бомбардиров Лиги чемпионов.');
  }

  const players = asArray(payload.scorers)
    .map(parseScorer)
    .filter((p): p is UclScorer => p !== undefined)
    .sort((a, b) => a.rank - b.rank);

  return {
    players,
    fetchedAt: reply.fetchedAt,
    stale: Boolean(reply.stale),
  };
}

// -----
// Player profile (SportScore, raw units preserved)
// -----

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

export async function fetchUclPlayer(slug: string): Promise<Record<string, unknown>> {
  const normalized = slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(normalized)) {
    throw new Error('Некорректный идентификатор игрока.');
  }

  const reply = await api(
    SPORTSCORE,
    `player/?sport=football&slug=${encodeURIComponent(normalized)}`,
  );

  if (!isRecord(reply.payload)) {
    throw new Error('Источник вернул неожиданный формат профиля игрока.');
  }
  return reply.payload;
}
