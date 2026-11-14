// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { viewState } from '../../lib/viewState';
import { F1Analysis } from './F1Analysis';
import { F1View } from './F1View';
import { SeasonProvider } from './SeasonContext';
import type { F1AnalysisMode } from './f1Tabs';

vi.mock('../../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/bridge')>()),
  api: vi.fn(),
}));
vi.mock('./ComparisonChart', () => ({ ComparisonChart: () => null }));
vi.mock('./useWeekendSeason', () => ({
  useWeekendSeason: () => ({ data: null, busy: false, error: null, reload: vi.fn() }),
}));

const meeting = (key: number, name: string, start: string, end: string) => ({
  meeting_key: key,
  meeting_name: name,
  date_start: start,
  date_end: end,
  year: 2026,
});

const session = (key: number, meetingKey: number, name: string, start: string, end: string) => ({
  session_key: key,
  meeting_key: meetingKey,
  session_name: name,
  session_type: name,
  date_start: start,
  date_end: end,
  year: 2026,
});

const rounds = [
  {
    season: '2026',
    round: '1',
    raceName: 'Australian Grand Prix',
    date: '2026-03-01',
    Circuit: { circuitId: 'australia', circuitName: 'Albert Park' },
  },
  {
    season: '2026',
    round: '2',
    raceName: 'Chinese Grand Prix',
    date: '2026-03-15',
    Circuit: { circuitId: 'china', circuitName: 'Shanghai' },
  },
  {
    season: '2026',
    round: '3',
    raceName: 'Japanese Grand Prix',
    date: '2026-03-29',
    Circuit: { circuitId: 'japan', circuitName: 'Suzuka' },
  },
];

const meetings = [
  meeting(1001, 'Australian Grand Prix', '2026-02-27T00:00:00Z', '2026-03-01T12:00:00Z'),
  meeting(1002, 'Chinese Grand Prix', '2026-03-13T00:00:00Z', '2026-03-15T12:00:00Z'),
  meeting(1003, 'Japanese Grand Prix', '2026-03-27T00:00:00Z', '2026-03-29T12:00:00Z'),
];

const sessionsByMeeting: Record<number, ReturnType<typeof session>[]> = {
  1001: [
    session(5001, 1001, 'Practice 1', '2026-02-27T02:00:00Z', '2026-02-27T03:00:00Z'),
    session(5002, 1001, 'Race', '2026-03-01T04:00:00Z', '2026-03-01T06:00:00Z'),
  ],
  1002: [
    session(5101, 1002, 'Practice 1', '2026-03-13T02:00:00Z', '2026-03-13T03:00:00Z'),
    session(5102, 1002, 'Race', '2026-03-15T04:00:00Z', '2026-03-15T06:00:00Z'),
  ],
  1003: [
    session(5201, 1003, 'Practice 1', '2026-03-27T02:00:00Z', '2026-03-27T03:00:00Z'),
    session(5202, 1003, 'Race', '2026-03-29T04:00:00Z', '2026-03-29T06:00:00Z'),
  ],
};

const reply = (payload: unknown, source = 'jolpica') => ({
  payload,
  source,
  stale: false,
  fetchedAt: '2026-05-01T00:00:00Z',
});

const drivers = [
  { driver_number: 1, full_name: 'Max Verstappen', name_acronym: 'VER', team_name: 'Red Bull' },
  { driver_number: 63, full_name: 'George Russell', name_acronym: 'RUS', team_name: 'Mercedes' },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
  sessionStorage.clear();
  viewState.reset();
  viewState.write('f1.year', 2026);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (source, path) => {
    if (source === 'jolpica') {
      if (path.startsWith('2026.json'))
        return reply({ MRData: { RaceTable: { season: '2026', Races: rounds } } });
      if (path.includes('driverStandings'))
        return reply({ MRData: { StandingsTable: { StandingsLists: [] } } });
      return reply({ MRData: { RaceTable: { Races: [] } } });
    }
    if (source === 'openf1') {
      if (path.startsWith('meetings')) return reply(meetings, 'openf1');
      if (path.startsWith('sessions?meeting_key=')) {
        const key = Number(path.slice('sessions?meeting_key='.length));
        return reply(sessionsByMeeting[key] ?? [], 'openf1');
      }
      if (path.startsWith('sessions')) return reply([], 'openf1');
      if (path.startsWith('drivers')) return reply(drivers, 'openf1');
      return reply([], 'openf1');
    }
    return reply(null, source);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const select = (label: string) =>
  host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const modeTabs = () => [
  ...host.querySelectorAll<HTMLButtonElement>('[aria-label="Режим анализа"] [role="tab"]'),
];
const tabStrip = () => [
  ...host.querySelectorAll<HTMLButtonElement>('[aria-label="Разделы Формулы-1"] [role="tab"]'),
];

async function choose(label: string, value: string) {
  await act(async () => {
    const element = select(label);
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

function AnalysisHarness({ initial = 'compare' }: { initial?: F1AnalysisMode }) {
  const [mode, setMode] = useState<F1AnalysisMode>(initial);
  return (
    <SeasonProvider>
      <F1Analysis mode={mode} onModeChange={setMode} />
    </SeasonProvider>
  );
}

it('shows four section tabs and the analysis heading', async () => {
  await act(async () => root.render(<F1View />));
  await settle();
  expect(host.querySelector('h1')?.textContent).toBe('Ваш гоночный уикенд');
  expect(tabStrip().map((tab) => tab.textContent?.trim())).toEqual([
    'Обзор',
    'Календарь',
    'Зачёты',
    'Анализ',
  ]);
  await click(tabStrip()[3]!);
  expect(host.querySelector('h1')?.textContent).toBe('Анализ');
  expect(modeTabs().map((tab) => tab.textContent?.trim())).toEqual([
    'Сравнение пилотов',
    'Темп по кругам',
    'Центр сессии',
  ]);
  expect(modeTabs()[0]?.getAttribute('aria-selected')).toBe('true');
});

it('switches modes and keeps one shared Grand Prix and session choice', async () => {
  await act(async () => root.render(<AnalysisHarness />));
  await settle();
  expect(select('Гран-при').value).toBe('season');
  expect([...select('Гран-при').options].map((option) => option.textContent)).toEqual([
    'Весь сезон 2026',
    '1. Гран-при Австралии',
    '2. Гран-при Китая',
    '3. Гран-при Японии',
  ]);

  await choose('Гран-при', '2');
  expect(select('Гран-при').value).toBe('2');
  expect(select('Сессия').value).toBe('5102');
  expect(select('Сессия').selectedOptions[0]?.textContent).toContain('Гонка');

  await choose('Сессия', '5101');
  expect(select('Сессия').value).toBe('5101');

  await click(modeTabs()[1]!);
  expect(modeTabs()[1]?.getAttribute('aria-selected')).toBe('true');
  expect(select('Гран-при').value).toBe('2');
  expect(select('Сессия').value).toBe('5101');

  await click(modeTabs()[2]!);
  expect(select('Гран-при').value).toBe('2');
  expect(select('Сессия').value).toBe('5101');

  await click(modeTabs()[0]!);
  expect(select('Гран-при').value).toBe('2');
  expect(select('Сессия').value).toBe('5101');
});

it('uses a local fallback for a mode that needs one weekend, without changing the shared choice', async () => {
  await act(async () => root.render(<AnalysisHarness />));
  await settle();
  await choose('Гран-при', '2');
  await choose('Гран-при', 'season');
  const stored = sessionStorage.getItem('sportsdesk.view.f1.2026.analysis.choice');
  expect(JSON.parse(stored!)).toEqual({ round: 'season', meeting: null, session: null });

  await click(modeTabs()[1]!);
  expect(host.querySelector('.f1-analysis-note')?.textContent).toBe(
    'Для этого режима нужен один этап — показан последний завершённый.',
  );
  expect(select('Гран-при').value).toBe('season');
  expect(select('Сессия').value).toBe('5202');
  expect(select('Сессия').disabled).toBe(true);

  await click(modeTabs()[0]!);
  expect(host.querySelector('.f1-analysis-note')).toBeNull();
  expect(select('Гран-при').value).toBe('season');
  expect(JSON.parse(sessionStorage.getItem('sportsdesk.view.f1.2026.analysis.choice')!)).toEqual({
    round: 'season',
    meeting: null,
    session: null,
  });
});
