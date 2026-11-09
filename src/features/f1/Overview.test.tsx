// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { Overview } from './Overview';

vi.mock('../../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/bridge')>()),
  api: vi.fn(),
}));
vi.mock('./SeasonContext', () => ({ useSeason: () => ({ year: 2026 }) }));
vi.mock('./useFavorites', () => ({
  useFavoriteDrivers: () => [[], vi.fn()],
  useFavoriteTeams: () => [[], vi.fn()],
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T14:59:45Z'));
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (_source, path) => {
    const race = (round: number, date: string) => ({
      season: '2026',
      round: String(round),
      raceName: `Race ${round}`,
      date,
      time: '12:00:00Z',
      Circuit: { circuitId: `circuit-${round}`, circuitName: `Circuit ${round}` },
    });
    const payload =
      path === '2026.json?limit=100'
        ? { MRData: { RaceTable: { Races: [race(1, '2026-10-25'), race(2, '2026-10-26')] } } }
        : path.includes('driverStandings') || path.includes('constructorStandings')
          ? { MRData: { StandingsTable: { StandingsLists: [] } } }
          : { MRData: { RaceTable: { Races: [] } } };
    return { source: 'jolpica', payload, fetchedAt: '2026-10-25T14:00:00Z', stale: false };
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it('advances the next and latest races on the clock and focus without refetching', async () => {
  await act(async () => root.render(<Overview />));
  expect(host.querySelector('.f1-card.hl')?.textContent).toContain('Race 1');
  expect(host.textContent).toContain('Нет завершённых гонок в сезоне');
  expect(api).toHaveBeenCalledTimes(4);

  await act(async () => vi.advanceTimersByTime(30_000));
  expect(host.querySelector('.f1-card.hl')?.textContent).toContain('Race 2');
  expect(host.textContent).toContain('Данные раунда 1 не получены');
  expect(api).toHaveBeenCalledTimes(4);

  await act(async () => {
    vi.setSystemTime(new Date('2026-10-26T15:00:01Z'));
    window.dispatchEvent(new Event('focus'));
  });
  expect(host.textContent).toContain('Сезон 2026 завершён');
  expect(host.textContent).toContain('Данные раунда 2 не получены');
  expect(api).toHaveBeenCalledTimes(4);
});
