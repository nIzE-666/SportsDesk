// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viewState } from '../../lib/viewState';
import { ClubPlayers } from './ClubPlayers';
import { FavoritesProvider } from './FavoritesProvider';
import { TeamView } from './TeamView';
import { STORAGE_KEYS } from './storage';
import type { HistoryMatch } from './history';
import type { MatchSummary } from './types';
import type { UseFootballResult } from './useFootballData';

const transport = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn(), isTauriRuntime: () => false }));
vi.mock('../../lib/bridge', () => transport);

const arsenal = { id: 'arsenal', name: 'Arsenal' };
const chelsea = { id: 'chelsea', name: 'Chelsea' };
const everton = { id: 'everton', name: 'Everton' };

const matches: MatchSummary[] = [
  {
    id: 'old-win',
    status: 'finished',
    date: '2026-10-20',
    home_team: arsenal,
    away_team: chelsea,
    score_home: 2,
    score_away: 1,
  },
  {
    id: 'old-draw',
    status: 'finished',
    date: '2026-10-05',
    home_team: arsenal,
    away_team: everton,
    score_home: 0,
    score_away: 0,
  },
  {
    id: 'next',
    status: 'scheduled',
    time_utc: '2026-11-22T18:00:00Z',
    home_team: chelsea,
    away_team: arsenal,
    score_home: null,
    score_away: null,
  },
  {
    id: 'later',
    status: 'scheduled',
    time_utc: '2026-12-05T18:00:00Z',
    home_team: arsenal,
    away_team: everton,
    score_home: null,
    score_away: null,
  },
];

const storedMatch: HistoryMatch = {
  id: 'stored',
  leagueId: 'l_4WFCIZ',
  season: '2026',
  homeId: 'arsenal',
  homeName: 'Arsenal',
  awayId: 'chelsea',
  awayName: 'Chelsea',
  homeScore: 1,
  awayScore: 0,
  status: 'finished',
  date: '2026-09-01',
  round: '4',
};

function dataFor(list: MatchSummary[] = matches): UseFootballResult {
  const teams = new Map<string, { id: string; name: string }>();
  for (const match of list) {
    teams.set(match.home_team.id, match.home_team);
    teams.set(match.away_team.id, match.away_team);
  }
  for (const team of [arsenal, chelsea, everton]) teams.set(team.id, team);
  const catalogue = [...teams.values()].map((team) => ({
    ...team,
    leagueId: 'l_4WFCIZ',
    leagueName: 'Premier League',
  }));
  return {
    leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', season: '2026/2027' }],
    leaguesLoading: false,
    leaguesError: null,
    selectedLeagueId: 'l_4WFCIZ',
    setSelectedLeague: vi.fn(),
    season: '2026/2027',
    matches: list,
    matchesLoading: false,
    matchesError: null,
    stale: false,
    fetchedAt: null,
    reload: vi.fn(),
    allMatches: list,
    teams: catalogue,
    leagueTeams: catalogue,
    matchesForLeague: () => list,
    leagueName: () => 'Premier League',
    seasonsForLeague: () => ['2026/2027'],
    setSelectedSeason: vi.fn(),
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  transport.api.mockReset();
  transport.rpc.mockReset();
  transport.api.mockResolvedValue({ payload: { data: [] }, stale: false });
  transport.rpc.mockResolvedValue([]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(
  teamId: string | null,
  data = dataFor(),
  onOpenMatch = vi.fn(),
  onSelectTeam = vi.fn(),
) {
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <TeamView
          teamId={teamId}
          data={data}
          onSelectTeam={onSelectTeam}
          onOpenMatch={onOpenMatch}
        />
      </FavoritesProvider>,
    ),
  );
  return { onOpenMatch, onSelectTeam };
}

function tab(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (entry) => entry.textContent?.trim() === name,
  );
  if (!found) throw new Error(`Tab missing: ${name}`);
  return found;
}

async function chooseRival(label: string) {
  const input = host.querySelector<HTMLInputElement>('[role="combobox"][aria-label="Соперник"]');
  if (!input) throw new Error('Rival combobox missing');
  await act(async () => input.focus());
  const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!option) throw new Error(`Rival option missing: ${label}`);
  await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

it('shows a compact header with the place, the last result and the next match', async () => {
  await render('arsenal');
  expect(host.querySelector('.ui-page-title')?.textContent).toBe('Arsenal');
  expect(host.textContent).toContain('Premier League · 1-е место');
  const snapshots = [...host.querySelectorAll('.club-snapshot')];
  expect(snapshots[0]?.textContent).toContain('Последний матч');
  expect(snapshots[0]?.textContent).toContain('Arsenal');
  expect(snapshots[0]?.textContent).toContain('2 : 1');
  expect(snapshots[0]?.textContent).toContain('W');
  expect(snapshots[1]?.textContent).toContain('Следующий матч');
  expect(snapshots[1]?.textContent).toContain('Chelsea');
  expect(host.querySelector('.club-stat-grid')?.textContent).toContain('W–D–L по завершённым');
  expect(host.querySelector('.club-stat-grid')?.textContent).toContain('1–1–0');
  expect(host.querySelectorAll('.club-overview .ui-match-row')).toHaveLength(0);
});

it('opens a header match without changing its saved tab', async () => {
  viewState.write('match.old-win.tab', 'analysis');
  const { onOpenMatch } = await render('arsenal');
  const row = host.querySelector<HTMLButtonElement>('.club-snapshot .ui-match-row')!;
  await act(async () => row.click());
  expect(viewState.read('match.old-win.tab', '')).toBe('analysis');
  expect(onOpenMatch).toHaveBeenCalledWith('old-win');
});

it('shows one form of the last ten results without promising a count', async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    ...matches[0]!,
    id: `form-${index}`,
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
  }));
  await render('arsenal', dataFor(many));
  const form = host.querySelector('.club-form-tile')!;
  expect(form.textContent).toContain('Форма');
  expect(form.textContent).not.toContain('последних');
  expect(form.querySelectorAll('.ui-badge')).toHaveLength(10);
});

it('remembers the open tab per club and migrates an old section name', async () => {
  viewState.write('club.arsenal.tab', 'schedule');
  await render('arsenal');
  expect(tab('Матчи').getAttribute('aria-selected')).toBe('true');
  await act(async () => tab('Обзор').click());
  expect(viewState.read('club.arsenal.tab', '')).toBe('overview');
  viewState.write('club.arsenal.tab', 'players');
  await render('arsenal');
  expect(tab('Состав').getAttribute('aria-selected')).toBe('true');
});

it('masks a spoiled result and its badge in the header and the season list', async () => {
  localStorage.setItem(
    'sportsdesk.view.spoilers',
    JSON.stringify({
      version: 1,
      items: [{ kind: 'football', id: 'old-win', addedAt: new Date().toISOString() }],
    }),
  );
  await render('arsenal');
  const snapshot = host.querySelectorAll('.club-snapshot')[0]!;
  expect(snapshot.textContent).toContain('? : ?');
  expect(snapshot.querySelectorAll('.ui-badge')).toHaveLength(0);
  expect(host.querySelector('.club-form-tile')).toBeNull();
  await act(async () => tab('Матчи').click());
  expect(host.querySelector('.club-matches')?.textContent).toContain('? : ?');
});

it('collapses a long squad list under «Показать все»', async () => {
  transport.api.mockImplementation(async (_source: string, path: string) => {
    if (path.endsWith('/lineups')) {
      return {
        payload: {
          data: {
            match_id: 'collapse-match',
            home_team: arsenal,
            away_team: chelsea,
            home: {
              starters: [
                { player_id: 'one', name: 'One', position_id: 1 },
                { player_id: 'two', name: 'Two', position_id: 2 },
                { player_id: 'three', name: 'Three', position_id: 3 },
                { player_id: 'four', name: 'Four', position_id: 4 },
              ],
              subs: [],
            },
            away: { starters: [], subs: [] },
          },
        },
        stale: false,
      };
    }
    return { payload: { data: [] }, stale: false };
  });
  const collapseMatch = { ...matches[0]!, id: 'collapse-match' };
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <ClubPlayers
          team={{ id: 'arsenal', name: 'Arsenal' }}
          matches={[collapseMatch]}
          onOpenMatch={vi.fn()}
          groupBy="position"
          visibleLimit={2}
        />
      </FavoritesProvider>,
    ),
  );
  await act(async () => {});
  expect(host.querySelectorAll('.squad-player')).toHaveLength(2);
  const more = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Показать все',
  );
  expect(more).toBeTruthy();
  await act(async () => more!.click());
  expect(host.querySelectorAll('.squad-player')).toHaveLength(4);
});

it('keeps the points progression from the local history', async () => {
  transport.rpc.mockImplementation(async (command: string) =>
    command === 'history_season_matches'
      ? [
          { ...storedMatch, id: 'points-1', date: '2026-09-01' },
          {
            ...storedMatch,
            id: 'points-2',
            date: '2026-09-08',
            homeId: 'everton',
            homeName: 'Everton',
            awayId: 'arsenal',
            awayName: 'Arsenal',
            homeScore: 1,
            awayScore: 1,
          },
        ]
      : [],
  );
  await render('arsenal');
  await act(async () => {});
  expect(host.textContent).toContain('Ход очков');
  expect(host.textContent).toContain('4 очка после 2 матчей');
});

it('loads the points of the season selected for the club league', async () => {
  const data = { ...dataFor(), season: '2025/2026' };
  await render('arsenal', data);
  await act(async () => {});
  expect(transport.rpc).toHaveBeenCalledWith('history_season_matches', {
    leagueId: 'l_4WFCIZ',
    season: '2025/2026',
  });
});

it('groups the season by month and opens a match through «Разбор»', async () => {
  const { onOpenMatch } = await render('arsenal');
  await act(async () => tab('Матчи').click());
  expect(
    [...host.querySelectorAll('.club-matches .match-list__heading')].map(
      (heading) => heading.textContent,
    ),
  ).toEqual(['Ноябрь 2026', 'Декабрь 2026', 'Октябрь 2026']);
  expect(host.querySelectorAll('.club-matches .ui-match-row')).toHaveLength(4);
  const analysis = host.querySelector<HTMLButtonElement>(
    '.club-matches button[aria-label="Разбор матча: Arsenal — Chelsea"]',
  )!;
  await act(async () => analysis.click());
  expect(viewState.read('match.old-win.tab', '')).toBe('stats');
  expect(onOpenMatch).toHaveBeenCalledWith('old-win');
});

it('groups the squad by position and expands a long list', async () => {
  transport.api.mockImplementation(async (_source: string, path: string) => {
    if (path.endsWith('/lineups')) {
      return {
        payload: {
          data: {
            match_id: 'old-win',
            home_team: arsenal,
            away_team: chelsea,
            home: {
              starters: [
                { player_id: 'gk', name: 'Goalkeeper', position_id: 1 },
                { player_id: 'df', name: 'Defender', position_id: 2 },
                { player_id: 'mf', name: 'Midfielder', position_id: 3 },
              ],
              subs: [{ player_id: 'fw', name: 'Forward', position_id: 4 }],
            },
            away: { starters: [], subs: [] },
          },
        },
        stale: false,
      };
    }
    return { payload: { data: [] }, stale: false };
  });
  const squadMatches = matches.map((match) =>
    match.id === 'old-win' ? { ...match, id: 'squad-match' } : match,
  );
  await render('arsenal', dataFor(squadMatches));
  await act(async () => tab('Состав').click());
  await act(async () => {});
  expect(
    [...host.querySelectorAll('.squad-position-title')].map((title) => title.textContent),
  ).toEqual(['Вратари1', 'Защитники1', 'Полузащитники1', 'Нападающие1']);
  expect(host.querySelectorAll('.club-players .squad-player')).toHaveLength(4);
});

it('shows head-to-head numbers and matches after choosing a rival', async () => {
  transport.rpc.mockImplementation(async (command: string) =>
    command === 'history_head_to_head' ? [storedMatch] : [],
  );
  await render('arsenal');
  await act(async () => tab('Личные встречи').click());
  await chooseRival('Chelsea');
  await act(async () => {});
  expect(host.querySelector('.club-h2h')?.textContent).toContain('2 матча');
  expect(host.querySelector('.club-stat-grid')?.textContent).toContain('Победы');
  expect(host.querySelector('.club-h2h__list')?.textContent).toContain('Arsenal');
  expect(host.querySelector('.club-h2h__list')?.textContent).toContain('Chelsea');
  expect(host.querySelectorAll('.club-h2h__list .ui-match-row')).toHaveLength(2);
});

it('adds this season to head-to-head and keeps a match that is in both sources once', async () => {
  const current = {
    ...storedMatch,
    id: 'stored-current',
    date: '2026-10-20',
    homeScore: 2,
    awayScore: 1,
  };
  const older = {
    ...storedMatch,
    id: 'stored-older',
    date: '2026-02-14',
    homeScore: 2,
    awayScore: 1,
  };
  transport.rpc.mockImplementation(async (command: string) =>
    command === 'history_head_to_head' ? [current, older] : [],
  );
  await render('arsenal');
  await act(async () => tab('Личные встречи').click());
  await chooseRival('Chelsea');
  await act(async () => {});
  expect(host.querySelectorAll('.club-h2h__list .ui-match-row')).toHaveLength(2);
  expect(host.querySelector('.club-h2h')?.textContent).toContain('2 матча');
  expect(host.querySelector('.club-h2h')?.textContent).toContain('4 : 2');
});

it('opens the club directory on the favourites and hides empty numbers', async () => {
  localStorage.setItem(
    STORAGE_KEYS.favoritesTeams,
    JSON.stringify({ ids: ['arsenal'], seededDefault: true }),
  );
  const { onSelectTeam } = await render(null);
  expect(host.querySelector('.ui-page-title')?.textContent).toBe('Клубы');
  const favorite = host.querySelector<HTMLButtonElement>('.team-favorites button')!;
  expect(favorite.textContent).toContain('Arsenal');
  await act(async () => favorite.click());
  expect(onSelectTeam).toHaveBeenCalledWith('arsenal');

  localStorage.removeItem(STORAGE_KEYS.favoritesTeams);
  const empty = { ...dataFor([]), teams: [], leagueTeams: [] };
  await render(null, empty);
  expect(host.textContent).toContain('Пока нет избранных клубов');
  expect(host.textContent).toContain('Каталог клубов пуст');

  await render('arsenal', dataFor([]));
  expect(host.querySelectorAll('.ui-stat')).toHaveLength(0);
});
