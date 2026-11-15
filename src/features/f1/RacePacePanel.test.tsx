// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viewState } from '../../lib/viewState';
import { RacePacePanel } from './RacePacePanel';
import { loadRacePace, type RacePaceData, type RacePaceDriverData } from './racePace';
import type { OpenF1Driver, OpenF1Session } from './types';

vi.mock('../../lib/useNow', () => ({ useNow: () => Date.parse('2026-10-25T00:00:00Z') }));
vi.mock('./racePace', async (original) => ({
  ...(await original<typeof import('./racePace')>()),
  loadRacePace: vi.fn(),
}));
vi.mock('recharts', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const empty = () => null;
  return {
    ResponsiveContainer: passthrough,
    LineChart: ({ children, data }: { children: ReactNode; data: unknown }) => (
      <div data-testid="pace-chart" data-rows={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Line: ({ connectNulls, dataKey }: { connectNulls: boolean; dataKey: string }) => (
      <span data-series={dataKey} data-connect-nulls={String(connectNulls)} />
    ),
    CartesianGrid: empty,
    Legend: empty,
    ReferenceLine: empty,
    Tooltip: empty,
    XAxis: empty,
    YAxis: empty,
  };
});

const drivers: OpenF1Driver[] = [
  { driver_number: 1, full_name: 'Max Verstappen', name_acronym: 'VER', team_name: 'Red Bull' },
  { driver_number: 63, full_name: 'George Russell', name_acronym: 'RUS', team_name: 'Mercedes' },
  { driver_number: 44, full_name: 'Lewis Hamilton', name_acronym: 'HAM', team_name: 'Ferrari' },
];
const session: OpenF1Session = {
  session_key: 9000,
  meeting_key: 1000,
  year: 2025,
  session_name: 'Race',
  circuit_short_name: 'Test Circuit',
  date_end: '2025-06-01T16:00:00Z',
};

function fixture(key = session.session_key, a = 1, b = 63, duration = 90): RacePaceData {
  const lap = (driverNumber: number, lapNumber: number, seconds: number | null, extra = {}) => ({
    session_key: key,
    driver_number: driverNumber,
    lap_number: lapNumber,
    lap_duration: seconds,
    ...extra,
  });
  const base = (driverNumber: number): RacePaceDriverData => ({
    driverNumber,
    laps: [],
    stints: [],
    pits: [],
    stintsAvailable: true,
    pitsAvailable: true,
    fetchedAt: '2025-06-02T00:00:00Z',
    stale: false,
    warnings: [],
  });
  return {
    sessionKey: key,
    driverA: {
      ...base(a),
      laps: [
        lap(a, 1, null),
        lap(a, 2, duration),
        lap(a, 3, duration + 30),
        lap(a, 4, duration + 20, { is_pit_out_lap: true }),
        lap(a, 6, duration + 2),
      ],
      pits: [{ driver_number: a, session_key: key, lap_number: 3, lane_duration: 22.2 }],
      stints: [
        {
          driver_number: a,
          session_key: key,
          lap_start: 1,
          lap_end: 3,
          stint_number: 1,
          compound: 'MEDIUM',
        },
        {
          driver_number: a,
          session_key: key,
          lap_start: 4,
          lap_end: 6,
          stint_number: 2,
          compound: 'HARD',
        },
      ],
    },
    driverB: {
      ...base(b),
      laps: Array.from({ length: 6 }, (_, index) => lap(b, index + 1, duration + 3)),
    },
    fetchedAt: '2025-06-02T00:00:00Z',
    stale: false,
    warnings: [],
  };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const button = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((element) =>
    element.textContent?.includes(text),
  )!;
const selector = (side: 'a' | 'b') =>
  host.querySelector<HTMLSelectElement>(
    `select[aria-label="${side === 'a' ? 'Первый' : 'Второй'} пилот для темпа"]`,
  )!;
async function select(side: 'a' | 'b', value: number) {
  await act(async () => {
    selector(side).value = String(value);
    selector(side).dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function plotRows(): {
  lapNumber: number;
  a: { paceSeconds: number | null };
  deltaSeconds: number | null;
}[] {
  return JSON.parse(host.querySelector('[data-testid="pace-chart"]')!.getAttribute('data-rows')!);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  viewState.reset();
  vi.mocked(loadRacePace).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('loads only after an explicit click with the selected session and two drivers, then refreshes explicitly', async () => {
  vi.mocked(loadRacePace).mockResolvedValue(fixture(9000, 44, 63));
  await act(async () =>
    root.render(<RacePacePanel session={session} drivers={drivers} initialDriver={44} />),
  );
  expect(selector('a').value).toBe('44');
  expect(selector('b').value).toBe('63');
  expect(loadRacePace).not.toHaveBeenCalled();
  await act(async () => button('Сравнить темп').click());
  expect(loadRacePace).toHaveBeenCalledTimes(1);
  expect(loadRacePace).toHaveBeenCalledWith(session, 44, 63, { refresh: false });
  expect(host.querySelector('.pace-summary')?.textContent).toContain('Lewis Hamilton');
  await act(async () => button('Обновить сравнение').click());
  expect(loadRacePace).toHaveBeenLastCalledWith(session, 44, 63, { refresh: true });
});

it('recomputes pit filtering locally, preserves null gaps in plotted laps, and reports the changed counts', async () => {
  vi.mocked(loadRacePace).mockResolvedValue(fixture());
  await act(async () => root.render(<RacePacePanel session={session} drivers={drivers} />));
  await act(async () => button('Сравнить темп').click());
  expect(host.querySelector('.pace-summary > div')?.textContent).toContain('Медиана · 2 круга');
  expect(host.querySelector('.pace-summary')?.textContent).toContain('2 пары кругов');
  expect(plotRows().map((row) => row.a.paceSeconds)).toEqual([null, 90, null, null, null, 92]);
  expect(
    Array.from(host.querySelectorAll('[data-series]')).map((line) =>
      line.getAttribute('data-connect-nulls'),
    ),
  ).toEqual(['false', 'false']);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(loadRacePace).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.pace-summary > div')?.textContent).toContain('Медиана · 4 круга');
  expect(host.querySelector('.pace-summary')?.textContent).toContain('4 пары кругов');
  expect(plotRows().map((row) => row.a.paceSeconds)).toEqual([null, 90, 120, 110, null, 92]);
  expect(plotRows()[4]?.deltaSeconds).toBeNull();
});

it('swaps the other driver when a selector chooses the currently opposite driver', async () => {
  await act(async () => root.render(<RacePacePanel session={session} drivers={drivers} />));
  await select('a', 63);
  expect([selector('a').value, selector('b').value]).toEqual(['63', '1']);
  await select('b', 63);
  expect([selector('a').value, selector('b').value]).toEqual(['1', '63']);
  expect(loadRacePace).not.toHaveBeenCalled();
  vi.mocked(loadRacePace).mockResolvedValue(fixture());
  await act(async () => button('Сравнить темп').click());
  expect(loadRacePace).toHaveBeenCalledTimes(1);
  expect(loadRacePace).toHaveBeenCalledWith(session, 1, 63, { refresh: false });
});

it('ignores an old driver promise after the selected pair changes, including its loading completion', async () => {
  const old = deferred<RacePaceData>();
  const current = deferred<RacePaceData>();
  vi.mocked(loadRacePace).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await act(async () => root.render(<RacePacePanel session={session} drivers={drivers} />));
  await act(async () => button('Сравнить темп').click());
  expect(button('Загружаем круги').disabled).toBe(true);
  await select('a', 44);
  expect(button('Сравнить темп').disabled).toBe(false);
  await act(async () => button('Сравнить темп').click());
  await act(async () => old.resolve(fixture()));
  expect(host.querySelector('.pace-summary')).toBeNull();
  expect(button('Загружаем круги').disabled).toBe(true);
  await act(async () => current.resolve(fixture(9000, 44, 63, 80)));
  expect(host.querySelector('.pace-summary > div')?.textContent).toContain('Lewis Hamilton');
  expect(plotRows()[1]?.a.paceSeconds).toBe(80);
});

it('discards pending results from another session and never attaches them to the newly selected session', async () => {
  const old = deferred<RacePaceData>();
  vi.mocked(loadRacePace)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(fixture(9001, 1, 63, 75));
  await act(async () => root.render(<RacePacePanel session={session} drivers={drivers} />));
  await act(async () => button('Сравнить темп').click());
  const next = { ...session, session_key: 9001, circuit_short_name: 'Other Circuit' };
  await act(async () => root.render(<RacePacePanel session={next} drivers={drivers} />));
  expect(host.textContent).toContain('Other Circuit');
  expect(host.querySelector('.pace-summary')).toBeNull();
  await act(async () => button('Сравнить темп').click());
  expect(loadRacePace).toHaveBeenLastCalledWith(next, 1, 63, { refresh: false });
  expect(plotRows()[1]?.a.paceSeconds).toBe(75);
  await act(async () => old.resolve(fixture()));
  expect(plotRows()[1]?.a.paceSeconds).toBe(75);
});

it('ignores an error for a no longer selected pair instead of showing its alert', async () => {
  const old = deferred<RacePaceData>();
  vi.mocked(loadRacePace).mockReturnValueOnce(old.promise);
  await act(async () => root.render(<RacePacePanel session={session} drivers={drivers} />));
  await act(async () => button('Сравнить темп').click());
  await select('b', 44);
  await act(async () => old.reject(new Error('Ошибка предыдущей пары')));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(button('Сравнить темп').disabled).toBe(false);
});

it.each([
  ['будущая сессия', '2026-10-26T00:00:00Z'],
  ['конец неизвестен', undefined],
  ['некорректная дата', 'unknown'],
  ['ещё не прошло 30 минут', '2026-10-24T23:45:00Z'],
] as const)('disables loading when historical data is unavailable: %s', async (_label, end) => {
  await act(async () =>
    root.render(<RacePacePanel session={{ ...session, date_end: end }} drivers={drivers} />),
  );
  expect(button('Сравнить темп').disabled).toBe(true);
  expect(host.textContent).toContain('30 минут');
  expect(loadRacePace).not.toHaveBeenCalled();
});

it('requires two session drivers before offering a comparison', async () => {
  await act(async () =>
    root.render(<RacePacePanel session={session} drivers={drivers.slice(0, 1)} />),
  );
  expect(button('Сравнить темп').disabled).toBe(true);
  expect(host.textContent).toContain('двух пилотов');
});

it('shows the Russian session name and joins a known place with one separator', async () => {
  await act(async () => root.render(<RacePacePanel session={session} drivers={drivers} />));
  expect(host.querySelector('.f1-analysis-current')?.textContent).toBe('Гонка · Test Circuit');
});

it('omits the separator when the session has no place', async () => {
  await act(async () =>
    root.render(
      <RacePacePanel
        session={{ ...session, circuit_short_name: undefined, location: undefined }}
        drivers={drivers}
      />,
    ),
  );
  expect(host.querySelector('.f1-analysis-current')?.textContent).toBe('Гонка');
});
