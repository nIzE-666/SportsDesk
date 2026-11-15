import type { WatchIntent } from './watchIntent';
import { LEAGUES } from './navigationMetadata';
import { CUP_COMPETITIONS } from '../features/ucl/cupMetadata';

/**
 * Navigation model of the five-section shell (U2.1).
 *
 * Sections: «Сегодня», «Футбол», «Формула 1», «Смотреть», «Моё». A competition
 * is a parameter of «Футбол»: one of LEAGUES, the Champions League
 * (l_0bfbkO) or a cup from CUP_COMPETITIONS. The old ucl/cup route kinds are
 * migrated into that parameter and are not part of the new union.
 *
 * «Сегодня» has three modes. «Мой план» currently renders the old viewing
 * planner and will be merged into «Сегодня» in U2.3. Settings, the event center
 * and offline seasons stay separate routes until U2.7/U2.8/U2.11.
 */
export type Sport = 'football' | 'f1' | 'ucl' | 'cup';
export type Section = 'today' | 'football' | 'f1' | 'watch' | 'my';
export type CompetitionKind = 'league' | 'ucl' | 'cup';
export type TodayMode = 'today' | 'week' | 'plan';
/** The «Сейчас идут» tab became a filter of «Матчи» in U4.2. */
export type MatchesFilter = 'mine' | 'all' | 'live';
export type LeagueTab = 'matches' | 'standings' | 'team' | 'players';
export type ChampionsTab = 'overview' | 'table' | 'bracket' | 'matches' | 'stats';
export type CupTab = 'overview' | 'table' | 'bracket' | 'matches';
export type FootballTab = LeagueTab | ChampionsTab | CupTab;
export type F1Tab = 'overview' | 'calendar' | 'standings' | 'compare' | 'pace' | 'session';
export type MatchTab = 'overview' | 'lineups' | 'stats' | 'analysis';
export type MyTab = 'favorites' | 'diary' | 'games' | 'schemes';
export type SettingsCategory =
  | 'general'
  | 'favorites'
  | 'notifications'
  | 'appearance'
  | 'modules'
  | 'watch'
  | 'data'
  | 'sources'
  | 'about';

export type ShellRoute =
  | { kind: 'today'; mode?: TodayMode }
  | {
      kind: 'football';
      competitionId: string;
      tab?: FootballTab;
      teamId?: string;
      matchesFilter?: MatchesFilter;
    }
  | { kind: 'football-match'; matchId: string; competitionId: string }
  | { kind: 'f1'; tab?: F1Tab }
  | { kind: 'watch'; channelId?: number; intent?: WatchIntent }
  | { kind: 'my'; tab?: MyTab }
  | { kind: 'settings'; category?: SettingsCategory }
  | { kind: 'events' };

export type ContentRoute = Extract<
  ShellRoute,
  { kind: 'today' | 'football' | 'football-match' | 'f1' | 'watch' | 'my' }
>;
export type AuxiliaryRoute = Extract<ShellRoute, { kind: 'settings' | 'events' }>;

/** The remembered place and the legacy context of old saved values. */
export interface Location {
  section: Section;
  route: ShellRoute;
  sport: Sport;
  leagueId: string;
  cupId: string;
}

export const CHAMPIONS_LEAGUE_ID = 'l_0bfbkO';
export const DEFAULT_LEAGUE_ID: string = LEAGUES[0].id;
export const DEFAULT_CUP_ID = 'l_38d9HA';
export const START_SECTION: Section = 'today';

export const TODAY_MODES = ['today', 'week', 'plan'] as const;
export const LEAGUE_TABS = ['matches', 'standings', 'team', 'players'] as const;
export const MATCHES_FILTERS = ['mine', 'all', 'live'] as const;
/** The remembered «Матчи» filter; the same place for a search result or a migrated tab. */
export const MATCHES_FILTER_VIEW_KEY = 'football.matches.filter';
export const CHAMPIONS_TABS = ['overview', 'table', 'bracket', 'matches', 'stats'] as const;
export const CUP_TABS = ['overview', 'table', 'bracket', 'matches'] as const;
export const F1_TABS = ['overview', 'calendar', 'standings', 'compare', 'pace', 'session'] as const;
export const MATCH_TABS = ['overview', 'lineups', 'stats', 'analysis'] as const;
/** Tab ids of the old seven-tab match page; still read from saved screen state. */
export const LEGACY_MATCH_TABS = [
  'overview',
  'events',
  'lineups',
  'stats',
  'players',
  'analysis',
  'tactics',
] as const;
export const MY_TABS = ['favorites', 'diary', 'games', 'schemes'] as const;
export const SETTINGS_CATEGORIES = [
  'general',
  'favorites',
  'notifications',
  'appearance',
  'modules',
  'watch',
  'data',
  'sources',
  'about',
] as const;

const TABS_BY_COMPETITION: Record<CompetitionKind, readonly string[]> = {
  league: LEAGUE_TABS,
  ucl: CHAMPIONS_TABS,
  cup: CUP_TABS,
};
const SECTIONS: readonly string[] = ['today', 'football', 'f1', 'watch', 'my'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const includes = (values: readonly string[], value: unknown): value is string =>
  typeof value === 'string' && values.includes(value);

export function isSection(value: unknown): value is Section {
  return includes(SECTIONS, value);
}

/** Kind of a competition id; undefined means an unknown or malformed id. */
export function competitionKind(id: unknown): CompetitionKind | undefined {
  if (!isText(id)) return undefined;
  if (id === CHAMPIONS_LEAGUE_ID) return 'ucl';
  if (CUP_COMPETITIONS.some((competition) => competition.id === id)) return 'cup';
  if (LEAGUES.some((league) => league.id === id)) return 'league';
  return undefined;
}

export function isCompetitionId(id: unknown): id is string {
  return competitionKind(id) !== undefined;
}

export function isLeagueId(id: unknown): id is string {
  return competitionKind(id) === 'league';
}

export function isCupId(id: unknown): id is string {
  return competitionKind(id) === 'cup';
}

export function isLeagueTab(tab: unknown): tab is LeagueTab {
  return includes(LEAGUE_TABS, tab);
}

export function isMatchesFilter(value: unknown): value is MatchesFilter {
  return includes(MATCHES_FILTERS, value);
}

export function isF1Tab(tab: unknown): tab is F1Tab {
  return includes(F1_TABS, tab);
}

export function isChampionsTab(tab: unknown): tab is ChampionsTab {
  return includes(CHAMPIONS_TABS, tab);
}

export function isCupTab(tab: unknown): tab is CupTab {
  return includes(CUP_TABS, tab);
}

export function isMyTab(tab: unknown): tab is MyTab {
  return includes(MY_TABS, tab);
}

export function isMatchTab(tab: unknown): tab is MatchTab {
  return includes(MATCH_TABS, tab);
}

/**
 * Moves a saved or linked tab id of the old seven-tab match page to the new
 * four-tab page. The board is not a tab any more: «Составы» holds «На доску».
 */
export function migrateMatchTab(value: unknown): MatchTab | undefined {
  switch (value) {
    case 'overview':
    case 'events':
      return 'overview';
    case 'lineups':
    case 'players':
    case 'tactics':
      return 'lineups';
    case 'stats':
      return 'stats';
    case 'analysis':
      return 'analysis';
    default:
      return undefined;
  }
}

export function isValidSettingsCategory(value: unknown): value is SettingsCategory {
  return includes(SETTINGS_CATEGORIES, value);
}

export function isValidFootballTab(competitionId: string, tab: unknown): tab is FootballTab {
  const kind = competitionKind(competitionId);
  return kind !== undefined && includes(TABS_BY_COMPETITION[kind], tab);
}

export function defaultFootballTab(competitionId: string): FootballTab {
  return competitionKind(competitionId) === 'league' ? 'matches' : 'overview';
}

function isValidWatchIntent(value: unknown): value is WatchIntent {
  if (!isRecord(value)) return false;
  return (
    (value.sport === 'football' || value.sport === 'f1') && isText(value.title) && isText(value.key)
  );
}

/** Strict validation of the new model. Old shapes go through migrateRoute. */
export function isValidShellRoute(value: unknown): value is ShellRoute {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'today':
      return value.mode === undefined || includes(TODAY_MODES, value.mode);
    case 'football':
      return (
        isCompetitionId(value.competitionId) &&
        (value.tab === undefined || isValidFootballTab(value.competitionId, value.tab)) &&
        (value.teamId === undefined || isText(value.teamId)) &&
        (value.matchesFilter === undefined || isMatchesFilter(value.matchesFilter))
      );
    case 'football-match':
      return isText(value.matchId) && isCompetitionId(value.competitionId);
    case 'f1':
      return value.tab === undefined || isF1Tab(value.tab);
    case 'watch':
      return (
        (value.channelId === undefined ||
          (Number.isSafeInteger(value.channelId) && Number(value.channelId) > 0)) &&
        (value.intent === undefined || isValidWatchIntent(value.intent))
      );
    case 'my':
      return value.tab === undefined || isMyTab(value.tab);
    case 'settings':
      return value.category === undefined || isValidSettingsCategory(value.category);
    case 'events':
      return true;
    default:
      return false;
  }
}

export function isSectionRoute(route: ShellRoute): route is ContentRoute {
  return sectionOfRoute(route) !== undefined;
}

/** @deprecated Use isSectionRoute. Kept for callers outside the shell. */
export const isContentRoute = isSectionRoute;

export function sectionOfRoute(route: ShellRoute): Section | undefined {
  switch (route.kind) {
    case 'today':
      return 'today';
    case 'football':
    case 'football-match':
      return 'football';
    case 'f1':
      return 'f1';
    case 'watch':
      return 'watch';
    case 'my':
      return 'my';
    default:
      return undefined;
  }
}

/** The legacy sport of a route, kept for the saved `sportsdesk.sport` key. */
export function sportOfRoute(route: ShellRoute): Sport | undefined {
  if (route.kind === 'football') {
    const kind = competitionKind(route.competitionId);
    return kind === 'league'
      ? 'football'
      : kind === 'ucl'
        ? 'ucl'
        : kind === 'cup'
          ? 'cup'
          : undefined;
  }
  if (route.kind === 'football-match') return 'football';
  if (route.kind === 'f1') return 'f1';
  return undefined;
}

export function migrateSport(value: unknown): Sport {
  return value === 'f1' || value === 'ucl' || value === 'cup' ? value : 'football';
}

export function migrateLeagueId(value: unknown): string {
  return LEAGUES.some((league) => league.id === value) ? (value as string) : DEFAULT_LEAGUE_ID;
}

export function migrateCupId(value: unknown): string {
  return CUP_COMPETITIONS.some((competition) => competition.id === value)
    ? (value as string)
    : DEFAULT_CUP_ID;
}

/** Default route of a section. */
export function defaultRouteOf(
  section: Section,
  competitionId: string = DEFAULT_LEAGUE_ID,
): ShellRoute {
  if (section === 'today') return { kind: 'today', mode: 'today' };
  if (section === 'football') {
    const id = isCompetitionId(competitionId) ? competitionId : DEFAULT_LEAGUE_ID;
    return { kind: 'football', competitionId: id, tab: defaultFootballTab(id) };
  }
  if (section === 'f1') return { kind: 'f1', tab: 'overview' };
  if (section === 'watch') return { kind: 'watch' };
  return { kind: 'my', tab: 'favorites' };
}

/** Decision 3 of section 9: a new shell starts on «Сегодня». */
export function startRoute(): ShellRoute {
  return { kind: 'today', mode: 'today' };
}

export function startLocation(
  leagueId: unknown = DEFAULT_LEAGUE_ID,
  cupId: unknown = DEFAULT_CUP_ID,
  sport: unknown = 'football',
): Location {
  return {
    section: START_SECTION,
    route: startRoute(),
    sport: migrateSport(sport),
    leagueId: migrateLeagueId(leagueId),
    cupId: migrateCupId(cupId),
  };
}

export interface LegacyContext {
  sport?: unknown;
  leagueId?: unknown;
  cupId?: unknown;
}

/** Raw per-key values read from viewState; kept out of the hook for testing. */
export interface RememberedSources {
  /** navigation2.<key> */
  location?: unknown;
  /** navigation.<key> */
  route?: unknown;
  /** navigation.<key>.tab */
  tab?: unknown;
}

function fallbackForSection(
  section: Section,
  context: LegacyContext,
  fallback?: ShellRoute,
): ShellRoute {
  if (fallback) return fallback;
  const sport = migrateSport(context.sport);
  const cupId = migrateCupId(context.cupId);
  if (section === 'football' && sport === 'ucl')
    return defaultRouteOf(section, CHAMPIONS_LEAGUE_ID);
  if (section === 'football' && sport === 'cup') return defaultRouteOf(section, cupId);
  return defaultRouteOf(
    section,
    sport === 'ucl'
      ? CHAMPIONS_LEAGUE_ID
      : sport === 'cup'
        ? cupId
        : migrateLeagueId(context.leagueId),
  );
}

function tabRoute(section: Section, tab: unknown, context: LegacyContext): ShellRoute | undefined {
  if (section === 'f1') return isF1Tab(tab) ? { kind: 'f1', tab } : undefined;
  if (section !== 'football') return undefined;
  if (migrateSport(context.sport) === 'ucl' && isValidFootballTab(CHAMPIONS_LEAGUE_ID, tab))
    return { kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab };
  return undefined;
}

/** Pure, idempotent migration of one old ContentRoute/ShellRoute value. */
export function migrateRoute(value: unknown, context: LegacyContext = {}): ShellRoute | undefined {
  if (!isRecord(value)) return undefined;
  if (isValidShellRoute(value)) return value;

  const leagueId = migrateLeagueId(context.leagueId);
  const cupId = migrateCupId(context.cupId);
  const sport = migrateSport(context.sport);

  switch (value.kind) {
    case 'football': {
      // U4.2: the old «Сейчас идут» tab is now the live filter of «Матчи».
      if (value.tab === 'live' && isLeagueId(value.competitionId))
        return {
          kind: 'football',
          competitionId: value.competitionId,
          tab: 'matches',
          matchesFilter: 'live',
        };
      const section = value.section;
      if (section === 'live')
        return {
          kind: 'football',
          competitionId: leagueId,
          tab: 'matches',
          matchesFilter: 'live',
        };
      if (section === 'dashboard') return { kind: 'today', mode: 'today' };
      if (!isLeagueTab(section)) return undefined;
      const teamId = isText(value.teamId) ? value.teamId : undefined;
      return teamId
        ? { kind: 'football', competitionId: leagueId, tab: section, teamId }
        : { kind: 'football', competitionId: leagueId, tab: section };
    }
    case 'football-match':
      return isText(value.matchId)
        ? {
            kind: 'football-match',
            matchId: value.matchId,
            competitionId:
              sport === 'ucl' ? CHAMPIONS_LEAGUE_ID : sport === 'cup' ? cupId : leagueId,
          }
        : undefined;
    case 'f1': {
      const tab = value.tab === undefined ? 'overview' : value.tab;
      return isF1Tab(tab) ? { kind: 'f1', tab } : undefined;
    }
    case 'ucl': {
      const tab = value.tab === undefined ? 'overview' : value.tab;
      return isValidFootballTab(CHAMPIONS_LEAGUE_ID, tab)
        ? { kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab }
        : undefined;
    }
    case 'cup': {
      if (!isText(value.cupId)) return undefined;
      const competitionId = migrateCupId(value.cupId);
      const tab = value.tab === undefined ? 'overview' : value.tab;
      return isValidFootballTab(competitionId, tab)
        ? { kind: 'football', competitionId, tab }
        : undefined;
    }
    case 'watch': {
      const channelId =
        Number.isSafeInteger(value.channelId) && Number(value.channelId) > 0
          ? Number(value.channelId)
          : undefined;
      const intent = isValidWatchIntent(value.intent) ? value.intent : undefined;
      return channelId === undefined
        ? intent === undefined
          ? { kind: 'watch' }
          : { kind: 'watch', intent }
        : intent === undefined
          ? { kind: 'watch', channelId }
          : { kind: 'watch', channelId, intent };
    }
    case 'settings':
      return isValidSettingsCategory(value.category)
        ? { kind: 'settings', category: value.category }
        : { kind: 'settings' };
    case 'planner':
      return { kind: 'today', mode: 'plan' };
    case 'events':
      return { kind: 'events' };
    case 'games':
      return { kind: 'my', tab: 'games' };
    case 'diary':
      return { kind: 'my', tab: 'diary' };
    case 'offline':
      // Offline seasons live in «Настройки → Данные» since U2.8.
      return { kind: 'settings', category: 'data' };
    default:
      return undefined;
  }
}

export function locationForRoute(route: ShellRoute, context: LegacyContext = {}): Location {
  const sport = migrateSport(context.sport);
  const section =
    sectionOfRoute(route) ??
    (isSection(context.sport) ? context.sport : sport === 'f1' ? 'f1' : 'football');
  return {
    section,
    route,
    sport: sportOfRoute(route) ?? sport,
    leagueId: migrateLeagueId(context.leagueId),
    cupId: migrateCupId(context.cupId),
  };
}

/** Pure, idempotent migration of an old navigation2 value and of the new shape. */
export function migrateLocation(value: unknown, context: LegacyContext = {}): Location | undefined {
  if (!isRecord(value)) return undefined;
  const leagueId = migrateLeagueId(value.leagueId ?? context.leagueId);
  const cupId = migrateCupId(value.cupId ?? context.cupId);
  const sport = migrateSport(value.sport ?? context.sport);
  const route = migrateRoute(value.route, { ...context, sport, leagueId, cupId });
  if (!route) return undefined;
  return {
    section:
      sectionOfRoute(route) ??
      (isSection(value.section) ? value.section : sport === 'f1' ? 'f1' : 'football'),
    route,
    sport: sportOfRoute(route) ?? sport,
    leagueId,
    cupId,
  };
}

/**
 * Restores the remembered place of a section. Old `navigation2.*` keys are
 * migrated on read, so a restored 1.7.0/1.8.0 backup keeps opening the same
 * place; malformed values fall through to the next source and then to the
 * default route.
 */
export function rememberedLocation(
  section: Section,
  sources: RememberedSources,
  context: LegacyContext = {},
  fallback?: ShellRoute,
): Location {
  const fromLocation = migrateLocation(sources.location, context);
  if (fromLocation?.section === section) return fromLocation;

  const fromTab = tabRoute(section, sources.tab, context);
  if (fromTab) return locationForRoute(fromTab, context);

  const fromRoute = migrateRoute(sources.route, context);
  if (fromRoute && sectionOfRoute(fromRoute) === section)
    return locationForRoute(fromRoute, context);

  return locationForRoute(fallbackForSection(section, context, fallback), context);
}
