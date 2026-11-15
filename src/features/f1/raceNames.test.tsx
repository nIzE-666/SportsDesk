// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { viewState } from '../../lib/viewState';
import { Compare } from './Compare';
import { F1Analysis } from './F1Analysis';
import type { JolpicaRaceResultRow } from './types';
import type { WeekendSeason } from './weekendData';

vi.mock('../../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/bridge')>()),
  api: vi.fn(),
}));
vi.mock('./SeasonContext', () => ({ useSeason: () => ({ year: 2025 }) }));
const weekend = vi.hoisted(() => ({ season: null as WeekendSeason | null }));
vi.mock('./useWeekendSeason', () => ({
  useWeekendSeason: () => ({ data: weekend.season, busy: false, error: null, reload: vi.fn() }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
  sessionStorage.clear();
  localStorage.clear();
  viewState.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(api).mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const driver = (driverId: string, givenName: string, familyName: string) => ({
  driverId,
  givenName,
  familyName,
});
const raceRow = (round: string, raceName: string): JolpicaRaceResultRow => ({
  season: '2025',
  round,
  raceName,
  Circuit: { circuitId: `circuit-${round}`, circuitName: `Circuit ${round}` },
  date: `2025-0${round}-01`,
  time: '12:00:00Z',
  Results: [
    {
      position: '1',
      positionText: '1',
      points: '25',
      Driver: driver('max_verstappen', 'Max', 'Verstappen'),
      Constructor: { constructorId: 'red_bull', name: 'Red Bull' },
    },
    {
      position: '2',
      positionText: '2',
      points: '18',
      Driver: driver('norris', 'Lando', 'Norris'),
      Constructor: { constructorId: 'mclaren', name: 'McLaren' },
    },
  ],
});

it('names the races of the driver comparison in Russian', async () => {
  weekend.season = {
    races: [raceRow('1', 'Australian Grand Prix'), raceRow('2', 'Las Vegas Grand Prix')],
    sprints: [],
    qualifying: [],
    issues: [],
    stale: false,
    fetchedAt: '2026-01-10T11:00:00Z',
  };
  vi.mocked(api).mockResolvedValue({
    source: 'jolpica',
    payload: { MRData: { StandingsTable: { StandingsLists: [] } } },
    fetchedAt: '2026-01-10T11:00:00Z',
    stale: false,
  });
  await act(async () => root.render(<Compare round={2} />));
  expect(host.querySelector('select[aria-label="Период сравнения"]')).toBeNull();
  expect(host.querySelector('tbody td')?.textContent).toBe('2. Гран-при Лас-Вегаса');
  expect(host.textContent).not.toContain('Grand Prix');
});

it('names the OpenF1 meetings of the session centre in Russian', async () => {
  const meeting = {
    meeting_key: 1250,
    meeting_name: 'Las Vegas Grand Prix',
    meeting_official_name: 'FORMULA 1 HEINEKEN SILVER LAS VEGAS GRAND PRIX 2025',
    location: 'Las Vegas',
    country_name: 'United States',
    circuit_short_name: 'Las Vegas',
    date_start: '2025-11-20T00:00:00+00:00',
    date_end: '2025-11-22T08:00:00+00:00',
    year: 2025,
  };
  const race = {
    session_key: 9900,
    meeting_key: 1250,
    session_name: 'Race',
    session_type: 'Race',
    date_start: '2025-11-22T04:00:00+00:00',
    date_end: '2025-11-22T06:00:00+00:00',
  };
  vi.mocked(api).mockImplementation(async (_source, path) => ({
    source: 'openf1',
    payload: path.startsWith('meetings')
      ? [meeting]
      : path.startsWith('sessions')
        ? [race]
        : path.startsWith('drivers')
          ? [{ driver_number: 1, full_name: 'Max VERSTAPPEN', team_name: 'Red Bull Racing' }]
          : [],
    fetchedAt: '2026-01-10T11:00:00Z',
    stale: false,
  }));
  await act(async () => root.render(<F1Analysis mode="session" onModeChange={() => {}} />));
  expect(host.querySelector('select[aria-label="Гран-при"] option:checked')?.textContent).toBe(
    'Весь сезон 2025',
  );
  expect(host.querySelector('select[aria-label="Сессия"] option:checked')?.textContent).toContain(
    'Гонка',
  );
  expect(
    host.querySelector('select[aria-label="Сессия"] option:checked')?.textContent,
  ).not.toContain('Race');
  expect(host.querySelector('.f1-analysis-note')?.textContent).toBe(
    'Показан последний завершённый этап.',
  );
  expect(host.querySelector('.f1-meta-row span')?.textContent).toBe('Гран-при Лас-Вегаса');
  expect(host.querySelector('.session-details .ui-panel__title')?.textContent).toBe(
    'Гран-при Лас-Вегаса',
  );
  expect(host.textContent).not.toContain('Grand Prix');
  expect(host.textContent).not.toContain('HEINEKEN');
});
