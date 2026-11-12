// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { FavoritesProvider } from './FavoritesProvider';
import { STORAGE_KEYS } from './storage';
import { viewState } from '../../lib/viewState';
import { DEFAULT_FAVORITE_TEAM_NAMES } from '../../lib/sportsIdentity';
import type { MatchSummary } from './types';
import type { UseFootballResult } from './useFootballData';

const transport = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn(), isTauriRuntime: () => false }));
vi.mock('../../lib/bridge', () => transport);

const home = { id: 'home', name: 'Atlético F.C.' };
const upcoming = (id: string, time: string): MatchSummary => ({
  id,
  status: 'scheduled',
  time_utc: time,
  date: time.slice(0, 10),
  home_team: home,
  away_team: { id: `away-${id}`, name: `Opponent ${id}` },
  score_home: null,
  score_away: null,
});
const played = (id: string, time: string): MatchSummary => ({
  ...upcoming(id, time),
  status: 'finished',
  score_home: 2,
  score_away: 1,
});
const dataFor = (matches: MatchSummary[]): UseFootballResult => ({
  leagues: [{ id: 'league', name: 'League', season: '2099', seasons: ['2099'] }],
  leaguesLoading: false,
  leaguesError: null,
  selectedLeagueId: 'league',
  setSelectedLeague: vi.fn(),
  season: '2099',
  matches,
  matchesLoading: false,
  matchesError: null,
  stale: false,
  fetchedAt: null,
  reload: vi.fn(),
  allMatches: matches,
  teams: [{ ...home, leagueId: 'league', leagueName: 'League' }],
  leagueTeams: [{ ...home, leagueId: 'league', leagueName: 'League' }],
  matchesForLeague: () => matches,
  leagueName: () => 'League',
  seasonsForLeague: () => ['2099'],
  setSelectedSeason: vi.fn(),
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  transport.api.mockReset();
  transport.rpc.mockReset();
  transport.rpc.mockResolvedValue([]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
/** Favourite clubs by id, and optionally no default clubs at all. */
function follow(ids: string[], withDefaults = true) {
  localStorage.setItem(
    STORAGE_KEYS.favoritesTeams,
    JSON.stringify({
      ids,
      seeded: [],
      seededDefault: true,
      dismissed: withDefaults ? [] : [...DEFAULT_FAVORITE_TEAM_NAMES],
    }),
  );
}
async function show(matches: MatchSummary[]) {
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <Dashboard
          data={dataFor(matches)}
          onOpenMatch={vi.fn()}
          onOpenTeam={vi.fn()}
          onSeeAllMatches={vi.fn()}
        />
      </FavoritesProvider>,
    ),
  );
}
const tiles = () =>
  [...host.querySelectorAll('.insights-row > div')].map((el) =>
    el.textContent?.replace(/\s+/g, ' ').trim(),
  );

it('shows no tiles at all when nothing has a value', async () => {
  follow([], false);
  await show([]);
  expect(host.querySelector('.insights-row')).toBeNull();
  expect(host.textContent).not.toContain('Нет ближайшего матча');
  // Both columns say once why they are empty instead of showing a bare heading.
  expect(host.querySelectorAll('.state-block')).toHaveLength(2);
});
it('shows only the tracked-clubs tile when no match is ahead', async () => {
  follow([]);
  await show([played('old', '2098-01-01T12:00:00Z')]);
  expect(tiles()).toHaveLength(1);
  expect(tiles()[0]).toMatch(/клуб(а|ов)? под присмотром$/);
  expect(host.textContent).not.toContain('Нет ближайшего матча');
  expect(host.textContent).not.toContain('League впереди');
});
it('shows the matches-ahead and next-match tiles from the schedule, with plain Russian counts', async () => {
  follow(['home'], false);
  await show([upcoming('one', '2099-03-01T12:00:00Z')]);
  expect(tiles()).toHaveLength(3);
  expect(tiles()[0]).toBe('1клуб под присмотром');
  expect(tiles()[1]).toBe('1матч League впереди');
  expect(tiles()[2]).toContain('Atlético F.C. — Opponent one');
  await show([
    upcoming('one', '2099-03-01T12:00:00Z'),
    upcoming('two', '2099-03-08T12:00:00Z'),
    upcoming('three', '2099-03-15T12:00:00Z'),
  ]);
  expect(tiles()[1]).toBe('3матча League впереди');
  expect(host.querySelector('.recent-card .section-title .muted')?.textContent).toBe('3 матча');
});
it('shows no next-match tile when the matches ahead are not of a tracked club', async () => {
  follow([], false);
  await show([upcoming('one', '2099-03-01T12:00:00Z')]);
  expect(tiles()).toEqual(['1матч League впереди']);
  expect(host.querySelector('.next-insight')).toBeNull();
});
it('leaves out the clubs block with no tracked clubs and explains once how to add them', async () => {
  follow([]);
  await show([upcoming('one', '2099-03-01T12:00:00Z')]);
  expect(host.querySelector('.favorite-section')).toBeNull();
  expect(host.textContent).not.toContain('Ваши клубы');
  expect(host.textContent).toContain('Пока никого под присмотром');
  expect(host.textContent?.match(/звёздочкой в разделе «Матчи»/g)).toHaveLength(1);
});
it('shows the clubs block with its tiles once a club is tracked', async () => {
  follow(['home']);
  await show([upcoming('one', '2099-03-01T12:00:00Z')]);
  expect(host.querySelector('.favorite-section')?.textContent).toContain('Atlético F.C.');
  expect(host.querySelectorAll('.club-tile')).toHaveLength(1);
});
