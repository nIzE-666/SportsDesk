// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viewState } from '../../lib/viewState';
import { FavoritesProvider } from './FavoritesProvider';
import { PlayersCenter } from './PlayersCenter';
import { TeamView } from './TeamView';
import { STORAGE_KEYS } from './storage';
import type { HistoryMatch } from './history';
import type { MatchSummary } from './types';
import type { UseFootballResult } from './useFootballData';

const transport = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn(), isTauriRuntime: () => false }));
const analytics = vi.hoisted(() => ({ fetchPlayerSeasonStats: vi.fn() }));
vi.mock('../../lib/bridge', () => transport);
vi.mock('./playerAnalytics', async (original) => ({
  ...(await original<typeof import('./playerAnalytics')>()),
  fetchPlayerSeasonStats: analytics.fetchPlayerSeasonStats,
}));

const club = { id: 'club', name: 'Club', leagueId: 'league', leagueName: 'League' };
const rival = { id: 'rival', name: 'Rival', leagueId: 'league', leagueName: 'League' };
const match: MatchSummary = {
  id: 'loaded-match',
  status: 'finished',
  date: '2026-01-02',
  home_team: club,
  away_team: rival,
  score_home: 1,
  score_away: 0,
};
const storedMatch = (id: string, teamId = 'club'): HistoryMatch => ({
  id,
  leagueId: 'league',
  season: '2026',
  homeId: teamId,
  homeName: teamId,
  awayId: 'rival',
  awayName: 'Rival',
  homeScore: 1,
  awayScore: 0,
  status: 'finished',
  date: '2026-01-01',
  round: id,
});
const data = (matches: MatchSummary[]): UseFootballResult => ({
  leagues: [{ id: 'league', name: 'League', season: '2026', seasons: ['2026'] }],
  leaguesLoading: false,
  leaguesError: null,
  selectedLeagueId: 'league',
  setSelectedLeague: vi.fn(),
  season: '2026',
  matches,
  matchesLoading: false,
  matchesError: null,
  stale: false,
  fetchedAt: null,
  reload: vi.fn(),
  allMatches: matches,
  teams: [club, rival],
  leagueTeams: [club, rival],
  matchesForLeague: () => matches,
  leagueName: () => 'League',
  seasonsForLeague: () => ['2026'],
  setSelectedSeason: vi.fn(),
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  transport.api.mockReset();
  transport.rpc.mockReset();
  analytics.fetchPlayerSeasonStats.mockReset();
  transport.api.mockResolvedValue({ payload: { data: [] }, stale: false });
  transport.rpc.mockResolvedValue([]);
  analytics.fetchPlayerSeasonStats.mockImplementation(async (playerId, _teamId, matches) => ({
    metrics: [
      {
        key: 'goals',
        label: 'Goals',
        type: 'number',
        value: playerId === 'slow' ? 99 : playerId === 'fast' ? 1 : 2,
        matches: matches.length,
        kind: 'total',
      },
    ],
    matches: [],
    scanned: matches.length,
    available: matches.length,
    failed: 0,
    totalCandidates: matches.length,
    minutes: 0,
    fetchedAt: null,
    stale: false,
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(element: React.ReactNode) {
  await act(async () => root.render(element));
}
async function retry(title: string) {
  const alert = [...host.querySelectorAll('[role="alert"]')].find((item) =>
    item.textContent?.includes(title),
  );
  expect(alert, title).toBeDefined();
  const button = alert!.querySelector<HTMLButtonElement>('button');
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

it('does not calculate partial player totals on a history failure and retries with all matches', async () => {
  localStorage.setItem(
    STORAGE_KEYS.favoritePlayers,
    JSON.stringify([{ id: 'player', name: 'Player', teamId: 'club', savedAt: '2026' }]),
  );
  transport.rpc.mockRejectedValueOnce(new Error('history unavailable'));
  transport.rpc.mockResolvedValueOnce([storedMatch('from-history')]);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data([match])} onOpenMatch={vi.fn()} />
    </FavoritesProvider>,
  );
  expect(host.textContent).toContain('прочитать локальную историю матчей');
  expect(host.querySelector('.pc-metrics')).toBeNull();
  expect(analytics.fetchPlayerSeasonStats).not.toHaveBeenCalled();
  await retry('Статистика недоступна');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(analytics.fetchPlayerSeasonStats).toHaveBeenCalledWith(
    'player',
    'club',
    expect.arrayContaining([expect.objectContaining({ id: 'from-history' }), match]),
  );
  expect(host.querySelector('.pc-foot')?.textContent).toContain('проверено 2 из 2');
});

it('retries each history query in team analytics', async () => {
  const attempts = new Map<string, number>();
  transport.rpc.mockImplementation(async (command: string) => {
    const count = (attempts.get(command) ?? 0) + 1;
    attempts.set(command, count);
    if (count === 1) throw new Error('database unavailable');
    if (command === 'history_season_matches') return [storedMatch('one'), storedMatch('two')];
    return [storedMatch(command)];
  });
  await render(
    <FavoritesProvider>
      <TeamView teamId="club" data={data([])} onSelectTeam={vi.fn()} onOpenMatch={vi.fn()} />
    </FavoritesProvider>,
  );
  expect(host.textContent).toContain('История команды недоступна');
  expect(host.textContent).toContain('История сезона недоступна');
  await retry('История команды недоступна');
  await retry('История сезона недоступна');
  expect(host.querySelector('.sa-chart')?.textContent).toContain('6 очков после 2 матчей');
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Соперник для head-to-head"]')!;
  await act(async () => {
    select.value = 'rival';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.textContent).toContain('История личных встреч недоступна');
  await retry('История личных встреч недоступна');
  expect(host.querySelector('.sa-h2h-summary')?.textContent).toContain('1 матчей');
});

it('does not replace a newly selected comparison with a late response', async () => {
  localStorage.setItem(
    STORAGE_KEYS.favoritePlayers,
    JSON.stringify([
      { id: 'slow', name: 'Slow', teamId: 'slow-team', savedAt: '2026' },
      { id: 'fast', name: 'Fast', teamId: 'club', savedAt: '2026' },
      { id: 'fixed', name: 'Fixed', teamId: 'club', savedAt: '2026' },
    ]),
  );
  viewState.write('players.compare.a', 'slow');
  viewState.write('players.compare.b', 'fixed');
  let finish!: (rows: HistoryMatch[]) => void;
  const pending = new Promise<HistoryMatch[]>((resolve) => {
    finish = resolve;
  });
  transport.rpc.mockImplementation((command: string, args: { teamId?: string }) =>
    command === 'history_team_matches' && args?.teamId === 'slow-team'
      ? pending
      : Promise.resolve([storedMatch('from-history')]),
  );
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data([match])} onOpenMatch={vi.fn()} />
    </FavoritesProvider>,
  );
  const select = host.querySelector<HTMLSelectElement>(
    '[aria-label="Первый игрок для сравнения"]',
  )!;
  await act(async () => {
    select.value = 'fast';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const compare = () => host.querySelector('.pc-compare')!;
  expect(compare().textContent).toContain('Fast и Fixed');
  await act(async () => finish([storedMatch('slow-history', 'slow-team')]));
  expect(compare().textContent).toContain('Fast и Fixed');
  expect(compare().querySelector('.pc-compare-row strong')?.textContent).toBe('1');
});
