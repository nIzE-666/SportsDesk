// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { FavoritesProvider } from './FavoritesProvider';
import { MatchDetailView } from './MatchDetailView';
import { MatchesView } from './MatchesView';
import { TeamView } from './TeamView';
import { StandingsView } from './StandingsView';
import type { HistoryMatch } from './history';
import type { MatchSummary } from './types';
import type { UseFootballResult } from './useFootballData';
import { viewState } from '../../lib/viewState';
import { STORAGE_KEYS } from './storage';

const transport = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn(), isTauriRuntime: () => false }));
vi.mock('../../lib/bridge', () => transport);

const home = { id: 'home', name: 'Atlético F.C.' };
const makeMatch = (id: string, status: string, time?: string): MatchSummary => ({
  id,
  status,
  time_utc: time,
  home_team: home,
  away_team: { id: `away-${id}`, name: `Opponent ${id}` },
  score_home: null,
  score_away: null,
});
const historyMatch = (
  id: string,
  leagueId: string,
  season: string,
  homeId = home.id,
): HistoryMatch => ({
  id,
  leagueId,
  season,
  homeId,
  homeName: homeId,
  awayId: 'away',
  awayName: 'Away',
  homeScore: 1,
  awayScore: 0,
  status: 'finished',
  date: '2099-01-01',
  round: id,
});
const makeData = (matches: MatchSummary[]): UseFootballResult => ({
  leagues: [{ id: 'league', name: 'League', season: '2099', seasons: ['2099', '2098'] }],
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
  seasonsForLeague: () => ['2099', '2098'],
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
  vi.restoreAllMocks();
});
async function render(element: React.ReactNode) {
  await act(async () => root.render(element));
}

it('starts the club directory with favorite teams and opens the chosen club', async () => {
  localStorage.setItem(
    STORAGE_KEYS.favoritesTeams,
    JSON.stringify({ ids: ['home'], seededDefault: true }),
  );
  const select = vi.fn();
  await render(
    <TeamView teamId={null} data={makeData([])} onSelectTeam={select} onOpenMatch={vi.fn()} />,
  );
  expect(host.querySelector('h1')?.textContent).toBe('Клубы');
  const favorite = host.querySelector<HTMLButtonElement>('.team-favorites button')!;
  expect(favorite.textContent).toContain('Atlético F.C.');
  expect(host.querySelector('#team-picker-select')).not.toBeNull();
  await act(async () => favorite.click());
  expect(select).toHaveBeenCalledWith('home');
});

it('uses the selected league catalogue names and badges in standings without guessing ambiguous teams', async () => {
  const clubs = [
    {
      id: 'brighton',
      name: 'Brighton',
      image_url: 'https://example.com/brighton.png',
      leagueId: 'l_4WFCIZ',
      leagueName: 'Premier League',
    },
    {
      id: 'bournemouth',
      name: 'Bournemouth',
      image_url: 'https://example.com/bournemouth.png',
      leagueId: 'l_4WFCIZ',
      leagueName: 'Premier League',
    },
  ];
  transport.api.mockResolvedValue({
    payload: {
      tables: [
        {
          rows: [
            { pos: 1, team: 'Brighton Hove Albion', pts: 3 },
            { pos: 2, team: 'Bournemouth AFC', pts: 1 },
            { pos: 3, team: 'Bournemouth Women', pts: 0 },
          ],
        },
      ],
    },
    fetchedAt: '2026-11-10T00:00:00Z',
  });
  const open = vi.fn();
  await render(
    <StandingsView
      data={{ ...makeData([]), selectedLeagueId: 'l_4WFCIZ', leagueTeams: clubs, teams: clubs }}
      onOpenTeam={open}
    />,
  );
  const rows = [...host.querySelectorAll<HTMLButtonElement>('.st-team')];
  expect(rows.map((row) => row.lastElementChild?.textContent)).toEqual([
    'Brighton',
    'Bournemouth',
    'Bournemouth Women',
  ]);
  expect(rows[0]?.querySelector('img')?.getAttribute('src')).toBe(
    'https://example.com/brighton.png',
  );
  expect(rows[1]?.querySelector('img')?.getAttribute('src')).toBe(
    'https://example.com/bournemouth.png',
  );
  expect(rows[2]?.disabled).toBe(true);
  await act(async () => rows[1]?.click());
  expect(open).toHaveBeenCalledWith('bournemouth');
});

it('normalizes both the search and team names', async () => {
  await render(
    <FavoritesProvider>
      <MatchesView
        data={makeData([makeMatch('scheduled', 'scheduled', '2099-01-01T12:00:00Z')])}
        onOpenMatch={vi.fn()}
      />
    </FavoritesProvider>,
  );
  const input = host.querySelector<HTMLInputElement>('#match-search')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'ATLETICO F C',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('[data-match-id="scheduled"]')).not.toBeNull();
});

it('shows only scheduled and live fixtures and plots the chosen league season', async () => {
  const fixtures = [
    makeMatch('scheduled', 'scheduled', '2099-01-02T12:00:00Z'),
    makeMatch('live', 'live', '2099-01-03T12:00:00Z'),
    makeMatch('cancelled', 'cancelled', '2099-01-04T12:00:00Z'),
    makeMatch('postponed', 'postponed', '2099-01-05T12:00:00Z'),
  ];
  transport.rpc.mockImplementation(async (command: string) => {
    if (command === 'history_team_matches')
      return [historyMatch('old', 'league', '2098'), historyMatch('other', 'cup', '2099')];
    if (command === 'history_season_matches')
      return [
        historyMatch('one', 'league', '2099'),
        historyMatch('two', 'league', '2099'),
        historyMatch('unrelated', 'league', '2099', 'unrelated'),
      ];
    return [];
  });
  await render(
    <FavoritesProvider>
      <TeamView
        teamId="home"
        data={makeData(fixtures)}
        onSelectTeam={vi.fn()}
        onOpenMatch={vi.fn()}
      />
    </FavoritesProvider>,
  );
  const schedule = host.querySelector('.team-schedule')!;
  expect(schedule.textContent).toContain('2 предстоящих');
  expect(schedule.textContent).toContain('В игре');
  expect(schedule.textContent).not.toContain('Opponent cancelled');
  expect(schedule.textContent).not.toContain('Opponent postponed');
  expect(transport.rpc).toHaveBeenCalledWith('history_season_matches', {
    leagueId: 'league',
    season: '2099',
  });
  expect(host.querySelector('.sa-chart')?.textContent).toContain('6 очков после 2 матчей');
});

it('reports the calendar events written and fixtures with no date', async () => {
  localStorage.setItem('sportsdesk.football.favorites.teams', JSON.stringify({ ids: ['home'] }));
  const fixtures = [
    makeMatch('timed', 'scheduled', '2099-01-02T12:00:00Z'),
    { ...makeMatch('day', 'scheduled'), date: '2099-01-03' },
    makeMatch('unknown', 'scheduled'),
    makeMatch('cancelled', 'cancelled', '2099-01-05T12:00:00Z'),
  ];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await render(
    <FavoritesProvider>
      <Dashboard
        data={makeData(fixtures)}
        onOpenMatch={vi.fn()}
        onOpenTeam={vi.fn()}
        onSeeAllMatches={vi.fn()}
      />
    </FavoritesProvider>,
  );
  const button = [...host.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('Матчи в календарь'),
  )!;
  await act(async () => button.click());
  expect(host.querySelector('.calendar-export-bar')?.textContent).toContain('2 матчей');
  expect(host.querySelector('.calendar-export-bar')?.textContent).toContain('без времени: 1');
  expect(host.querySelector('.calendar-export-bar')?.textContent).toContain(
    'без даты, пропущено: 1',
  );
});

it('retries the failed match request without navigating back', async () => {
  const detail = makeMatch('match', 'scheduled', '2099-01-01T12:00:00Z');
  transport.api.mockImplementation(async (_source: string, path: string) => {
    if (
      path === 'matches/match' &&
      transport.api.mock.calls.filter((call) => call[1] === path).length === 1
    )
      throw new Error('Network error');
    return { payload: { data: path === 'matches/match' ? detail : {} }, stale: false };
  });
  const onBack = vi.fn();
  await render(<MatchDetailView matchId="match" onBack={onBack} />);
  expect(host.textContent).toContain('Network error');
  const retry = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Повторить',
  )!;
  await act(async () => retry.click());
  expect(onBack).not.toHaveBeenCalled();
  expect(transport.api.mock.calls.filter((call) => call[1] === 'matches/match')).toHaveLength(2);
  expect(host.querySelector('.md-header')?.textContent).toContain('Atlético F.C.');
});
