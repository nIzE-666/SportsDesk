// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MatchAnalysis } from './MatchAnalysis';
import { MatchDetailView } from './MatchDetailView';
import { FavoritesProvider } from './FavoritesProvider';
import { hideResult } from '../spoilers/spoilerStore';
import { viewState } from '../../lib/viewState';
import type { MatchDetail } from './types';

const transport = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn(), isTauriRuntime: () => false }));
vi.mock('../../lib/bridge', () => transport);
const detail: MatchDetail = {
  id: 'fixture',
  status: 'finished',
  score_home: 1,
  score_away: 0,
  home_team: { id: 'home', name: 'Arsenal' },
  away_team: { id: 'away', name: 'Chelsea' },
};
const shot = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  team_id: 'home',
  player: { name: 'Bukayo Saka' },
  minute: 25,
  x: 94,
  y: 34,
  event_type: 'Goal',
  expected_goals: 0.4,
  ...extra,
});
const shots = {
  match_id: 'fixture',
  periods: [
    {
      period: 'FirstHalf',
      shots: [
        shot('a'),
        shot('b', {
          team_id: 'away',
          player: { name: 'Cole Palmer' },
          minute: 45,
          minute_added: 3,
          x: null,
          expected_goals: null,
        }),
      ],
    },
    { period: 'SecondHalf', shots: [shot('c', { minute: 67, expected_goals: 0.2 })] },
  ],
};
const reply = (data: unknown) => ({
  payload: { data },
  stale: false,
  source: 'fixture',
  fetchedAt: '2026-11-09T00:00:00Z',
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
  transport.api.mockImplementation(async (_source: string, path: string) =>
    reply(
      path.endsWith('/shots')
        ? shots
        : path.endsWith('/momentum')
          ? {
              points: [
                { minute: 12, value: 30 },
                { minute: 50, value: -10 },
              ],
            }
          : path === 'matches/fixture'
            ? detail
            : {},
    ),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(tick = 0) {
  await act(async () =>
    root.render(<MatchAnalysis key={detail.id} detail={detail} liveTick={tick} />),
  );
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function choose(index: number, value: string) {
  const select = host.querySelectorAll('select')[index]!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('keeps unknown xG and missing coordinates visible in the accessible list', async () => {
  await render();
  expect(host.querySelectorAll('.analysis-shot')).toHaveLength(2);
  expect(host.querySelectorAll('.analysis-shots tbody tr')).toHaveLength(3);
  expect(host.querySelector('.analysis-total.away')?.textContent).toContain('xG по ударам —');
  expect(host.textContent).toContain('Без координат: 1');
  expect(host.textContent).toContain('Неполная кривая xG');
  expect(host.textContent).toContain('45+3′');
  expect(host.querySelectorAll('.analysis-pressure-bar')).toHaveLength(2);
});

it('filters the map, totals, curve and list together and selects a shot by keyboard-accessible button', async () => {
  await render();
  await choose(0, 'home');
  await choose(1, 'FirstHalf');
  expect(host.querySelectorAll('.analysis-shot')).toHaveLength(1);
  expect(host.querySelectorAll('.analysis-shots tbody tr')).toHaveLength(1);
  expect(host.querySelector('.analysis-total.home')?.textContent).toContain('xG по ударам 0,40');
  expect(host.querySelector('.analysis-total.away')).toBeNull();
  await click('Показать удар: Bukayo Saka, 25′');
  expect(host.querySelector('.analysis-shot.selected')).not.toBeNull();
  expect(host.querySelector('button[aria-pressed="true"]')).not.toBeNull();
});

it('replaces a corrected response and keeps filters during a live refresh', async () => {
  await render();
  await choose(0, 'home');
  transport.api.mockImplementation(async (_source: string, path: string) =>
    reply(
      path.endsWith('/shots')
        ? {
            periods: [
              {
                period: 'FirstHalf',
                shots: [shot('a', { expected_goals: 0.7 }), shot('a', { expected_goals: 0.8 })],
              },
            ],
          }
        : { points: [] },
    ),
  );
  await render(1);
  expect(host.querySelectorAll('.analysis-shots tbody tr')).toHaveLength(1);
  expect(host.querySelector('.analysis-total.home')?.textContent).toContain('xG по ударам 0,80');
  expect(host.querySelector('select')?.value).toBe('home');
  expect(transport.api).toHaveBeenCalledWith('pitch', 'matches/fixture/shots', { automatic: true });
});

it('retains the last successful response on failure and allows a manual retry', async () => {
  await render();
  transport.api.mockRejectedValue(new Error('Источник недоступен'));
  await render(1);
  expect(host.querySelectorAll('.analysis-shot')).toHaveLength(2);
  expect(host.textContent).toContain('Показан предыдущий ответ.');
  expect(host.textContent).toContain('Источник недоступен');
  await click('Обновить разбор');
  expect(transport.api).toHaveBeenLastCalledWith('pitch', 'matches/fixture/momentum', {
    automatic: false,
  });
});

it('displays shots when pressure fails, and treats malformed shots as an error', async () => {
  transport.api.mockImplementation(async (_source: string, path: string) => {
    if (path.endsWith('/momentum')) throw new Error('Давление недоступно');
    return reply(shots);
  });
  await render();
  expect(host.querySelectorAll('.analysis-shot')).toHaveLength(2);
  expect(host.textContent).toContain('Давление недоступно');
  transport.api.mockResolvedValue(reply({}));
  await click('Обновить разбор');
  expect(host.textContent).toContain('Источник вернул некорректные данные.');
});

it('ignores a slow older response after a new refresh', async () => {
  let resolve!: (v: unknown) => void;
  transport.api.mockImplementation((_source: string, path: string) =>
    path.endsWith('/shots')
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(reply({ points: [] })),
  );
  await render();
  transport.api.mockResolvedValue(
    reply({ periods: [{ period: 'FirstHalf', shots: [shot('new', { expected_goals: 0.9 })] }] }),
  );
  await render(1);
  await act(async () => resolve(reply(shots)));
  expect(host.querySelector('.analysis-total.home')?.textContent).toContain('xG по ударам 0,90');
  expect(host.querySelectorAll('.analysis-shot')).toHaveLength(1);
});

it('ignores pending responses for an unmounted match', async () => {
  let resolve!: (v: unknown) => void;
  transport.api.mockImplementation((_source: string, path: string) =>
    path.endsWith('/shots')
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(reply({ points: [] })),
  );
  await render();
  transport.api.mockImplementation(async (_source: string, path: string) =>
    reply(path.endsWith('/shots') ? { match_id: 'other', periods: [] } : { points: [] }),
  );
  await act(async () =>
    root.render(<MatchAnalysis key="other" detail={{ ...detail, id: 'other' }} />),
  );
  await act(async () => resolve(reply(shots)));
  expect(host.querySelectorAll('.analysis-shot')).toHaveLength(0);
  expect(host.textContent).not.toContain('Bukayo Saka');
});

it('keeps empty analytics usable and marks stale cache data', async () => {
  transport.api.mockImplementation(async (_source: string, path: string) => ({
    ...reply(path.endsWith('/shots') ? { periods: [] } : { points: [] }),
    stale: true,
  }));
  await render();
  expect(host.textContent).toContain('Источник не опубликовал удары');
  expect(host.textContent).toContain('Источник не опубликовал давление');
  expect(host.textContent).toContain('сохранённые данные могут быть устаревшими');
  expect(host.querySelectorAll('.source-foot')).toHaveLength(1);
  expect(host.querySelector('button')?.disabled).toBe(false);
});

it('distinguishes unavailable match events from an empty event list', async () => {
  transport.api.mockImplementation(async (_source: string, path: string) => {
    if (path.endsWith('/events')) throw new Error('События недоступны');
    return reply(path === 'matches/fixture' ? detail : {});
  });
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <MatchDetailView matchId="fixture" onBack={vi.fn()} />
      </FavoritesProvider>,
    ),
  );
  expect(host.textContent).toContain('События матча пока недоступны');
  expect(host.textContent).not.toContain('Голы в ленте событий не указаны');
  transport.api.mockImplementation(async (_source: string, path: string) =>
    reply(path === 'matches/fixture' ? detail : path.endsWith('/events') ? { events: [] } : {}),
  );
  await click('Обновить данные');
  expect(host.textContent).toContain('Голы в ленте событий не указаны');
});

it('shows one source summary for a match and refreshes analysis without leaving its tab', async () => {
  transport.api.mockImplementation(async (_source: string, path: string) => ({
    ...reply(
      path === 'matches/fixture'
        ? detail
        : path.endsWith('/shots')
          ? shots
          : path.endsWith('/momentum')
            ? { points: [] }
            : {},
    ),
    stale: path.endsWith('/shots'),
  }));
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <MatchDetailView matchId="fixture" onBack={vi.fn()} />
      </FavoritesProvider>,
    ),
  );
  await click('Разбор матча');
  expect(host.querySelectorAll('.source-foot')).toHaveLength(1);
  expect(host.querySelector('.source-foot')?.textContent).toContain('устаревшими');
  expect(host.textContent).not.toContain('Обновить разбор');
  const count = transport.api.mock.calls.filter(([, path]) => path.endsWith('/shots')).length;
  await click('Обновить данные');
  expect(
    transport.api.mock.calls.filter(([, path]) => path.endsWith('/shots')).length,
  ).toBeGreaterThan(count);
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
    'Разбор матча',
  );
});

it('loads analytics only on the selected tab and only after revealing a hidden result', async () => {
  await act(async () => hideResult({ kind: 'football', id: 'fixture' }));
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <MatchDetailView matchId="fixture" onBack={vi.fn()} />
      </FavoritesProvider>,
    ),
  );
  await click('Разбор матча');
  expect(host.textContent).toContain('Результат скрыт');
  expect(
    transport.api.mock.calls.some(
      ([, path]) => path.endsWith('/shots') || path.endsWith('/momentum'),
    ),
  ).toBe(false);
  await click('Показать результат');
  expect(host.querySelectorAll('.analysis-shot')).toHaveLength(2);
});
