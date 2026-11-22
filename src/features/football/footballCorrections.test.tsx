// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FavoritesProvider } from './FavoritesProvider';
import { MatchDetailView } from './MatchDetailView';
import { MatchesView } from './MatchesView';
import { TeamView } from './TeamView';
import { StandingsView } from './StandingsView';
import type { MatchSummary } from './types';
import type { UseFootballResult } from './useFootballData';
import { viewState } from '../../lib/viewState';
import { STORAGE_KEYS } from './storage';

const tauriListeners = vi.hoisted(
  () => new Map<string, Array<(event: { payload: unknown }) => void>>(),
);
const transport = vi.hoisted(() => ({
  api: vi.fn(),
  rpc: vi.fn(),
  isTauriRuntime: vi.fn(() => false),
}));
vi.mock('../../lib/bridge', () => transport);
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    const list = tauriListeners.get(eventName) ?? [];
    list.push(handler);
    tauriListeners.set(eventName, list);
    return () => {
      const current = tauriListeners.get(eventName) ?? [];
      tauriListeners.set(
        eventName,
        current.filter((item) => item !== handler),
      );
    };
  }),
}));

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
  transport.isTauriRuntime.mockReturnValue(false);
  tauriListeners.clear();
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
  expect(host.querySelector('.ui-page-title')?.textContent).toBe('Клубы');
  const favorite = host.querySelector<HTMLButtonElement>('.team-favorites button')!;
  expect(favorite.textContent).toContain('Atlético F.C.');
  expect(host.querySelector('[role="combobox"][aria-label="Клуб"]')).not.toBeNull();
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

it('finds a team through the searchable filter regardless of case', async () => {
  await render(
    <FavoritesProvider>
      <MatchesView
        data={makeData([makeMatch('scheduled', 'scheduled', '2099-01-01T12:00:00Z')])}
        onOpenMatch={vi.fn()}
      />
    </FavoritesProvider>,
  );
  const input = host.querySelector<HTMLInputElement>('[role="combobox"][aria-label="Команда"]')!;
  await act(async () => input.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'ATLETICO',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (entry) => entry.textContent?.trim() === 'Atlético F.C.',
  );
  expect(option).toBeTruthy();
  await act(async () => option!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.querySelector('[data-match-id="scheduled"]')).not.toBeNull();
});

it('shows the whole season with month headings and every status', async () => {
  const fixtures = [
    makeMatch('scheduled', 'scheduled', '2099-01-02T12:00:00Z'),
    makeMatch('live', 'live', '2099-01-03T12:00:00Z'),
    makeMatch('cancelled', 'cancelled', '2099-01-04T12:00:00Z'),
    makeMatch('postponed', 'postponed', '2099-01-05T12:00:00Z'),
  ];
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
  const matchTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (tab) => tab.textContent?.trim() === 'Матчи',
  )!;
  await act(async () => matchTab.click());
  const schedule = host.querySelector('.club-matches')!;
  expect(schedule.textContent).toContain('Январь 2099');
  expect(schedule.textContent).toContain('В игре');
  expect(schedule.textContent).toContain('Отменён');
  expect(schedule.textContent).toContain('Перенесён');
  expect(transport.rpc).toHaveBeenCalledWith('history_season_matches', {
    leagueId: 'league',
    season: '2099',
  });
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

it('refreshes players on manual refresh, does not refetch detail or events on tab switch, and supports finished status aliases in overview', async () => {
  const calls: string[] = [];
  transport.api.mockImplementation(async (_source: string, path: string) => {
    calls.push(path);
    const fetchedAt = '2026-11-22T12:00:00Z';
    if (path === 'matches/m1') {
      return {
        payload: {
          data: {
            id: 'm1',
            home_team: home,
            away_team: { id: 'away-m1', name: 'Opponent m1' },
            score_home: 2,
            score_away: 1,
            status: 'FT',
            date: '2026-11-22',
            time_utc: '2026-11-22T10:00:00Z',
          },
        },
        fetchedAt,
        stale: false,
      };
    }
    if (path.endsWith('/events')) {
      return {
        payload: {
          data: {
            events: [
              {
                event_type: 'goal',
                minute: 23,
                team_id: 'home',
                player: { id: 'p1', name: 'Griezmann' },
                score_home: 1,
                score_away: 0,
              },
            ],
          },
        },
        fetchedAt,
        stale: false,
      };
    }
    if (path.endsWith('/lineups'))
      return { payload: { data: { home: [], away: [] } }, fetchedAt, stale: false };
    if (path.endsWith('/players')) return { payload: { data: [] }, fetchedAt, stale: false };
    if (path.endsWith('/stats'))
      return { payload: { data: { periods: [] } }, fetchedAt, stale: false };
    return { payload: { data: [] }, fetchedAt, stale: false };
  });

  await render(<MatchDetailView matchId="m1" />);
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

  // Status alias "FT" is classified as finished in the overview summary:
  expect(host.querySelector('.md-summary')?.textContent).toContain(
    'Atlético F.C. — Opponent m1, счёт 2:1.',
  );
  expect(host.querySelector('.md-summary')?.textContent).toContain('Голы: 23′ Griezmann.');

  // Switch to «Составы» and trigger manual refresh:
  const lineupsTab = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.includes('Составы'),
  )!;
  await act(async () => lineupsTab.click());
  calls.length = 0;

  const refreshBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Обновить данные"]')!;
  await act(async () => refreshBtn.click());
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

  expect(calls).toContain('matches/m1');
  expect(calls).toContain('matches/m1/lineups');
  expect(calls).toContain('matches/m1/players');

  // Switching tabs after a manual refresh must not re-request match detail or events:
  calls.length = 0;
  const statsTab = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.includes('Статистика'),
  )!;
  await act(async () => statsTab.click());
  const overviewTab = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.includes('Обзор'),
  )!;
  await act(async () => overviewTab.click());
  expect(calls).not.toContain('matches/m1');
  expect(calls).not.toContain('matches/m1/events');

  // Switching tabs while a manual detail refresh is in flight does not cancel the in-flight detail request:
  let resolveInFlightDetail: ((value: unknown) => void) | null = null;
  transport.api.mockImplementation(
    async (_source: string, path: string, options?: { automatic?: boolean }) => {
      const fetchedAt = '2026-11-22T12:02:00Z';
      if (path === 'matches/m1' && options && 'automatic' in options) {
        return new Promise((resolve) => {
          resolveInFlightDetail = resolve;
        });
      }
      return {
        payload: { data: path.endsWith('/events') ? { events: [] } : [] },
        fetchedAt,
        stale: false,
      };
    },
  );
  await act(async () => refreshBtn.click());
  expect(resolveInFlightDetail).toBeTypeOf('function');
  // Switch tab while matches/m1 refresh is in flight:
  await act(async () => statsTab.click());
  await act(async () => {
    resolveInFlightDetail?.({
      payload: {
        data: {
          id: 'm1',
          home_team: home,
          away_team: { id: 'away-m1', name: 'Opponent m1' },
          score_home: 4,
          score_away: 1,
          status: 'FT',
          date: '2026-11-22',
          time_utc: '2026-11-22T10:00:00Z',
        },
      },
      fetchedAt: '2026-11-22T12:03:00Z',
      stale: false,
    });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  expect(host.querySelector('.md-score')?.textContent).toContain('4 : 1');
  expect(
    host.querySelector<HTMLButtonElement>('button[aria-label="Обновить данные"]')?.disabled,
  ).toBe(false);

  // Navigating to match m2 while m1's manual refresh is in flight cancels m1's stale response and preserves m2's loaded state:
  let resolveStaleM1Refresh: ((value: unknown) => void) | null = null;
  transport.api.mockImplementation(
    async (_source: string, path: string, options?: { automatic?: boolean }) => {
      const fetchedAt = '2026-11-22T12:05:00Z';
      if (path === 'matches/m1' && options && 'automatic' in options) {
        return new Promise((resolve) => {
          resolveStaleM1Refresh = resolve;
        });
      }
      if (path === 'matches/m2') {
        return {
          payload: {
            data: {
              id: 'm2',
              home_team: { id: 'real', name: 'Real Madrid' },
              away_team: { id: 'barca', name: 'Barcelona' },
              score_home: 3,
              score_away: 2,
              status: 'Finished',
              date: '2026-11-22',
              time_utc: '2026-11-22T11:00:00Z',
            },
          },
          fetchedAt,
          stale: false,
        };
      }
      return {
        payload: { data: path.endsWith('/events') ? { events: [] } : [] },
        fetchedAt,
        stale: false,
      };
    },
  );

  await act(async () => refreshBtn.click());
  expect(resolveStaleM1Refresh).toBeTypeOf('function');

  // Navigate to m2 before m1's refresh resolves:
  await render(<MatchDetailView matchId="m2" />);
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  expect(host.querySelector('.md-header')?.textContent).toContain('Real Madrid');
  expect(host.querySelector('.md-summary')?.textContent).toContain(
    'Real Madrid — Barcelona, счёт 3:2.',
  );

  // Resolve the stale m1 refresh now; m2's loaded state must remain intact:
  await act(async () => {
    resolveStaleM1Refresh?.({
      payload: {
        data: {
          id: 'm1',
          home_team: home,
          away_team: { id: 'away-m1', name: 'Opponent m1' },
          score_home: 9,
          score_away: 9,
          status: 'FT',
        },
      },
      fetchedAt: '2026-11-22T12:06:00Z',
      stale: false,
    });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  expect(host.querySelector('.md-header')?.textContent).toContain('Real Madrid');
  expect(host.querySelector('.md-score')?.textContent).toContain('3 : 2');
});

it('serializes watch_match and unwatch_match across match lifetimes and filters match-update events by generation', async () => {
  transport.isTauriRuntime.mockReturnValue(true);
  transport.api.mockImplementation(async (_source: string, path: string) => {
    const fetchedAt = '2026-11-22T12:00:00Z';
    if (path === 'matches/mA' || path === 'matches/mB') {
      const id = path.slice('matches/'.length);
      return {
        payload: {
          data: {
            id,
            home_team: { id: `${id}-h`, name: `Home ${id}` },
            away_team: { id: `${id}-a`, name: `Away ${id}` },
            score_home: 1,
            score_away: 0,
            status: 'live',
            date: '2026-11-22',
            time_utc: '2026-11-22T11:30:00Z',
          },
        },
        fetchedAt,
        stale: false,
      };
    }
    return {
      payload: { data: path.endsWith('/events') ? { events: [] } : [] },
      fetchedAt,
      stale: false,
    };
  });

  const ipcCalls: Array<{ cmd: string; args?: unknown }> = [];
  let resolveWatchA: ((gen: number) => void) | null = null;
  let resolveUnwatchA: ((res: { ok: boolean }) => void) | null = null;
  let resolveWatchB: ((gen: number) => void) | null = null;
  let nextGen = 10;

  transport.rpc.mockImplementation((cmd: string, args?: unknown) => {
    ipcCalls.push({ cmd, args });
    if (
      cmd === 'watch_match' &&
      (args as { matchId?: string })?.matchId === 'mA' &&
      !resolveWatchA
    ) {
      return new Promise<number>((resolve) => {
        resolveWatchA = resolve;
      });
    }
    if (cmd === 'unwatch_match' && !resolveUnwatchA) {
      return new Promise<{ ok: boolean }>((resolve) => {
        resolveUnwatchA = resolve;
      });
    }
    if (
      cmd === 'watch_match' &&
      (args as { matchId?: string })?.matchId === 'mB' &&
      !resolveWatchB
    ) {
      return new Promise<number>((resolve) => {
        resolveWatchB = resolve;
      });
    }
    if (cmd === 'watch_match') {
      nextGen += 1;
      return Promise.resolve(nextGen);
    }
    return Promise.resolve({ ok: true });
  });

  // 1. Mount Match A -> watch_match(mA) starts and is slow (pending)
  await render(<MatchDetailView matchId="mA" />);
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  expect(ipcCalls).toEqual([{ cmd: 'watch_match', args: { matchId: 'mA' } }]);
  expect(tauriListeners.get('sportsdesk://match-update') ?? []).toHaveLength(0);

  // 2. Navigate to Match B before watch_match(mA) finishes:
  // unwatch_match() and watch_match(mB) must wait in the serialized queue behind watch_match(mA).
  await render(<MatchDetailView matchId="mB" />);
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  expect(ipcCalls).toEqual([{ cmd: 'watch_match', args: { matchId: 'mA' } }]);

  // 3. Resolve slow watch_match(mA) -> A must NOT subscribe since A unmounted, and unwatch_match() starts next:
  await act(async () => {
    resolveWatchA?.(1);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  expect(tauriListeners.get('sportsdesk://match-update') ?? []).toHaveLength(0);
  expect(ipcCalls).toEqual([
    { cmd: 'watch_match', args: { matchId: 'mA' } },
    { cmd: 'unwatch_match', args: undefined },
  ]);

  // 4. Resolve slow unwatch_match() for A -> watch_match(mB) starts next (cannot be disabled by A's slow unwatch):
  await act(async () => {
    resolveUnwatchA?.({ ok: true });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  expect(ipcCalls).toEqual([
    { cmd: 'watch_match', args: { matchId: 'mA' } },
    { cmd: 'unwatch_match', args: undefined },
    { cmd: 'watch_match', args: { matchId: 'mB' } },
  ]);
  expect(tauriListeners.get('sportsdesk://match-update') ?? []).toHaveLength(0);

  // 5. Resolve watch_match(mB) with generation 2 -> registers one initialized subscription for mounted Match B:
  await act(async () => {
    resolveWatchB?.(2);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  expect(tauriListeners.get('sportsdesk://match-update') ?? []).toHaveLength(1);

  // 6. Verify generation filtering and advancement on sportsdesk://match-update:
  const detailCallsForB = () =>
    transport.api.mock.calls.filter((call) => call[1] === 'matches/mB').length;
  const baselineCalls = detailCallsForB();

  const emitUpdate = async (payload: unknown) => {
    await act(async () => {
      for (const listener of tauriListeners.get('sportsdesk://match-update') ?? []) {
        listener({ payload });
      }
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
  };

  // Late event from older generation (1 < 2) or another match is ignored:
  await emitUpdate({ matchId: 'mB', fetchedAt: '2026-11-22T12:01:00Z', generation: 1 });
  await emitUpdate({ matchId: 'mA', fetchedAt: '2026-11-22T12:01:00Z', generation: 2 });
  expect(detailCallsForB()).toBe(baselineCalls);

  // Current generation (2) triggers refresh:
  await emitUpdate({ matchId: 'mB', fetchedAt: '2026-11-22T12:02:00Z', generation: 2 });
  expect(detailCallsForB()).toBe(baselineCalls + 1);

  // Advanced generation (3, e.g. after poller settings change) is accepted and advances minimum generation:
  await emitUpdate({ matchId: 'mB', fetchedAt: '2026-11-22T12:03:00Z', generation: 3 });
  expect(detailCallsForB()).toBe(baselineCalls + 2);

  // Late event from previous generation (2 < 3) is now ignored:
  await emitUpdate({ matchId: 'mB', fetchedAt: '2026-11-22T12:04:00Z', generation: 2 });
  expect(detailCallsForB()).toBe(baselineCalls + 2);

  // 7. Reopening the same match under StrictMode serializes unwatch/watch and keeps one active listener:
  ipcCalls.length = 0;
  await render(
    <StrictMode>
      <MatchDetailView matchId="mB" />
    </StrictMode>,
  );
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  expect(ipcCalls[0]).toEqual({ cmd: 'unwatch_match', args: undefined });
  expect(ipcCalls.at(-1)).toEqual({ cmd: 'watch_match', args: { matchId: 'mB' } });
  for (let i = 1; i < ipcCalls.length; i += 1) {
    expect(ipcCalls[i]?.cmd).not.toBe(ipcCalls[i - 1]?.cmd);
  }
  expect(tauriListeners.get('sportsdesk://match-update') ?? []).toHaveLength(1);
});
