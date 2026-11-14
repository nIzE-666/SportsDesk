// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import type { TodayMode } from '../../lib/navigation';
import { DEFAULT_FAVORITE_TEAM_NAMES } from '../../lib/sportsIdentity';
import { WatchActionContext, type WatchIntent } from '../../lib/watchIntent';
import { rpc } from '../../lib/bridge';
import { STORAGE_KEYS } from '../football/storage';
import { clubKey } from '../football/clubNames';
import type { LiveMatch } from '../football/liveSources';
import type { MatchSummary } from '../football/types';
import type { UseFootballResult } from '../football/useFootballData';
import type { JolpicaRace } from '../f1/types';
import { PRIORITIES_KEY } from './todayData';
import { TodayView, type TodayViewProps } from './TodayView';

vi.mock('../../lib/bridge', () => ({
  rpc: vi.fn(),
  isTauriRuntime: () => false,
  api: vi.fn(),
}));

const state = vi.hoisted(() => ({
  football: null as unknown as UseFootballResult,
  live: {
    matches: [] as LiveMatch[],
    source: 'livescore' as 'livescore' | 'espn' | null,
    fetchedAt: null as string | null,
    stale: false,
    loading: false,
    refreshing: false,
    error: null as string | null,
    refresh: () => undefined,
  },
  schedule: {
    data: { season: '2026' as string | null, races: [] as JolpicaRace[] },
    loading: false,
    error: null as string | null,
    source: 'jolpica',
    fetchedAt: null as string | null,
    stale: false,
    reload: () => undefined,
  },
  f1Teams: [] as string[],
}));

vi.mock('../football/useFootballData', () => ({
  useFootballData: () => state.football,
}));
vi.mock('../football/liveData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../football/liveData')>();
  return { ...actual, useLiveMatches: () => state.live };
});
vi.mock('../f1/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../f1/api')>();
  return { ...actual, useApiResource: () => state.schedule };
});
vi.mock('../f1/useFavorites', () => ({
  useFavoriteTeams: () => [state.f1Teams, vi.fn()],
  useFavoriteDrivers: () => [[], vi.fn()],
}));
vi.mock('../planner/ViewingPlanner', () => ({
  ViewingPlanner: () => <div className="viewing-planner-stub">План</div>,
}));

const NOW = Date.parse('2026-11-10T09:00:00Z');
const leagueId = 'l_4WFCIZ';
const team = (id: string, name: string) => ({ id, name });
const clubOne = { id: 'club-one', name: 'Club One' };
const clubTwo = { id: 'club-two', name: 'Club Two' };

function match(
  id: string,
  status: string,
  home: { id: string; name: string },
  away: { id: string; name: string },
  scoreHome: number | null,
  scoreAway: number | null,
  time: string,
): MatchSummary {
  return {
    id,
    status,
    home_team: home,
    away_team: away,
    score_home: scoreHome,
    score_away: scoreAway,
    time_utc: time,
    date: time.slice(0, 10),
  };
}

function footballData(matches: MatchSummary[] = []): UseFootballResult {
  const teams = [clubOne, clubTwo].map((entry) => ({
    ...entry,
    leagueId,
    leagueName: 'Premier League',
  }));
  return {
    leagues: [{ id: leagueId, name: 'Premier League', season: '2026/27', seasons: ['2026/27'] }],
    leaguesLoading: false,
    leaguesError: null,
    selectedLeagueId: leagueId,
    setSelectedLeague: vi.fn(),
    season: '2026/27',
    matches,
    matchesLoading: false,
    matchesError: null,
    stale: false,
    fetchedAt: '2026-11-10T08:00:00Z',
    reload: vi.fn(),
    allMatches: matches,
    teams,
    leagueTeams: teams,
    matchesForLeague: (id: string) => (id === leagueId ? matches : []),
    leagueName: () => 'Premier League',
    seasonsForLeague: () => ['2026/27'],
    setSelectedSeason: vi.fn(),
  };
}

function follow(ids: string[] = ['club-one'], f1Teams: string[] = ['mercedes']) {
  localStorage.setItem(
    STORAGE_KEYS.favoritesTeams,
    JSON.stringify({
      ids,
      seeded: [],
      seededDefault: true,
      dismissed: [...DEFAULT_FAVORITE_TEAM_NAMES],
    }),
  );
  localStorage.setItem(
    STORAGE_KEYS.catalogue,
    JSON.stringify([
      { id: 'club-one', name: 'Club One', leagueId, leagueName: 'Premier League' },
      { id: 'club-two', name: 'Club Two', leagueId, leagueName: 'Premier League' },
    ]),
  );
  state.f1Teams = f1Teams;
}

const liveMatch = (overrides: Partial<LiveMatch> = {}): LiveMatch => ({
  id: 'live-1',
  source: 'livescore',
  leagueId,
  competition: 'Premier League',
  home: { name: 'Club One', clubKey: clubKey('Club One') },
  away: { name: 'Club Two', clubKey: clubKey('Club Two') },
  kickoffUtc: '2026-11-10T08:55:00Z',
  state: 'live',
  minute: "67'",
  score: { home: 2, away: 1 },
  ...overrides,
});

const catchUp = (count = 2) => ({
  from: Date.parse('2026-11-08T00:00:00Z'),
  to: Date.parse('2026-11-10T00:00:00Z'),
  truncated: false,
  footballIncomplete: false,
  f1Incomplete: false,
  items: Array.from({ length: count }, (_, index) => ({
    id: `football|end|old-${index}`,
    sport: 'football',
    kind: 'end',
    title: 'Матч завершён',
    body: `Club One ${index + 1} : 0 Club Two`,
    occurredAt: Date.parse('2026-11-09T12:00:00Z'),
    read: false,
    matchId: `old-${index}`,
  })),
});

let host: HTMLDivElement;
let root: Root;
let onModeChange: Mock<(mode: TodayMode) => void>;
let onOpenMatch: Mock<(matchId: string, leagueId?: string) => void>;
let onOpenTeam: Mock<(teamId: string, teamName?: string, leagueId?: string) => void>;
let onOpenWeekend: Mock<(race: JolpicaRace) => void>;
let onOpenF1: Mock<() => void>;
let openWatch: Mock<(intent: WatchIntent) => void>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  state.football = footballData();
  state.live = {
    matches: [],
    source: 'livescore',
    fetchedAt: '2026-11-10T08:00:00Z',
    stale: false,
    loading: false,
    refreshing: false,
    error: null,
    refresh: () => undefined,
  };
  state.schedule = {
    data: { season: '2026', races: [] },
    loading: false,
    error: null,
    source: 'jolpica',
    fetchedAt: '2026-11-10T08:00:00Z',
    stale: false,
    reload: () => undefined,
  };
  state.f1Teams = [];
  vi.mocked(rpc).mockReset();
  onModeChange = vi.fn();
  onOpenMatch = vi.fn();
  onOpenTeam = vi.fn();
  onOpenWeekend = vi.fn();
  onOpenF1 = vi.fn();
  openWatch = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function render(props: Partial<TodayViewProps> = {}) {
  const merged: TodayViewProps = {
    mode: 'today',
    onModeChange,
    onOpenMatch,
    onOpenTeam,
    onOpenWeekend,
    onOpenF1,
    ...props,
  };
  await act(async () =>
    root.render(
      <WatchActionContext.Provider value={openWatch}>
        <TodayView {...merged} />
      </WatchActionContext.Provider>,
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const blockIds = () =>
  [...host.querySelectorAll<HTMLElement>('[data-block]')].map((item) => item.dataset.block);

it('shows only the blocks with content in the planned order', async () => {
  follow(['club-one']);
  vi.mocked(rpc).mockResolvedValue(catchUp(2));
  const finished = match('old', 'finished', clubOne, clubTwo, 2, 1, '2026-11-09T12:00:00Z');
  const next = match('next', 'scheduled', clubOne, clubTwo, null, null, '2026-11-11T12:00:00Z');
  const pitchLive = match('live-pitch', 'live', clubOne, clubTwo, 2, 1, '2026-11-10T08:55:00Z');
  state.football = footballData([finished, next, pitchLive]);
  state.live.matches = [liveMatch()];
  await render();

  expect(blockIds()).toEqual(['catchup', 'live', 'upcoming', 'teams']);
  expect(host.textContent).toContain('Пока вас не было · 2');
  expect(host.querySelector('.today-block h2')?.textContent?.trim()).toBe('Пока вас не было · 2');
});

it('hides every empty block instead of showing a heading', async () => {
  follow([], []);
  vi.mocked(rpc).mockResolvedValue(null);
  await render();
  expect(blockIds()).toEqual([]);
  expect(host.textContent).not.toContain('Пока вас не было');
  expect(host.textContent).not.toContain('Сейчас');
  expect(host.textContent).not.toContain('Ближайшее');
  expect(host.textContent).not.toContain('Мои команды');
});

it('shows live minute, score and competition, and opens only a known PitchAPI match', async () => {
  follow(['club-one']);
  vi.mocked(rpc).mockResolvedValue(null);
  const pitchLive = match('live-pitch', 'live', clubOne, clubTwo, 2, 1, '2026-11-10T08:55:00Z');
  state.football = footballData([pitchLive]);
  state.live.matches = [liveMatch()];
  await render();

  expect(host.textContent).toContain("67'");
  expect(host.textContent).toContain('2 : 1');
  expect(host.textContent).toContain('Premier League');
  const open = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Открыть',
  );
  expect(open).toBeDefined();
  await act(async () => open!.click());
  expect(onOpenMatch).toHaveBeenCalledWith('live-pitch', leagueId);

  state.live.matches = [
    liveMatch({
      id: 'unknown-live',
      home: { name: 'Other One', clubKey: clubKey('Other One') },
      away: { name: 'Other Two', clubKey: clubKey('Other Two') },
    }),
  ];
  await render();
  expect(
    [...host.querySelectorAll('button')].some((button) => button.textContent === 'Открыть'),
  ).toBe(false);
});

it('shows «Смотреть» only while the watch module is on, and «Перерыв» for HT', async () => {
  follow(['club-one']);
  vi.mocked(rpc).mockResolvedValue(null);
  state.football = footballData();
  state.live.matches = [liveMatch({ minute: 'HT' })];
  await render();
  expect(host.textContent).toContain('Перерыв');
  expect(
    [...host.querySelectorAll('button')].some((button) => button.textContent === 'Смотреть'),
  ).toBe(true);
  const watch = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Смотреть',
  );
  await act(async () => watch!.click());
  expect(openWatch).toHaveBeenCalledWith({
    sport: 'football',
    key: 'live-1',
    title: 'Club One — Club Two',
  });

  localStorage.setItem(
    'sportsdesk.modules',
    JSON.stringify({ version: 1, modules: { watch: false } }),
  );
  await render();
  expect(
    [...host.querySelectorAll('button')].some((button) => button.textContent === 'Смотреть'),
  ).toBe(false);
});

it('shows the next events with «через N дней» and keeps the planner marks', async () => {
  follow(['club-one']);
  vi.mocked(rpc).mockResolvedValue(null);
  const far = match('far', 'scheduled', clubOne, clubTwo, null, null, '2026-11-15T12:00:00Z');
  localStorage.setItem(PRIORITIES_KEY, JSON.stringify(['football:far']));
  state.football = footballData([far]);
  await render();

  expect(host.textContent).toContain('Ближайшие события — через 5 дней');
  expect(host.textContent).toContain('Club One — Club Two');
  expect(
    [...host.querySelectorAll('button')].some((button) => button.textContent === 'В плане'),
  ).toBe(true);

  const toggle = [...host.querySelectorAll('button')].find((button) =>
    button.getAttribute('aria-label')?.startsWith('Убрать из плана'),
  );
  await act(async () => toggle!.click());
  expect(JSON.parse(localStorage.getItem(PRIORITIES_KEY) ?? '[]')).toEqual([]);
});

it('builds club tiles from results and opens the club page, with a Formula 1 tile', async () => {
  follow(['club-one'], ['mercedes']);
  vi.mocked(rpc).mockResolvedValue(null);
  const finished = match('old', 'finished', clubOne, clubTwo, 2, 1, '2026-11-09T12:00:00Z');
  const next = match('next', 'scheduled', clubTwo, clubOne, null, null, '2026-11-12T12:00:00Z');
  state.football = footballData([finished, next]);
  await render();

  const tiles = [...host.querySelectorAll<HTMLButtonElement>('.today-team-tile')];
  expect(tiles).toHaveLength(2);
  expect(tiles[0]?.textContent).toContain('Club One');
  expect(tiles[0]?.textContent).toContain('1-е');
  expect(tiles[0]?.textContent).toContain('2:1');
  expect(tiles[0]?.textContent).toContain('Club Two');
  await act(async () => tiles[0]!.click());
  expect(onOpenTeam).toHaveBeenCalledWith('club-one', 'Club One', leagueId);

  expect(tiles[1]?.textContent).toContain('Mercedes');
  await act(async () => tiles[1]!.click());
  expect(onOpenF1).toHaveBeenCalled();
});

it('hides a result in spoiler mode', async () => {
  follow(['club-one']);
  vi.mocked(rpc).mockResolvedValue(null);
  const finished = match('old', 'finished', clubOne, clubTwo, 2, 1, '2026-11-09T12:00:00Z');
  localStorage.setItem(
    'sportsdesk.view.spoilers',
    JSON.stringify({
      version: 1,
      items: [
        {
          kind: 'football',
          id: 'old',
          addedAt: '2026-11-09T00:00:00Z',
          eventTime: '2026-11-09T12:00:00Z',
        },
      ],
    }),
  );
  state.football = footballData([finished]);
  await render();
  const tile = host.querySelector('.today-team-tile');
  expect(tile?.textContent).toContain('? : ?');
  expect(tile?.textContent).not.toContain('2:1');
});

it('renders the week grouped by day and the planner as the third mode', async () => {
  follow(['club-one']);
  vi.mocked(rpc).mockResolvedValue(null);
  state.football = footballData([
    match('one', 'scheduled', clubOne, clubTwo, null, null, '2026-11-11T12:00:00Z'),
    match('two', 'scheduled', clubTwo, clubOne, null, null, '2026-11-12T12:00:00Z'),
  ]);
  await render({ mode: 'week' });
  expect(host.querySelectorAll('.today-week-day')).toHaveLength(2);
  expect(host.textContent).toContain('завтра');
  expect(host.textContent).toContain('чт, 12 нояб.');
  expect(blockIds()).toEqual([]);

  await render({ mode: 'plan' });
  expect(host.querySelector('.viewing-planner-stub')).not.toBeNull();
});

it('opens the block editor and hides a block through the same storage key', async () => {
  follow(['club-one'], ['mercedes']);
  vi.mocked(rpc).mockResolvedValue(null);
  state.live.matches = [liveMatch()];
  await render();
  const settings = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Настроить',
  );
  await act(async () => settings!.click());
  expect(host.textContent).toContain('Блоки «Сегодня»');

  const hide = host.querySelector<HTMLButtonElement>('button[aria-label="Скрыть: Сейчас"]');
  await act(async () => hide!.click());
  expect(blockIds()).not.toContain('live');
  expect(localStorage.getItem('sportsdesk.view.home.layout')).toContain('"live"');
});

it('shows its own mode switch in the old frame and reports the choice', async () => {
  follow([], []);
  vi.mocked(rpc).mockResolvedValue(null);
  await render({ mode: 'today', showModeSwitch: true });
  const tabs = [...host.querySelectorAll('[role="tab"]')];
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Сегодня', 'Неделя', 'Мой план']);
  expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  await act(async () => (tabs[1] as HTMLButtonElement).click());
  expect(onModeChange).toHaveBeenCalledWith('week');
});
