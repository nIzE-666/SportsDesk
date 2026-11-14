// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FavoritesProvider } from './FavoritesProvider';
import { MatchesView } from './MatchesView';
import { viewState } from '../../lib/viewState';
import type { UseFootballResult } from './useFootballData';

const data: UseFootballResult = {
  leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', season: '2026/2027' }],
  leaguesLoading: false,
  leaguesError: null,
  selectedLeagueId: 'l_4WFCIZ',
  setSelectedLeague: vi.fn(),
  season: '2026/2027',
  matches: [],
  matchesLoading: false,
  matchesError: null,
  stale: false,
  fetchedAt: null,
  reload: vi.fn(),
  allMatches: [],
  teams: [],
  leagueTeams: [],
  matchesForLeague: () => [],
  leagueName: () => 'Premier League',
  seasonsForLeague: () => ['2026/2027'],
  setSelectedSeason: vi.fn(),
};

let host: HTMLDivElement, root: Root;

async function renderMatches(showLeaguePicker?: boolean) {
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <MatchesView data={data} onOpenMatch={() => {}} showLeaguePicker={showLeaguePicker} />
      </FavoritesProvider>,
    ),
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('shows the league picker in the old frame', async () => {
  await renderMatches();
  expect(host.querySelector('#league-select')).not.toBeNull();
  expect(host.textContent).toContain('Лига');
});

it('hides the league picker in the new frame', async () => {
  await renderMatches(false);
  expect(host.querySelector('#league-select')).toBeNull();
  expect(host.querySelector('label[for="league-select"]')).toBeNull();
});
