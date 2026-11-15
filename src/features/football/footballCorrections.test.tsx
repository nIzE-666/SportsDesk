// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  expect(host.querySelector('.screen-title')?.textContent).toBe('Клубы');
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
    stale: true,
  });
  const open = vi.fn();
  await render(
    <StandingsView
      data={{ ...makeData([]), selectedLeagueId: 'l_4WFCIZ', leagueTeams: clubs, teams: clubs }}
      onOpenTeam={open}
    />,
  );
  const rows = [...host.querySelectorAll<HTMLButtonElement>('.st-team-open')];
  expect(
    rows.map((row) => row.querySelector('.ui-button__label > span:last-child')?.textContent),
  ).toEqual(['Brighton', 'Bournemouth', 'Bournemouth Women']);
  expect(rows[0]?.querySelector('img')?.getAttribute('src')).toBe(
    'https://example.com/brighton.png',
  );
  expect(rows[1]?.querySelector('img')?.getAttribute('src')).toBe(
    'https://example.com/bournemouth.png',
  );
  expect(rows[2]?.disabled).toBe(true);
  expect(host.querySelector('.source-foot')?.textContent).toContain('устаревшими');
  await act(async () => rows[1]?.click());
  expect(open).toHaveBeenCalledWith('bournemouth');
});

it('shows catalogue names and crests for clubs another league table spells differently', async () => {
  const catalogue = (id: string, name: string) => ({
    id,
    name,
    image_url: `https://example.com/${id}.png`,
    leagueId: 'l_0ALvwF',
    leagueName: 'Serie A',
  });
  const clubs = [
    catalogue('inter', 'Inter'),
    catalogue('milan', 'Milan'),
    catalogue('roma', 'Roma'),
    catalogue('juve', 'Juventus'),
  ];
  transport.api.mockResolvedValue({
    payload: {
      competition: 'Italian Serie A',
      tables: [
        {
          rows: [
            { pos: 1, team: 'Inter Milan', team_logo: 'https://source.test/inter.png', pts: 9 },
            { pos: 2, team: 'AC Milan', team_logo: 'https://source.test/milan.png', pts: 7 },
            { pos: 3, team: 'AS Roma', team_logo: 'https://source.test/roma.png', pts: 6 },
            { pos: 4, team: 'Juventus FC', team_logo: 'https://source.test/juve.png', pts: 4 },
            { pos: 5, team: 'Newly Promoted', team_logo: 'https://source.test/new.png', pts: 1 },
          ],
        },
      ],
    },
    fetchedAt: '2026-11-12T00:00:00Z',
  });
  const open = vi.fn();
  await render(
    <StandingsView
      data={{ ...makeData([]), selectedLeagueId: 'l_0ALvwF', leagueTeams: clubs, teams: clubs }}
      onOpenTeam={open}
    />,
  );
  const rows = [...host.querySelectorAll<HTMLButtonElement>('.st-team-open')];
  expect(
    rows.map((row) => row.querySelector('.ui-button__label > span:last-child')?.textContent),
  ).toEqual(['Inter', 'Milan', 'Roma', 'Juventus', 'Newly Promoted']);
  expect(rows.map((row) => row.querySelector('img')?.getAttribute('src'))).toEqual([
    'https://example.com/inter.png',
    'https://example.com/milan.png',
    'https://example.com/roma.png',
    'https://example.com/juve.png',
    'https://source.test/new.png',
  ]);
  expect(rows.map((row) => row.disabled)).toEqual([false, false, false, false, true]);
  expect(rows[4]?.title).toBe('Для этого клуба нет страницы');
  expect(host.querySelector('.dashboard-head p')?.textContent).toContain('Серия A · текущий сезон');
  await act(async () => rows[0]?.click());
  expect(open).toHaveBeenCalledWith('inter');
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
