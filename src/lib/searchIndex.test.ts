// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  findSearchItems,
  indexSportsPayload,
  normalizeSearch,
  readSearchIndex,
  rememberSearchItems,
  rememberSearchVisit,
} from './searchIndex';
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
