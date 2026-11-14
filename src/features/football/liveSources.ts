import { clubKey } from './clubNames';

/**
 * Adapter for the two free unofficial live sources. It turns their scoreboard JSON into one
 * shape; fetching and polling stay outside this module.
 */

export type LiveSource = 'livescore' | 'espn';
export type LiveState = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' | 'unknown';

export interface LiveMatch {
  /** `${source}:${the source's own match id}`. */
  id: string;
  source: LiveSource;
  /** The app's league id when the match belongs to one of the ten followed competitions. */
  leagueId: string | null;
  /** The source's competition name. Empty when the source did not name it. */
  competition: string;
  home: { name: string; clubKey: string };
  away: { name: string; clubKey: string };
  /** ISO 8601 in UTC; null when the source did not give a readable time. */
  kickoffUtc: string | null;
  state: LiveState;
  /** The source's own minute label while the match is live, otherwise null. */
  minute: string | null;
  score: { home: number | null; away: number | null };
}

/** The ten followed competitions: six leagues plus four cups. */
const ESPN_LEAGUES = new Map<string, string>([
  ['eng.1', 'l_4WFCIZ'],
  ['esp.1', 'l_0ErfuF'],
  ['ita.1', 'l_0ALvwF'],
  ['ger.1', 'l_1Isor4'],
  ['fra.1', 'l_3FJFUl'],
  ['usa.1', 'l_0eg6C9'],
  ['uefa.champions', 'l_0bfbkO'],
  ['uefa.europa', 'l_38d9HA'],
  ['uefa.europa.conf', 'l_2WZ2tt'],
  ['fifa.world', 'l_1XLtP0'],
]);

/** ESPN league slug for an app league id, or null when the app does not follow it. */
export function espnSlugForLeague(leagueId: string): string | null {
  for (const [slug, id] of ESPN_LEAGUES) if (id === leagueId) return slug;
  return null;
}

/**
 * LiveScore names the competition group (country, or "UEFA") and the competition separately.
 * Both are required: "Premier League" alone also names competitions in other countries. Keys are
 * `<group>|<competition>`, lowercased, exactly as the captured responses write them. The group
 * comes from `CompD`; the UCL stages write "Champions League" in `Cnm` and "UEFA" in `CompD`.
 */
const LIVESCORE_LEAGUES = new Map<string, string>([
  ['england|premier league', 'l_4WFCIZ'],
  ['spain|laliga', 'l_0ErfuF'],
  ['italy|serie a', 'l_0ALvwF'],
  ['germany|bundesliga', 'l_1Isor4'],
  ['france|ligue 1', 'l_3FJFUl'],
  ['usa|mls', 'l_0eg6C9'],
  ['uefa|champions league', 'l_0bfbkO'],
  ['uefa|europa league', 'l_38d9HA'],
  ['uefa|conference league', 'l_2WZ2tt'],
]);

/**
 * No World Cup response was captured, so LiveScore's country label for it is unverified.
 * The exact competition name alone is the narrowest mapping that still keeps it followed.
 */
const LIVESCORE_WORLD_CUP = 'world cup';
const WORLD_CUP_LEAGUE_ID = 'l_1XLtP0';

/**
 * Time base of LiveScore's `Esd`.
 *
 * The same match appears in both date responses captured on 2026-11-15: Brighton-Brentford
 * (`Eid` 1793599) has `Esd` 20261108140000 in .../date/soccer/20261108/0 and 20261108230000 in
 * .../date/soccer/20261108/9. ESPN's UTC `date` for that match is 2026-11-08T14:00Z. 14:00 at
 * offset 0 and 23:00 at offset 9 are the same instant, and both equal ESPN's 14:00Z; the other
 * shared matches behave the same way (Cologne-Bayer 14:30 / 23:30, Napoli-Lazio 11:30 / 20:30).
 * Therefore `Esd` is local wall-clock time in the UTC offset requested in the URL, not UTC. To
 * get UTC, subtract `utcOffsetHours`.
 *
 * The live response has the same base: its URL ends in /9, so `Esd` 20261115000000 means
 * 00:00 on 15 November at UTC+9, i.e. 2026-11-14T15:00Z.
 */
const HOUR_MS = 3_600_000;
const ESD = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** "67'", "45+2'" and ESPN's "90'+6'" — the forms the sources use for a running clock. */
const MINUTE = /^\d{1,3}(?:'\+\d{1,2}|\+\d{1,2}|)'$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' ? undefined : text;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalized(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function asScore(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** Scores only mean something once the match is under way; pre-match "0" is not a score. */
function scoreFor(state: LiveState, value: unknown): number | null {
  return state === 'live' || state === 'finished' ? asScore(value) : null;
}

function liveScoreKickoff(value: unknown, utcOffsetHours: number): string | null {
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  const match = ESD.exec(text);
  if (!match || !Number.isFinite(utcOffsetHours)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(local);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  )
    return null;
  return new Date(local - utcOffsetHours * HOUR_MS).toISOString();
}

function parseUtcInstant(value: unknown): string | null {
  const text = asString(value);
  if (!text || !ISO_UTC.test(text)) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function liveScoreState(value: string): LiveState {
  if (value === 'NS') return 'scheduled';
  if (value === 'FT' || value === 'AET' || value === 'AP') return 'finished';
  if (value === 'HT' || MINUTE.test(value)) return 'live';
  return 'unknown';
}

function espnState(type: Record<string, unknown> | undefined): LiveState {
  const name = (asString(type?.name) ?? '').toUpperCase();
  switch (name) {
    case 'STATUS_SCHEDULED':
      return 'scheduled';
    case 'STATUS_FIRST_HALF':
    case 'STATUS_HALFTIME':
    case 'STATUS_SECOND_HALF':
      return 'live';
    case 'STATUS_FULL_TIME':
      return 'finished';
    case 'STATUS_POSTPONED':
      return 'postponed';
    case 'STATUS_CANCELED':
    case 'STATUS_CANCELLED':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function liveScoreTeam(value: unknown): string | undefined {
  for (const entry of asArray(value)) {
    if (!isRecord(entry)) continue;
    const name = asString(entry.Nm);
    if (name) return name;
  }
  return undefined;
}

function liveScoreLeagueId(stage: Record<string, unknown>): string | null {
  const competition = normalized(asString(stage.CompN));
  if (competition === LIVESCORE_WORLD_CUP) return WORLD_CUP_LEAGUE_ID;
  const key = `${normalized(asString(stage.CompD))}|${competition}`;
  return LIVESCORE_LEAGUES.get(key) ?? null;
}

/** One league per ESPN request is the documented use; without a single league we cannot tell. */
function espnLeague(value: unknown): { slug: string; name: string } | null {
  const leagues = asArray(value);
  if (leagues.length !== 1) return null;
  const league = leagues[0];
  if (!isRecord(league)) return null;
  return {
    slug: normalized(asString(league.slug)),
    name: asString(league.name) ?? '',
  };
}

function espnCompetitor(
  competition: Record<string, unknown>,
  homeAway: 'home' | 'away',
): Record<string, unknown> | undefined {
  for (const entry of asArray(competition.competitors)) {
    if (isRecord(entry) && entry.homeAway === homeAway) return entry;
  }
  return undefined;
}

function espnTeamName(competitor: Record<string, unknown> | undefined): string | undefined {
  const team = competitor?.team;
  if (!isRecord(team)) return undefined;
  return asString(team.displayName) ?? asString(team.shortDisplayName);
}

function espnMinute(
  status: Record<string, unknown>,
  type: Record<string, unknown> | undefined,
): string | null {
  if ((asString(type?.name) ?? '').toUpperCase() === 'STATUS_HALFTIME') return 'HT';
  for (const candidate of [asString(type?.shortDetail), asString(status.displayClock)]) {
    if (candidate === 'HT' || (candidate !== undefined && MINUTE.test(candidate))) return candidate;
  }
  return null;
}

function parseLiveScoreEvent(
  raw: unknown,
  competition: string,
  leagueId: string | null,
  utcOffsetHours: number,
): LiveMatch | undefined {
  if (!isRecord(raw)) return undefined;
  const sourceId = asString(raw.Eid);
  const home = liveScoreTeam(raw.T1);
  const away = liveScoreTeam(raw.T2);
  if (!sourceId || !home || !away) return undefined;

  const label = asString(raw.Eps) ?? '';
  const state = liveScoreState(label);
  return {
    id: `livescore:${sourceId}`,
    source: 'livescore',
    leagueId,
    competition,
    home: { name: home, clubKey: clubKey(home) },
    away: { name: away, clubKey: clubKey(away) },
    kickoffUtc: liveScoreKickoff(raw.Esd, utcOffsetHours),
    state,
    minute: state === 'live' ? label : null,
    score: { home: scoreFor(state, raw.Tr1), away: scoreFor(state, raw.Tr2) },
  };
}

export function parseLiveScore(json: unknown, utcOffsetHours: number): LiveMatch[] {
  if (!isRecord(json)) return [];
  const matches: LiveMatch[] = [];
  for (const stage of asArray(json.Stages)) {
    if (!isRecord(stage)) continue;
    const competition = asString(stage.CompN) ?? asString(stage.Snm) ?? '';
    const leagueId = liveScoreLeagueId(stage);
    for (const raw of asArray(stage.Events)) {
      const match = parseLiveScoreEvent(raw, competition, leagueId, utcOffsetHours);
      if (match) matches.push(match);
    }
  }
  return matches;
}

function parseEspnEvent(
  raw: unknown,
  league: { slug: string; name: string } | null,
): LiveMatch | undefined {
  if (!isRecord(raw)) return undefined;
  const sourceId = asString(raw.id);
  const competition = asArray(raw.competitions).find(isRecord);
  if (!sourceId || !competition) return undefined;
  const homeCompetitor = espnCompetitor(competition, 'home');
  const awayCompetitor = espnCompetitor(competition, 'away');
  const home = espnTeamName(homeCompetitor);
  const away = espnTeamName(awayCompetitor);
  if (!home || !away) return undefined;

  const status = isRecord(raw.status)
    ? raw.status
    : isRecord(competition.status)
      ? competition.status
      : undefined;
  const type = isRecord(status?.type) ? status.type : undefined;
  const state = espnState(type);
  return {
    id: `espn:${sourceId}`,
    source: 'espn',
    leagueId: league ? (ESPN_LEAGUES.get(league.slug) ?? null) : null,
    competition: league?.name ?? '',
    home: { name: home, clubKey: clubKey(home) },
    away: { name: away, clubKey: clubKey(away) },
    kickoffUtc: parseUtcInstant(asString(raw.date) ?? competition.date),
    state,
    minute: state === 'live' && status ? espnMinute(status, type) : null,
    score: {
      home: scoreFor(state, homeCompetitor?.score),
      away: scoreFor(state, awayCompetitor?.score),
    },
  };
}

export function parseEspnScoreboard(json: unknown): LiveMatch[] {
  if (!isRecord(json)) return [];
  const league = espnLeague(json.leagues);
  const matches: LiveMatch[] = [];
  for (const raw of asArray(json.events)) {
    const match = parseEspnEvent(raw, league);
    if (match) matches.push(match);
  }
  return matches;
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function zonedDay(formatter: Intl.DateTimeFormat, date: Date): string | null {
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/**
 * Keeps matches whose kickoff falls in [00:00, 24:00) of `isoDate` in `timeZone`. The calendar
 * day is read from `Intl`, so DST changes and offsets are handled by the platform. Matches
 * without a readable kickoff are not on any day and are dropped. An invalid date or zone gives
 * an empty list rather than an exception.
 */
export function onLocalDay(matches: LiveMatch[], isoDate: string, timeZone: string): LiveMatch[] {
  if (!Array.isArray(matches) || !isIsoDate(isoDate)) return [];
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return [];
  }
  return matches.filter((match) => {
    if (!match || typeof match.kickoffUtc !== 'string') return false;
    const date = new Date(match.kickoffUtc);
    if (Number.isNaN(date.getTime())) return false;
    return zonedDay(formatter, date) === isoDate;
  });
}
