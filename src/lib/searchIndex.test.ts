// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  findSearchItems,
  indexSportsPayload,
  isSearchItemVisible,
  normalizeSearch,
  readSearchIndex,
  rememberSearchItems,
  rememberSearchVisit,
} from './searchIndex';
import { DEFAULT_MODULES, leagueModuleId } from './modules';
import { CHAMPIONS_LEAGUE_ID, DEFAULT_CUP_ID } from './navigation';
beforeEach(() => localStorage.clear());
it('keeps match results across preloaded leagues instead of replacing them with the last league', () => {
  for (let league = 0; league < 6; league++)
    indexSportsPayload('pitch', `leagues/league-${league}/matches`, {
      data: {
        league: { name: `League ${league}` },
        matches: Array.from({ length: 380 }, (_, i) => ({
          id: `match-${league}-${i}`,
          home_team: { id: `home-${league}`, name: `Home ${league}` },
          away_team: { id: `away-${league}`, name: `Away ${league}` },
        })),
      },
    });
  for (let league = 0; league < 6; league++)
    expect(
      findSearchItems(readSearchIndex(), `Home ${league} Away ${league}`).some(
        (x) => x.target.kind === 'match' && x.target.id === `match-${league}-0`,
      ),
    ).toBe(true);
});
it('matches Cyrillic, accents and multiple words without duplicate recent sections', () => {
  expect(normalizeSearch('Атлетико — Мадрид')).toBe('атлетико мадрид');
  rememberSearchItems([
    {
      key: 'team:a',
      title: 'Atlético Madrid',
      subtitle: 'Атлетико Мадрид',
      target: { kind: 'team', id: 'a' },
    },
  ]);
  expect(findSearchItems(readSearchIndex(), 'мадрид атлетико')[0]?.key).toBe('team:a');
  expect(findSearchItems(readSearchIndex(), 'Atletico')[0]?.key).toBe('team:a');
  rememberSearchVisit('section:events');
  const recent = findSearchItems(readSearchIndex(), '');
  expect(recent[0]?.key).toBe('section:events');
  expect(new Set(recent.map((x) => x.key)).size).toBe(recent.length);
});
it('indexes exact match and player targets from loaded data and excludes stream secrets', () => {
  indexSportsPayload('pitch', 'leagues/league/matches', {
    data: {
      league: { name: 'Тест' },
      matches: [
        {
          id: 'old-match',
          home_team: { id: 'a', name: 'Arsenal' },
          away_team: { id: 'b', name: 'Chelsea' },
        },
      ],
    },
  });
  expect(findSearchItems(readSearchIndex(), 'Arsenal Chelsea')[0]?.target).toEqual({
    kind: 'match',
    id: 'old-match',
    leagueId: 'league',
  });
  indexSportsPayload('pitch', 'matches/old-match', {
    data: {
      id: 'old-match',
      home_team: { id: 'a', name: 'Arsenal' },
      away_team: { id: 'b', name: 'Chelsea' },
    },
  });
  localStorage.setItem(
    'sportsdesk.football.catalogue',
    JSON.stringify([{ id: 'a', name: 'Arsenal' }]),
  );
  expect(findSearchItems(readSearchIndex(), 'Arsenal Chelsea')[0]?.target).toEqual({
    kind: 'match',
    id: 'old-match',
    leagueId: 'league',
  });
  expect(readSearchIndex().find((x) => x.key === 'team:a')?.target).toEqual({
    kind: 'team',
    id: 'a',
    leagueId: 'league',
  });
  expect(findSearchItems(readSearchIndex(), 'Arsenal')[0]?.target.kind).toBe('team');
  indexSportsPayload('pitch', 'matches/old-match/players', {
    data: [{ player: { id: 'p', name: 'Raphinha' }, team_id: 'a', stream: 'secret-url' }],
  });
  expect(findSearchItems(readSearchIndex(), 'Raphinha')[0]?.target).toMatchObject({
    kind: 'player',
    player: { id: 'p', matchId: 'old-match', teamId: 'a' },
  });
  expect(localStorage.getItem('sportsdesk.search.index')).not.toContain('secret-url');
});
it('indexes the actual driver season and rejects invalid cached targets', () => {
  indexSportsPayload('jolpica', '2025/driverStandings.json', {
    MRData: {
      StandingsTable: {
        StandingsLists: [
          {
            season: '2025',
            DriverStandings: [
              {
                Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen' },
              },
            ],
          },
        ],
      },
    },
  });
  expect(findSearchItems(readSearchIndex(), 'Ферстаппен')[0]?.target).toEqual({
    kind: 'driver',
    id: 'max_verstappen',
    year: 2025,
  });
  localStorage.setItem(
    'sportsdesk.search.index',
    JSON.stringify([
      { key: 'bad', title: 'Invalid', subtitle: '', target: { kind: 'channel', id: -1 } },
    ]),
  );
  expect(findSearchItems(readSearchIndex(), 'Invalid')).toEqual([]);
});
it('offers the five sections, «Моё» tabs, settings, competitions and F1 tabs with aliases', () => {
  const items = readSearchIndex();
  const target = (query: string) => findSearchItems(items, query)[0]?.target;

  expect(target('Футбол')).toEqual({ kind: 'section', id: 'football' });
  expect(target('Главное')).toEqual({ kind: 'section', id: 'home' });
  expect(target('Моё')).toEqual({ kind: 'section', id: 'my' });
  expect(target('Дневник')).toEqual({ kind: 'section', id: 'my.diary' });
  expect(target('Схемы')).toEqual({ kind: 'section', id: 'my.schemes' });
  expect(target('Внешний вид')).toEqual({ kind: 'settings', category: 'appearance' });
  expect(target('тема')).toEqual({ kind: 'settings', category: 'appearance' });
  expect(target('Источники')).toEqual({ kind: 'settings', category: 'sources' });
  expect(target('Лига Европы')).toEqual({ kind: 'competition', id: DEFAULT_CUP_ID });
  expect(target('ЛЧ')).toEqual({ kind: 'competition', id: CHAMPIONS_LEAGUE_ID });
  expect(target('Зачёты')).toEqual({ kind: 'section', id: 'f1.standings' });
  expect(target('Анализ')).toEqual({ kind: 'section', id: 'f1.analysis' });
});
it('hides search results of modules and competitions that are switched off', () => {
  const items = readSearchIndex();
  const modules = {
    ...DEFAULT_MODULES,
    home: false,
    watch: false,
    diary: false,
    games: false,
    predictions: false,
    tactics: false,
    europe: false,
    [leagueModuleId('l_0ErfuF')]: false,
  };
  const visible = (query: string) =>
    findSearchItems(items, query).filter((item) => isSearchItemVisible(item, modules));

  expect(
    visible('Главное').some((item) => item.target.kind === 'section' && item.target.id === 'home'),
  ).toBe(false);
  expect(visible('Смотреть')).toEqual([]);
  expect(
    visible('Дневник').some(
      (item) => item.target.kind === 'section' && item.target.id === 'my.diary',
    ),
  ).toBe(false);
  expect(
    visible('Игры и прогнозы').some(
      (item) => item.target.kind === 'section' && item.target.id === 'my.games',
    ),
  ).toBe(false);
  expect(
    visible('Схемы').some(
      (item) => item.target.kind === 'section' && item.target.id === 'my.schemes',
    ),
  ).toBe(false);
  expect(visible('Лига Европы')).toEqual([]);
  expect(visible('Чемпионат мира')).toEqual([]);
  expect(visible('Ла Лига')).toEqual([]);
  expect(visible('Основное')).toHaveLength(1);
  expect(visible('Премьер-лига').some((item) => item.target.kind === 'competition')).toBe(true);
});
it('keeps old saved search items and recent keys after the catalogue grows', () => {
  localStorage.setItem(
    'sportsdesk.search.index',
    JSON.stringify([
      {
        key: 'section:matches',
        title: 'Матчи',
        subtitle: 'Раздел',
        target: { kind: 'section', id: 'matches' },
      },
      {
        key: 'team:old',
        title: 'Old club',
        subtitle: 'Старая лига',
        target: { kind: 'team', id: 'old' },
      },
    ]),
  );
  localStorage.setItem(
    'sportsdesk.search.recent',
    JSON.stringify(['section:planner', 'section:matches']),
  );

  const items = readSearchIndex();
  expect(items.find((item) => item.key === 'section:football.matches')?.target).toEqual({
    kind: 'section',
    id: 'football.matches',
  });
  expect(items.find((item) => item.key === 'team:old')?.title).toBe('Old club');
  expect(findSearchItems(items, 'Old club')[0]?.target).toEqual({ kind: 'team', id: 'old' });
  expect(
    findSearchItems(items, 'Мой спортивный вечер').some(
      (item) => item.target.kind === 'section' && item.target.id === 'today.plan',
    ),
  ).toBe(true);
});

it('indexes per-match leagueId and league name from Pitch date/{day} payloads for module filtering', () => {
  indexSportsPayload('pitch', 'date/2026-11-22', {
    data: {
      matches: [
        {
          id: 'date-laliga-1',
          league: { id: 'l_0ErfuF', name: 'LaLiga' },
          home_team: { id: 'rm', name: 'Real Madrid' },
          away_team: { id: 'fcb', name: 'Barcelona' },
          time_utc: '2026-11-22T20:00:00Z',
        },
      ],
    },
  });
  const items = readSearchIndex();
  const matchItem = findSearchItems(items, 'Real Madrid Barcelona')[0];
  expect(matchItem?.target).toEqual({
    kind: 'match',
    id: 'date-laliga-1',
    leagueId: 'l_0ErfuF',
  });
  expect(matchItem?.subtitle).toContain('LaLiga');

  const offModules = { ...DEFAULT_MODULES, [leagueModuleId('l_0ErfuF')]: false };
  expect(isSearchItemVisible(matchItem!, offModules)).toBe(false);
});
