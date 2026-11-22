// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UpdateProvider } from '../features/settings/Updates';
import { CHAMPIONS_LEAGUE_ID, DEFAULT_CUP_ID, type ShellRoute } from '../lib/navigation';
import { __resetForTest, recordFailure, retainResource } from '../lib/resourceHealth';
import { viewState } from '../lib/viewState';
import { RouteContent } from './RouteContent';

vi.mock('../features/football/FootballView', () => ({
  FootballView: ({ leagueId }: { leagueId?: string }) => (
    <div data-testid="football-view" data-league-id={leagueId} />
  ),
}));
vi.mock('../features/football/MatchDetailView', () => ({
  MatchDetailView: ({
    matchId,
    seasonMatches,
    onBack,
    onOpenMatch,
  }: {
    matchId: string;
    seasonMatches?: Array<{ id: string }>;
    onBack?: () => void;
    onOpenMatch?: (id: string) => void;
  }) => (
    <div
      data-testid="match-detail-view"
      data-match-id={matchId}
      data-season-count={seasonMatches?.length ?? 0}
      data-has-back={Boolean(onBack)}
    >
      <button onClick={() => onOpenMatch?.('next-ucl-match')}>open-related</button>
    </div>
  ),
}));
vi.mock('../features/ucl/data', () => ({
  currentUclSeason: () => '2026/2027',
  fetchUclSeason: vi.fn(async () => ({
    matches: [
      {
        id: 'ucl-match-1',
        status: 'finished',
        home_team: { id: 'rm', name: 'Real Madrid' },
        away_team: { id: 'fcb', name: 'Bayern' },
        score_home: 2,
        score_away: 1,
      },
    ],
    seasons: ['2026/2027'],
    fetchedAt: '2026-11-22T12:00:00Z',
    stale: false,
  })),
  fetchUclStandings: vi.fn(),
  fetchUclPlayer: vi.fn(),
  fetchUclScorers: vi.fn(),
}));
vi.mock('../features/today/TodayView', () => ({
  TodayView: () => <div data-testid="today-view" />,
}));

let host: HTMLDivElement, root: Root;

const props = {
  route: { kind: 'football', competitionId: 'l_4WFCIZ', tab: 'matches' } as ShellRoute,
  sport: 'football' as const,
  leagueId: 'l_4WFCIZ',
  cupId: DEFAULT_CUP_ID,
  onNavigate: () => {},
  onLeagueChange: () => {},
  onOpenMatch: () => {},
  onOpenWeekend: () => {},
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  __resetForTest();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  __resetForTest();
});

it('opens the football screen without its own competition picker', async () => {
  await act(async () =>
    root.render(
      <UpdateProvider>
        <RouteContent {...props} />
      </UpdateProvider>,
    ),
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(host.querySelector('[data-testid="football-view"]')).not.toBeNull();
});

it('renders TournamentView with tournament seasonMatches and shell-controlled Back for a UCL or Cup football-match route without mounting FootballView', async () => {
  const onOpenMatch = vi.fn();
  await act(async () =>
    root.render(
      <UpdateProvider>
        <RouteContent
          {...props}
          onOpenMatch={onOpenMatch}
          route={{
            kind: 'football-match',
            matchId: 'ucl-match-1',
            competitionId: CHAMPIONS_LEAGUE_ID,
          }}
        />
      </UpdateProvider>,
    ),
  );
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  const detail = host.querySelector('[data-testid="match-detail-view"]');
  expect(detail?.getAttribute('data-match-id')).toBe('ucl-match-1');
  expect(detail?.getAttribute('data-season-count')).toBe('1');
  expect(detail?.getAttribute('data-has-back')).toBe('false');
  expect(host.querySelector('[data-testid="football-view"]')).toBeNull();

  await act(async () => {
    detail?.querySelector('button')?.click();
  });
  expect(onOpenMatch).toHaveBeenCalledWith('next-ucl-match', CHAMPIONS_LEAGUE_ID);
});

it('includes livescore in ConnectivityBanner sources on today and football routes', async () => {
  const release = retainResource('livescore', 'live/soccer/9?MD=1');
  recordFailure('livescore', 'live/soccer/9?MD=1', new Error('LiveScore error'));

  await act(async () =>
    root.render(
      <UpdateProvider>
        <RouteContent {...props} route={{ kind: 'today', mode: 'today' }} />
      </UpdateProvider>,
    ),
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(host.querySelector('.connectivity-banner')?.textContent).toContain(
    'Часть источников недоступна',
  );

  await act(async () =>
    root.render(
      <UpdateProvider>
        <RouteContent {...props} />
      </UpdateProvider>,
    ),
  );
  expect(host.querySelector('.connectivity-banner')?.textContent).toContain(
    'Часть источников недоступна',
  );
  await act(async () => release());
});
