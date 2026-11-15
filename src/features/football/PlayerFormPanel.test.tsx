// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viewState } from '../../lib/viewState';
import { PlayerFormPanel } from './PlayerFormPanel';
import {
  fetchPlayerForm,
  playerFormRow,
  selectPlayerFormWindow,
  summarizePlayerFormRows,
  type PlayerForm,
  type PlayerFormRow,
} from './playerForm';
import type { MatchSummary } from './types';
import { STORAGE_KEYS } from './storage';

vi.mock('./playerForm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./playerForm')>()),
  fetchPlayerForm: vi.fn(),
}));
// Chart geometry belongs in browser QA. Keep the actual panel, state and table.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Line: () => null,
  ReferenceLine: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const fixture = (id: string, day: number, teamId = 'club', teamName = 'Club'): MatchSummary => ({
  id,
  status: 'finished',
  date: `2026-10-${String(day).padStart(2, '0')}`,
  time_utc: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`,
  home_team: { id: teamId, name: teamName },
  away_team: { id: `opponent_${id}`, name: `Opponent ${id}` },
  score_home: 1,
  score_away: 0,
});
const fixtures = Array.from({ length: 6 }, (_, index) =>
  fixture(String.fromCharCode(65 + index), index + 1),
);
const row = (match: MatchSummary, values: Partial<PlayerFormRow> = {}): PlayerFormRow => ({
  id: match.id,
  match,
  date: match.time_utc ?? null,
  status: 'available',
  playerPresent: true,
  rating: null,
  minutes: null,
  goals: null,
  assists: null,
  ...values,
});
const baselineRows = [
  row(fixtures[0]!, { rating: 9, minutes: 90, goals: 2, assists: 1 }),
  row(fixtures[1]!, { rating: 8, minutes: 80, goals: 0, assists: 0 }),
  row(fixtures[2]!, { status: 'missing', playerPresent: false }),
  row(fixtures[3]!, { status: 'not-played', minutes: 0, goals: 0 }),
  row(fixtures[4]!, { status: 'failed', playerPresent: false }),
  row(fixtures[5]!, { rating: 6, minutes: 45, goals: 1 }),
];
const form = (rows = baselineRows): PlayerForm => {
  const baseline = summarizePlayerFormRows(rows);
  return selectPlayerFormWindow(
    {
      window: 5,
      rows: [],
      baselineRows: rows,
      recent: summarizePlayerFormRows([]),
      baseline,
      totalCandidates: rows.length,
      scanned: rows.length,
      available: baseline.available,
      failed: baseline.failed,
      fetchedAt: '2026-10-25T00:00:00Z',
      stale: false,
    },
    5,
  );
};
const button = (text: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
};
async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}
async function render(overrides: Partial<Parameters<typeof PlayerFormPanel>[0]> = {}) {
  await act(async () => {
    root.render(
      <PlayerFormPanel
        playerId="player"
        teamId="club"
        teamName="Club"
        matches={fixtures}
        {...overrides}
      />,
    );
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(fetchPlayerForm).mockReset();
  vi.mocked(fetchPlayerForm).mockResolvedValue(form());
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

it('loads only on request, shows per-metric coverage and preserves missing versus zero in match rows', async () => {
  const openMatch = vi.fn();
  await render({ onOpenMatch: openMatch });
  expect(fetchPlayerForm).not.toHaveBeenCalled();
  expect(host.querySelector('.form-match-table')).toBeNull();
  await click(button('Показать форму игрока'));
  expect(fetchPlayerForm).toHaveBeenCalledWith('player', 'club', fixtures, 5, expect.any(Function));
  expect(host.querySelector('.analysis-coverage')?.textContent).toContain(
    'Последние 5 матчей команды · показатели есть в 3',
  );
  expect(host.querySelector('.analysis-coverage')?.textContent).toContain('База: 6 из 6 матчей');
  expect(host.querySelector('.analysis-coverage')?.textContent).toContain('не загрузились: 1');
  const summary = [...host.querySelectorAll<HTMLButtonElement>('.form-summary-card')];
  expect(summary[0]?.querySelector('strong')?.textContent).toBe('7');
  expect(summary[0]?.textContent).toContain('Наблюдений: 2 / 5; в базе: 3');
  expect(summary[3]?.querySelector('strong')?.textContent).toBe('0');
  expect(summary[3]?.textContent).toContain('Наблюдений: 1 / 5; в базе: 2');
  const rows = [...host.querySelectorAll<HTMLElement>('.form-match-table tbody tr')];
  expect(rows).toHaveLength(5);
  const missing = rows.find((element) => element.textContent?.includes('Opponent C'))!;
  expect(missing.textContent).toContain('нет данных игрока');
  expect([...missing.children].slice(1).map((element) => element.textContent)).toEqual([
    '—',
    '—',
    '—',
    '—',
  ]);
  const dnp = rows.find((element) => element.textContent?.includes('Opponent D'))!;
  expect(dnp.textContent).toContain('0 минут');
  expect([...dnp.children].slice(1).map((element) => element.textContent)).toEqual([
    '—',
    '0',
    '0',
    '—',
  ]);
  expect(
    rows.find((element) => element.textContent?.includes('Opponent E'))?.textContent,
  ).toContain('не загрузился');
  await click(rows[0]!.querySelector<HTMLButtonElement>('button')!);
  expect(openMatch).toHaveBeenCalledWith('F');
});

it('switches between5/10 fixtures and metrics using the loaded baseline without refetching', async () => {
  await render();
  await click(button('Показать форму игрока'));
  await click(button('10 матчей'));
  expect(button('10 матчей').getAttribute('aria-checked')).toBe('true');
  expect(host.querySelectorAll('.form-match-table tbody tr')).toHaveLength(6);
  expect(host.querySelector('.form-match-table')?.textContent).toContain('Opponent A');
  expect(host.querySelector('.analysis-coverage')?.textContent).toContain(
    'Последние 6 матчей команды',
  );
  const goals = [...host.querySelectorAll<HTMLButtonElement>('.form-summary-card')].find(
    (element) => element.textContent?.startsWith('Голы'),
  )!;
  await click(goals);
  expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
    'График: Голы, последние 6 матчей',
  );
  await click(button('5 матчей'));
  expect(host.querySelectorAll('.form-match-table tbody tr')).toHaveLength(5);
  expect(host.querySelector('.form-match-table')?.textContent).not.toContain('Opponent A');
  expect(fetchPlayerForm).toHaveBeenCalledTimes(1);
});

it('shows a calendar-only match on its original day and converts a timestamp in UTC+14', async () => {
  localStorage.setItem(STORAGE_KEYS.timezone, 'Pacific/Kiritimati');
  const day = { ...fixture('calendar', 2), time_utc: undefined };
  const timed = { ...fixture('timed', 2), time_utc: '2026-10-02T23:30:00Z' };
  vi.mocked(fetchPlayerForm).mockResolvedValue(
    form([playerFormRow(day, [], 'player', 'club'), playerFormRow(timed, [], 'player', 'club')]),
  );
  await render({ matches: [day, timed] });
  await click(button('Показать форму игрока'));
  const rows = [...host.querySelectorAll<HTMLElement>('.form-match-table tbody tr')];
  expect(
    rows.find((item) => item.textContent?.includes('Opponent calendar'))?.textContent,
  ).toContain('пт, 2 окт.');
  expect(rows.find((item) => item.textContent?.includes('Opponent timed'))?.textContent).toContain(
    'сб, 3 окт.',
  );
});

it('ignores an old player/team response and its completion state while the new selection is loading', async () => {
  const oldRequest = deferred<PlayerForm>();
  const newRequest = deferred<PlayerForm>();
  vi.mocked(fetchPlayerForm).mockImplementation((playerId) =>
    playerId === 'player' ? oldRequest.promise : newRequest.promise,
  );
  await render();
  await click(button('Показать форму игрока'));
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  const nextFixture = fixture('new-fixture', 10, 'new-club', 'New club');
  const nextForm = form([row(nextFixture, { rating: 5, minutes: 30, goals: 0, assists: 0 })]);
  await render({
    playerId: 'new-player',
    teamId: 'new-club',
    teamName: 'New club',
    matches: [nextFixture],
  });
  expect(host.querySelector('[role="status"]')).toBeNull();
  await click(button('Показать форму игрока'));
  await act(async () => {
    oldRequest.resolve(form());
  });
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  expect(host.querySelector('.form-match-table')).toBeNull();
  await act(async () => {
    newRequest.resolve(nextForm);
  });
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelectorAll('.form-match-table tbody tr')).toHaveLength(1);
  expect(host.querySelector('.form-match-table')?.textContent).toContain(
    'New club — Opponent new-fixture',
  );
  expect(host.querySelector('.form-match-table')?.textContent).not.toContain('Opponent F');
  expect(fetchPlayerForm).toHaveBeenCalledTimes(2);
});

it('retries a failed manual load and removes the error after a successful result', async () => {
  vi.mocked(fetchPlayerForm).mockRejectedValueOnce(new Error('Временная ошибка провайдера'));
  await render();
  await click(button('Показать форму игрока'));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Временная ошибка провайдера',
  );
  await click(button('Повторить'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('.analysis-coverage')).not.toBeNull();
  expect(fetchPlayerForm).toHaveBeenCalledTimes(2);
});

it('does not offer requests when the club has no finished loaded fixtures', async () => {
  await render({ matches: [{ ...fixtures[0]!, status: 'upcoming' }] });
  expect(button('Показать форму игрока').disabled).toBe(true);
  expect(host.textContent).toContain('нет завершённых матчей этого клуба');
  await click(button('Показать форму игрока'));
  expect(fetchPlayerForm).not.toHaveBeenCalled();
});
