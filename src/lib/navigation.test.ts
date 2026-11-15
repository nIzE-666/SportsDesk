// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { LEAGUES } from './navigationMetadata';
import {
  CHAMPIONS_LEAGUE_ID,
  CUP_TABS,
  DEFAULT_CUP_ID,
  DEFAULT_LEAGUE_ID,
  F1_TABS,
  LEAGUE_TABS,
  LEGACY_MATCH_TABS,
  MATCH_TABS,
  MY_TABS,
  SETTINGS_CATEGORIES,
  START_SECTION,
  competitionKind,
  defaultFootballTab,
  defaultRouteOf,
  isMatchTab,
  isSectionRoute,
  isValidFootballTab,
  isValidShellRoute,
  locationForRoute,
  migrateCupId,
  migrateLeagueId,
  migrateLocation,
  migrateMatchTab,
  migrateRoute,
  migrateSport,
  rememberedLocation,
  sectionOfRoute,
  startLocation,
  startRoute,
  type ShellRoute,
} from './navigation';
import {
  readSearchIndex,
  readSearchRecent,
  rememberSearchItems,
  rememberSearchVisit,
} from './searchIndex';

beforeEach(() => localStorage.clear());

const validRoutes: ShellRoute[] = [
  { kind: 'today' },
  { kind: 'today', mode: 'today' },
  { kind: 'today', mode: 'week' },
  { kind: 'today', mode: 'plan' },
  { kind: 'football', competitionId: LEAGUES[0].id, tab: 'matches' },
  { kind: 'football', competitionId: LEAGUES[0].id, tab: 'matches', matchesFilter: 'live' },
  { kind: 'football', competitionId: LEAGUES[0].id, tab: 'team', teamId: 'arsenal' },
  { kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'bracket' },
  { kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'table' },
  { kind: 'football-match', matchId: 'match-1', competitionId: LEAGUES[0].id },
  { kind: 'f1' },
  { kind: 'f1', tab: 'compare' },
  { kind: 'watch' },
  {
    kind: 'watch',
    channelId: 3,
    intent: { sport: 'football', title: 'Arsenal — Chelsea', key: 'match-1' },
  },
  { kind: 'my' },
  { kind: 'my', tab: 'games' },
  { kind: 'settings' },
  { kind: 'settings', category: 'data' },
  { kind: 'events' },
];

it('validates every route kind and keeps tabs tied to the competition kind', () => {
  for (const route of validRoutes)
    expect(isValidShellRoute(route), JSON.stringify(route)).toBe(true);

  expect(competitionKind(LEAGUES[0].id)).toBe('league');
  expect(competitionKind(CHAMPIONS_LEAGUE_ID)).toBe('ucl');
  expect(competitionKind(DEFAULT_CUP_ID)).toBe('cup');
  expect(competitionKind('unknown')).toBeUndefined();

  for (const tab of LEAGUE_TABS) expect(isValidFootballTab(LEAGUES[0].id, tab)).toBe(true);
  for (const tab of CUP_TABS) expect(isValidFootballTab(DEFAULT_CUP_ID, tab)).toBe(true);
  for (const tab of CUP_TABS.filter((tab) => !(LEAGUE_TABS as readonly string[]).includes(tab)))
    expect(isValidFootballTab(LEAGUES[0].id, tab)).toBe(false);
  for (const tab of F1_TABS.filter((tab) => !['overview', 'standings', 'matches'].includes(tab)))
    expect(isValidFootballTab(CHAMPIONS_LEAGUE_ID, tab)).toBe(false);
  expect(isValidFootballTab(CHAMPIONS_LEAGUE_ID, 'overview')).toBe(false);
  expect(isValidFootballTab(CHAMPIONS_LEAGUE_ID, 'stats')).toBe(false);
  expect(isValidFootballTab(DEFAULT_CUP_ID, 'overview')).toBe(false);
  expect(isValidFootballTab('l_1XLtP0', 'table')).toBe(false);
  expect(isValidFootballTab('l_1XLtP0', 'matches')).toBe(true);
  expect(defaultFootballTab(CHAMPIONS_LEAGUE_ID)).toBe('matches');
  expect(defaultFootballTab(DEFAULT_CUP_ID)).toBe('matches');

  const invalid: unknown[] = [
    null,
    [],
    'today',
    {},
    { kind: 'unknown' },
    { kind: 'today', mode: 'later' },
    { kind: 'football' },
    { kind: 'football', competitionId: 'unknown', tab: 'matches' },
    { kind: 'football', competitionId: LEAGUES[0].id, tab: 'overview' },
    { kind: 'football', competitionId: LEAGUES[0].id, tab: 'matches', matchesFilter: 'later' },
    {
      kind: 'football',
      competitionId: LEAGUES[0].id,
      tab: 'standings',
      matchesFilter: 'mine',
    },
    {
      kind: 'football',
      competitionId: CHAMPIONS_LEAGUE_ID,
      tab: 'matches',
      matchesFilter: 'mine',
    },
    { kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'matches', matchesFilter: 'mine' },
    { kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'live' },
    { kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'stats' },
    { kind: 'football-match', matchId: '', competitionId: LEAGUES[0].id },
    { kind: 'football-match', matchId: 'match-1', competitionId: 'unknown' },
    { kind: 'f1', tab: 'analysis' },
    { kind: 'watch', channelId: 0 },
    { kind: 'watch', channelId: 1.5 },
    { kind: 'watch', intent: { sport: 'f1', title: '', key: 'x' } },
    { kind: 'my', tab: 'overview' },
    { kind: 'settings', category: 'unknown' },
  ];
  for (const route of invalid) {
    expect(isValidShellRoute(route), JSON.stringify(route)).toBe(false);
  }
  for (const category of SETTINGS_CATEGORIES)
    expect(isValidShellRoute({ kind: 'settings', category })).toBe(true);
  for (const tab of MY_TABS) expect(isValidShellRoute({ kind: 'my', tab })).toBe(true);
});

it('migrates every old route shape to the new union idempotently', () => {
  expect(migrateRoute({ kind: 'football', section: 'dashboard' })).toEqual({
    kind: 'today',
    mode: 'today',
  });
  expect(migrateRoute({ kind: 'football', section: 'matches' })).toEqual({
    kind: 'football',
    competitionId: DEFAULT_LEAGUE_ID,
    tab: 'matches',
  });
  expect(migrateRoute({ kind: 'football', section: 'live' })).toEqual({
    kind: 'football',
    competitionId: DEFAULT_LEAGUE_ID,
    tab: 'matches',
    matchesFilter: 'live',
  });
  expect(migrateRoute({ kind: 'football', competitionId: LEAGUES[2].id, tab: 'live' })).toEqual({
    kind: 'football',
    competitionId: LEAGUES[2].id,
    tab: 'matches',
    matchesFilter: 'live',
  });
  // The lead's merge keeps a filter of a current-shape route only for a league on «Матчи».
  expect(
    migrateRoute({
      kind: 'football',
      competitionId: LEAGUES[0].id,
      tab: 'overview',
      matchesFilter: 'mine',
    }),
  ).toEqual({
    kind: 'football',
    competitionId: LEAGUES[0].id,
    tab: 'matches',
    matchesFilter: 'mine',
  });
  expect(
    migrateRoute({
      kind: 'football',
      competitionId: LEAGUES[0].id,
      tab: 'matches',
      matchesFilter: 'mine',
    }),
  ).toEqual({
    kind: 'football',
    competitionId: LEAGUES[0].id,
    tab: 'matches',
    matchesFilter: 'mine',
  });
  expect(
    migrateRoute({
      kind: 'football',
      competitionId: CHAMPIONS_LEAGUE_ID,
      tab: 'matches',
      matchesFilter: 'mine',
    }),
  ).toEqual({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'matches' });
  expect(
    migrateRoute({
      kind: 'football',
      competitionId: DEFAULT_CUP_ID,
      tab: 'matches',
      matchesFilter: 'mine',
    }),
  ).toEqual({ kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'matches' });
  expect(migrateRoute({ kind: 'football', section: 'team', teamId: 'arsenal' })).toEqual({
    kind: 'football',
    competitionId: DEFAULT_LEAGUE_ID,
    tab: 'team',
    teamId: 'arsenal',
  });
  expect(
    migrateRoute({ kind: 'football-match', matchId: 'match-1' }, { leagueId: LEAGUES[1].id }),
  ).toEqual({ kind: 'football-match', matchId: 'match-1', competitionId: LEAGUES[1].id });
  expect(migrateRoute({ kind: 'f1' })).toEqual({ kind: 'f1' });
  expect(migrateRoute({ kind: 'f1', tab: 'pace' })).toEqual({ kind: 'f1', tab: 'pace' });
  expect(migrateRoute({ kind: 'ucl' })).toEqual({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'matches',
  });
  expect(migrateRoute({ kind: 'ucl', tab: 'bracket' })).toEqual({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'bracket',
  });
  expect(migrateRoute({ kind: 'ucl', tab: 'overview' })).toEqual({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'matches',
  });
  expect(migrateRoute({ kind: 'ucl', tab: 'stats' })).toEqual({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'players',
  });
  expect(
    migrateRoute({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'overview' }),
  ).toEqual({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'matches' });
  expect(
    migrateRoute({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'stats' }),
  ).toEqual({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'players' });
  expect(migrateRoute({ kind: 'cup', cupId: DEFAULT_CUP_ID })).toEqual({
    kind: 'football',
    competitionId: DEFAULT_CUP_ID,
    tab: 'matches',
  });
  expect(
    migrateRoute({ kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'overview' }),
  ).toEqual({ kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'matches' });
  expect(migrateRoute({ kind: 'football', competitionId: 'l_1XLtP0', tab: 'table' })).toEqual({
    kind: 'football',
    competitionId: 'l_1XLtP0',
    tab: 'matches',
  });
  expect(migrateRoute({ kind: 'cup', cupId: 'unknown-cup', tab: 'table' })).toEqual({
    kind: 'football',
    competitionId: DEFAULT_CUP_ID,
    tab: 'table',
  });
  expect(migrateRoute({ kind: 'watch', channelId: 4 })).toEqual({ kind: 'watch', channelId: 4 });
  expect(migrateRoute({ kind: 'watch', channelId: 'bad' })).toEqual({ kind: 'watch' });
  expect(migrateRoute({ kind: 'settings' })).toEqual({ kind: 'settings' });
  expect(migrateRoute({ kind: 'planner' })).toEqual({ kind: 'today', mode: 'plan' });
  expect(migrateRoute({ kind: 'events' })).toEqual({ kind: 'events' });
  expect(migrateRoute({ kind: 'games' })).toEqual({ kind: 'my', tab: 'games' });
  expect(migrateRoute({ kind: 'diary' })).toEqual({ kind: 'my', tab: 'diary' });
  expect(migrateRoute({ kind: 'offline' })).toEqual({ kind: 'settings', category: 'data' });

  const old = [
    { kind: 'football', section: 'dashboard' },
    { kind: 'football', section: 'players' },
    { kind: 'football', section: 'live' },
    { kind: 'football', competitionId: LEAGUES[0].id, tab: 'live' },
    { kind: 'football-match', matchId: 'match-1' },
    { kind: 'f1', tab: 'session' },
    { kind: 'ucl', tab: 'stats' },
    { kind: 'cup', cupId: DEFAULT_CUP_ID, tab: 'bracket' },
    { kind: 'watch' },
    { kind: 'planner' },
    { kind: 'games' },
    { kind: 'diary' },
    { kind: 'offline' },
  ];
  for (const route of old) {
    const migrated = migrateRoute(route)!;
    expect(migrateRoute(migrated)).toEqual(migrated);
  }
});

it('falls back silently for malformed routes, sports and ids', () => {
  for (const value of [
    null,
    'x',
    [],
    {},
    { kind: 'unknown' },
    { kind: 'football', section: 'unknown' },
    { kind: 'ucl', tab: 'live' },
    { kind: 'cup', cupId: '', tab: 'overview' },
    { kind: 'football-match', matchId: 3 },
  ])
    expect(migrateRoute(value)).toBeUndefined();

  expect(migrateSport('f1')).toBe('f1');
  expect(migrateSport('ucl')).toBe('ucl');
  expect(migrateSport('cup')).toBe('cup');
  expect(migrateSport('unknown')).toBe('football');
  expect(migrateLeagueId(LEAGUES[2].id)).toBe(LEAGUES[2].id);
  expect(migrateLeagueId('unknown')).toBe(DEFAULT_LEAGUE_ID);
  expect(migrateCupId(CHAMPIONS_LEAGUE_ID)).toBe(CHAMPIONS_LEAGUE_ID);
  expect(migrateCupId('unknown')).toBe(DEFAULT_CUP_ID);
});

it('migrates an old saved location and keeps its competition context', () => {
  const ucl = migrateLocation({
    sport: 'ucl',
    leagueId: LEAGUES[0].id,
    cupId: DEFAULT_CUP_ID,
    route: { kind: 'ucl', tab: 'bracket' },
  })!;
  expect(ucl).toMatchObject({
    section: 'football',
    sport: 'ucl',
    route: { kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'bracket' },
  });
  expect(migrateLocation(ucl)).toEqual(ucl);

  const f1 = migrateLocation({
    sport: 'f1',
    leagueId: LEAGUES[0].id,
    cupId: DEFAULT_CUP_ID,
    route: { kind: 'f1', tab: 'calendar' },
  })!;
  expect(f1.section).toBe('f1');
  expect(f1.sport).toBe('f1');
  expect(migrateLocation(f1)).toEqual(f1);

  const match = migrateLocation({
    sport: 'football',
    leagueId: LEAGUES[3].id,
    cupId: DEFAULT_CUP_ID,
    route: { kind: 'football-match', matchId: 'match-1' },
  })!;
  expect(match.route).toEqual({
    kind: 'football-match',
    matchId: 'match-1',
    competitionId: LEAGUES[3].id,
  });

  expect(migrateLocation(null)).toBeUndefined();
  expect(migrateLocation({ sport: 'football', route: { kind: 'unknown' } })).toBeUndefined();
});

it('exposes section, home and start helpers for the new shell', () => {
  expect(START_SECTION).toBe('today');
  expect(startRoute()).toEqual({ kind: 'today', mode: 'today' });
  expect(startLocation()).toMatchObject({
    section: 'today',
    route: { kind: 'today', mode: 'today' },
    sport: 'football',
  });

  for (const route of validRoutes) {
    const section = sectionOfRoute(route);
    if (route.kind === 'settings' || route.kind === 'events') expect(section).toBeUndefined();
    else expect(section).toBeDefined();
    expect(isSectionRoute(route)).toBe(section !== undefined);
  }

  expect(defaultRouteOf('today')).toEqual({ kind: 'today', mode: 'today' });
  expect(defaultRouteOf('football')).toEqual({
    kind: 'football',
    competitionId: DEFAULT_LEAGUE_ID,
    tab: 'matches',
  });
  expect(defaultRouteOf('football', CHAMPIONS_LEAGUE_ID)).toEqual({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'matches',
  });
  expect(defaultRouteOf('f1')).toEqual({ kind: 'f1', tab: 'overview' });
  expect(defaultRouteOf('watch')).toEqual({ kind: 'watch' });
  expect(defaultRouteOf('my')).toEqual({ kind: 'my', tab: 'favorites' });
});

it('remembers the last place per section and migrates old per-sport memories', () => {
  const today = locationForRoute({ kind: 'today', mode: 'week' });
  expect(rememberedLocation('today', { location: today })).toEqual(today);
  expect(rememberedLocation('today', { location: { broken: true } })).toMatchObject({
    section: 'today',
    route: { kind: 'today', mode: 'today' },
  });

  const football = locationForRoute({
    kind: 'football',
    competitionId: LEAGUES[1].id,
    tab: 'standings',
  });
  expect(rememberedLocation('football', { location: football })).toEqual(football);
  expect(
    rememberedLocation('football', {
      location: {
        section: 'football',
        route: { kind: 'football', competitionId: LEAGUES[1].id, tab: 'live' },
        sport: 'football',
        leagueId: LEAGUES[1].id,
        cupId: DEFAULT_CUP_ID,
      },
    }),
  ).toMatchObject({
    section: 'football',
    route: {
      kind: 'football',
      competitionId: LEAGUES[1].id,
      tab: 'matches',
      matchesFilter: 'live',
    },
  });
  expect(
    rememberedLocation('football', { route: { kind: 'football', section: 'players' } }),
  ).toMatchObject({
    section: 'football',
    route: { kind: 'football', competitionId: DEFAULT_LEAGUE_ID, tab: 'players' },
  });

  expect(rememberedLocation('f1', { tab: 'calendar' })).toMatchObject({
    section: 'f1',
    route: { kind: 'f1', tab: 'calendar' },
  });
  const watch = locationForRoute({ kind: 'watch', channelId: 9 });
  expect(rememberedLocation('watch', { location: watch })).toEqual(watch);
  const my = locationForRoute({ kind: 'my', tab: 'games' });
  expect(rememberedLocation('my', { location: my })).toEqual(my);
  expect(rememberedLocation('my', { location: { kind: 'my', tab: 'unknown' } })).toMatchObject({
    section: 'my',
    route: { kind: 'my', tab: 'favorites' },
  });

  // Old per-sport memory is still read when the football section first opens.
  expect(
    rememberedLocation(
      'football',
      { location: { sport: 'ucl', route: { kind: 'ucl', tab: 'bracket' } } },
      { cupId: DEFAULT_CUP_ID },
    ),
  ).toMatchObject({
    section: 'football',
    route: { kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'bracket' },
  });
  expect(
    rememberedLocation(
      'football',
      { location: { sport: 'cup', route: { kind: 'cup', cupId: DEFAULT_CUP_ID, tab: 'table' } } },
      { cupId: DEFAULT_CUP_ID },
    ),
  ).toMatchObject({
    section: 'football',
    route: { kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'table' },
  });
});

it('keeps «Сейчас идут» as a search target of «Матчи» with the live filter', () => {
  const items = readSearchIndex();
  const live = items.find((item) => item.key === 'section:football.live');
  expect(live?.title).toBe('Сейчас идут');
  expect(live?.target).toEqual({ kind: 'section', id: 'football.live' });
  rememberSearchVisit('section:football.live');
  expect(readSearchRecent()).toContain('section:football.live');
});

it('migrates search section targets and recent keys at read time', () => {
  const oldSections = [
    'matches',
    'players',
    'overview',
    'stats',
    'f1',
    'watch',
    'planner',
    'events',
  ];
  localStorage.setItem(
    'sportsdesk.search.index',
    JSON.stringify(
      oldSections.map((id) => ({
        key: `section:${id}`,
        title: id,
        subtitle: 'Раздел',
        target: { kind: 'section', id },
      })),
    ),
  );
  localStorage.setItem(
    'sportsdesk.search.recent',
    JSON.stringify([
      'section:overview',
      'section:stats',
      'section:matches',
      'section:planner',
      'section:matches',
      'team:a',
    ]),
  );

  const items = readSearchIndex();
  expect(items.find((item) => item.key === 'section:football.matches')?.target).toEqual({
    kind: 'section',
    id: 'football.matches',
  });
  expect(items.find((item) => item.key === 'section:football.players')?.target).toEqual({
    kind: 'section',
    id: 'football.players',
  });
  expect(items.find((item) => item.key === 'section:today.plan')?.target).toEqual({
    kind: 'section',
    id: 'today.plan',
  });
  expect(items.some((item) => item.key === 'section:matches')).toBe(false);
  expect(items.some((item) => item.key === 'section:overview')).toBe(false);
  expect(items.some((item) => item.key === 'section:stats')).toBe(false);
  expect(readSearchRecent()).toEqual([
    'section:football.matches',
    'section:football.players',
    'section:today.plan',
    'team:a',
  ]);
  expect(readSearchRecent()).toEqual(readSearchRecent());

  rememberSearchItems([
    {
      key: 'team:a',
      title: 'Arsenal',
      subtitle: 'Premier League',
      target: { kind: 'team', id: 'a' },
    },
  ]);
  expect(readSearchIndex().find((item) => item.key === 'section:football.matches')).toBeTruthy();

  localStorage.setItem(
    'sportsdesk.search.index',
    JSON.stringify([
      { key: 'section:unknown', title: 'x', subtitle: '', target: { kind: 'section', id: 'x' } },
    ]),
  );
  expect(readSearchIndex().some((item) => item.key === 'section:x')).toBe(false);
});

it('migrates every old match tab to the four new ones on read', () => {
  expect(MATCH_TABS).toEqual(['overview', 'lineups', 'stats', 'analysis']);
  expect(migrateMatchTab('overview')).toBe('overview');
  expect(migrateMatchTab('events')).toBe('overview');
  expect(migrateMatchTab('lineups')).toBe('lineups');
  expect(migrateMatchTab('players')).toBe('lineups');
  expect(migrateMatchTab('stats')).toBe('stats');
  expect(migrateMatchTab('analysis')).toBe('analysis');
  expect(migrateMatchTab('tactics')).toBe('lineups');
  for (const tab of MATCH_TABS) expect(migrateMatchTab(tab)).toBe(tab);
  for (const tab of LEGACY_MATCH_TABS) expect(migrateMatchTab(tab)).toBeDefined();
  for (const tab of MATCH_TABS) expect(isMatchTab(tab)).toBe(true);
  expect(isMatchTab('players')).toBe(false);
  expect(migrateMatchTab('unknown')).toBeUndefined();
  expect(migrateMatchTab(null)).toBeUndefined();
});
