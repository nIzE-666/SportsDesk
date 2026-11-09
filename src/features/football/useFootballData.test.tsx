// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFootballData, type UseFootballResult } from './useFootballData';
import { api } from '../../lib/bridge';
vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));
vi.mock('./history', () => ({ saveSeasonToHistory: vi.fn(async () => {}) }));
const EPL = 'l_4WFCIZ',
  MLS = 'l_0eg6C9';
let host: HTMLDivElement, root: Root, current: UseFootballResult;
let favoriteIds: string[];
const reply = (payload: unknown) => ({
  source: 'pitch',
  payload,
  stale: false,
  fetchedAt: '2026-10-25T00:00:00Z',
});
function Probe() {
  current = useFootballData(EPL, favoriteIds);
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  favoriteIds = [];
  vi.mocked(api).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api).mockImplementation(async (_source, path) => {
    if (path === 'leagues')
      return reply({
        data: {
          leagues: [
            {
              id: EPL,
              name: 'Premier League',
              season: '2031/2032',
              current_season: '2032/2033',
              seasons: ['2031/2032', '2032/2033'],
            },
            { id: MLS, name: 'MLS', season: '2032', seasons: ['2032', '2031'] },
          ],
        },
      });
    const id = path.split('/')[1]!;
    const season = new URLSearchParams(path.split('?')[1]).get('season') ?? 'auto';
    return reply({
      data: {
        league: { id, name: id },
        matches: [
          {
            id: `fixture-${id}-${season}`,
            home_team: { id: `home-${id}`, name: 'Home' },
            away_team: { id: `away-${id}`, name: 'Away' },
            status: 'finished',
            score_home: 1,
            score_away: 0,
          },
        ],
      },
    });
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it('preloads the source-defined future seasons, including a different calendar-year MLS season', async () => {
  await act(async () => root.render(<Probe />));
  expect(current.season).toBe('2032/2033');
  expect(current.allMatches.map((m) => m.id)).toContain(`fixture-${EPL}-2032/2033`);
  expect(current.allMatches.map((m) => m.id)).toContain(`fixture-${MLS}-2032`);
  expect(vi.mocked(api).mock.calls.some(([, path]) => path.includes('2026%2F2027'))).toBe(false);
});
it('keeps dashboard data current while browsing a historical season', async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => current.setSelectedSeason('2031/2032'));
  expect(current.season).toBe('2031/2032');
  expect(current.matches.map((m) => m.id)).toContain(`fixture-${EPL}-2031/2032`);
  expect(current.allMatches.map((m) => m.id)).toContain(`fixture-${EPL}-2032/2033`);
  expect(current.allMatches.map((m) => m.id)).not.toContain(`fixture-${EPL}-2031/2032`);
});
it('rolls an old cached catalogue forward after receiving the fresh provider season', async () => {
  localStorage.setItem('sportsdesk.football.catalogue', JSON.stringify({ [EPL]: ['2026/2027'] }));
  await act(async () => root.render(<Probe />));
  expect(current.season).toBe('2032/2033');
  expect(current.allMatches.map((m) => m.id)).toContain(`fixture-${EPL}-2032/2033`);
  expect(current.allMatches.map((m) => m.id)).not.toContain(`fixture-${EPL}-2026/2027`);
});
it('lets the API pick the current season when catalogue metadata is absent instead of inventing a year', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (...args) =>
    args[1] === 'leagues'
      ? reply({ data: { leagues: [{ id: EPL, name: 'Premier League' }] } })
      : original(...args),
  );
  await act(async () => root.render(<Probe />));
  expect(current.season).toBeUndefined();
  expect(current.matches.length).toBe(1);
  expect(vi.mocked(api).mock.calls.some(([, path]) => path.includes('season='))).toBe(false);
});

it('loads the current season of a saved favorite in another league, even after changing leagues', async () => {
  const extra = 'extra-league';
  favoriteIds = [`home-${extra}`];
  localStorage.setItem(
    'sportsdesk.football.catalogue',
    JSON.stringify([{ id: `home-${extra}`, name: 'Home', leagueId: extra }]),
  );
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (...args) =>
    args[1] === 'leagues'
      ? reply({
          data: {
            leagues: [
              {
                id: EPL,
                name: 'Premier League',
                current_season: '2032/2033',
                seasons: ['2032/2033'],
              },
              {
                id: extra,
                name: 'Extra League',
                current_season: '2032',
                seasons: ['2032', '2031'],
              },
            ],
          },
        })
      : original(...args),
  );
  await act(async () => root.render(<Probe />));
  expect(current.allMatches.map((m) => m.id)).toContain(`fixture-${extra}-2032`);
  expect(current.teams.some((team) => team.id === `home-${extra}` && team.leagueId === extra)).toBe(
    true,
  );
  await act(async () => current.setSelectedLeague(extra));
  await act(async () => current.setSelectedSeason('2031'));
  expect(current.matches.map((m) => m.id)).toContain(`fixture-${extra}-2031`);
  expect(current.allMatches.map((m) => m.id)).toContain(`fixture-${extra}-2032`);
  expect(current.allMatches.map((m) => m.id)).not.toContain(`fixture-${extra}-2031`);
  await act(async () => current.setSelectedLeague(EPL));
  expect(current.allMatches.map((m) => m.id)).toContain(`fixture-${extra}-2032`);
});

it('uses the cached season for a favorite extra league when the catalogue is offline', async () => {
  const extra = 'extra-league';
  favoriteIds = [`home-${extra}`];
  localStorage.setItem(
    'sportsdesk.football.catalogue',
    JSON.stringify([{ id: `home-${extra}`, name: 'Home', leagueId: extra }]),
  );
  localStorage.setItem(
    'sportsdesk.football.seasonCatalogue',
    JSON.stringify({ [extra]: ['2032'] }),
  );
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (...args) => {
    if (args[1] === 'leagues') throw new Error('offline');
    return original(...args);
  });
  await act(async () => root.render(<Probe />));
  expect(
    vi.mocked(api).mock.calls.some(([, path]) => path.includes(`${extra}/matches?season=2032`)),
  ).toBe(true);
  expect(current.allMatches.map((m) => m.id)).toContain(`fixture-${extra}-2032`);
});

it('notifies the storage mirror about catalogue and season changes', async () => {
  const keys: string[] = [];
  const listener = (event: Event) => keys.push((event as CustomEvent<{ key: string }>).detail.key);
  window.addEventListener('sportsdesk-storage-changed', listener);
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => current.setSelectedSeason('2031/2032'));
    expect(keys).toContain('sportsdesk.football.seasonCatalogue');
    expect(keys).toContain('sportsdesk.football.seasons');
  } finally {
    window.removeEventListener('sportsdesk-storage-changed', listener);
  }
});
