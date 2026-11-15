// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeModules } from '../lib/modules';
import { WatchActionContext } from '../lib/watchIntent';
import { viewState } from '../lib/viewState';
import type { JolpicaRace } from './f1/types';
import { RaceWeekend } from './f1/RaceWeekend';
import { LivePanel } from './football/LivePanel';
import { MatchDetailView } from './football/MatchDetailView';
import { GamesView } from './games/GamesView';

const transport = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn(), isTauriRuntime: () => false }));
vi.mock('../lib/bridge', () => transport);

const detail = {
  id: 'm1',
  league: { id: 'l_4WFCIZ', name: 'Premier League' },
  season: '2026/2027',
  home_team: { id: 'arsenal', name: 'Arsenal' },
  away_team: { id: 'chelsea', name: 'Chelsea' },
  status: 'scheduled',
  time_utc: '2099-01-01T12:00:00Z',
  date: '2099-01-01',
  score_home: null,
  score_away: null,
};
const lineups = {
  match_id: 'm1',
  home_team: detail.home_team,
  away_team: detail.away_team,
  home: {
    formation: '4-3-3',
    confirmed: true,
    starters: [{ player_id: 'a', name: 'Alex Morgan', pitch_x: 0.1, pitch_y: 0.5 }],
    subs: [{ player_id: 'b', name: 'Sam Taylor' }],
  },
  away: {
    formation: '4-4-2',
    confirmed: true,
    starters: [{ player_id: 'c', name: 'Jamie Wilson', pitch_x: 0.1, pitch_y: 0.5 }],
    subs: [],
  },
};

const reply = (payload: unknown, source = 'pitch') => ({
  payload: { data: payload },
  source,
  fetchedAt: '2026-11-08T12:00:00.000Z',
  stale: false,
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  transport.api.mockReset();
  transport.rpc.mockReset();
  transport.rpc.mockResolvedValue(undefined);
  transport.api.mockImplementation(async (_source: string, path: string) => {
    if (path === 'matches/m1') return reply(detail);
    if (path === 'matches/m1/lineups') return reply(lineups);
    if (path.endsWith('/events')) return reply({ events: [] });
    if (path.endsWith('/players')) return reply([]);
    return reply({ periods: [] });
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

async function flush(rounds = 6) {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  });
}

async function renderMatch() {
  await act(async () =>
    root?.render(
      <WatchActionContext.Provider value={() => undefined}>
        <MatchDetailView matchId="m1" onBack={() => undefined} />
      </WatchActionContext.Provider>,
    ),
  );
  await flush();
  expect(host?.querySelector('.md-header')).not.toBeNull();
}

const button = (text: string) =>
  [...(host?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes(text)) as
    HTMLButtonElement | undefined;

describe('match page modules', () => {
  it('hides my prediction when predictions are off', async () => {
    await renderMatch();
    expect(button('Мой прогноз')).toBeDefined();
    await act(async () => writeModules({ predictions: false }));
    expect(button('Мой прогноз')).toBeUndefined();
    expect(button('Просмотрено')).toBeDefined();
  });

  it('hides the watch button when watch is off', async () => {
    await renderMatch();
    expect(button('Смотреть')).toBeDefined();
    await act(async () => writeModules({ watch: false }));
    expect(button('Смотреть')).toBeUndefined();
  });

  it('hides the diary mark when the diary is off', async () => {
    await renderMatch();
    expect(button('Просмотрено')).toBeDefined();
    await act(async () => writeModules({ diary: false }));
    expect(button('Просмотрено')).toBeUndefined();
  });

  it('hides the board button when tactics are off', async () => {
    await renderMatch();
    expect(button('Составы')).toBeDefined();
    await act(async () => button('Составы')?.click());
    await flush();
    expect(button('На доску')).toBeDefined();

    await act(async () => writeModules({ tactics: false }));
    expect(button('На доску')).toBeUndefined();
    expect(host?.textContent).toContain('Поле и оценки');
  });
});

describe('formula 1 weekend modules', () => {
  const race: JolpicaRace = {
    season: '2026',
    round: '1',
    raceName: 'Australian Grand Prix',
    date: '2099-01-01',
    time: '12:00:00Z',
    Circuit: { circuitId: 'test', circuitName: 'Circuit 1' },
  };

  it('hides the diary mark when the diary is off', async () => {
    transport.api.mockResolvedValue({
      payload: { MRData: { RaceTable: { Races: [] } } },
      source: 'jolpica',
      fetchedAt: '2026-11-08T12:00:00.000Z',
      stale: false,
    });
    await act(async () => root?.render(<RaceWeekend race={race} />));
    await flush();
    expect(button('Отметить просмотр гонки')).toBeDefined();
    await act(async () => writeModules({ diary: false }));
    expect(button('Отметить просмотр гонки')).toBeUndefined();
  });
});

describe('games page modules', () => {
  it('hides start lights when games are off but keeps the predictions', async () => {
    await act(async () => root?.render(<GamesView />));
    await flush();
    expect(button('Стартовые огни')).toBeDefined();

    await act(async () => writeModules({ games: false }));
    await flush();
    expect(button('Стартовые огни')).toBeUndefined();
    expect(button('Угадай счёт')).toBeDefined();
  });

  it('hides the predictions tab and the predictions themselves', async () => {
    await act(async () => root?.render(<GamesView />));
    await flush();
    expect(button('Угадай счёт')).toBeDefined();

    await act(async () => writeModules({ predictions: false }));
    await flush();
    expect(button('Угадай счёт')).toBeUndefined();
    expect(host?.querySelector('.predictions-game')).toBeNull();
  });
});

describe('live list modules', () => {
  const liveDay = {
    Stages: [
      {
        CompN: 'Premier League',
        CompD: 'England',
        Cnm: 'England',
        Events: [
          {
            Eid: 'pl',
            T1: [{ Nm: 'Arsenal' }],
            T2: [{ Nm: 'Chelsea' }],
            Eps: 'FT',
            Esd: 20261108200000,
            Tr1: '2',
            Tr2: '1',
          },
        ],
      },
      {
        CompN: 'Champions League',
        CompD: 'UEFA',
        Cnm: 'UEFA',
        Events: [
          {
            Eid: 'ucl',
            T1: [{ Nm: 'Real Madrid' }],
            T2: [{ Nm: 'Bayern' }],
            Eps: 'FT',
            Esd: 20261108203000,
            Tr1: '1',
            Tr2: '0',
          },
        ],
      },
    ],
  };

  it('shows only competitions whose switches are on', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    transport.api.mockResolvedValue({
      payload: liveDay,
      source: 'livescore',
      fetchedAt: '2026-11-08T12:00:00.000Z',
      stale: false,
    });
    await act(async () => root?.render(<LivePanel />));
    await act(async () => {});
    expect(host?.textContent).toContain('Лига чемпионов');
    expect(host?.textContent).toContain('Premier League');

    await act(async () => writeModules({ europe: false }));
    await act(async () => {});
    expect(host?.textContent).not.toContain('Лига чемпионов');
    expect(host?.textContent).toContain('Premier League');

    await act(async () => writeModules({ 'league.l_4WFCIZ': false }));
    await act(async () => {});
    expect(host?.textContent).not.toContain('Premier League');
    expect(host?.textContent).toContain('Нет матчей ваших клубов и турниров');
  });
});
