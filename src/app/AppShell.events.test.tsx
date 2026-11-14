// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { rpc } from '../lib/bridge';
import type { ShellRoute } from '../lib/navigation';
import type { FrameProps } from './frame';

vi.mock('./RouteContent', () => ({
  RouteContent: ({ route }: { route: ShellRoute }) => (
    <div data-testid="route-content" data-route={route.kind} />
  ),
}));

vi.mock('../lib/bridge', () => ({ rpc: vi.fn(), isTauriRuntime: () => false }));

const TODAY: ShellRoute = { kind: 'today', mode: 'today' };
const base: Omit<FrameProps, 'route' | 'navigate'> = {
  leagueId: 'l_4WFCIZ',
  cupId: 'l_38d9HA',
  design: 'classic',
  scheme: 'dark',
  density: 'default',
  canBack: false,
  onBack: vi.fn(),
  changeSection: vi.fn(),
  setLeagueId: vi.fn(),
  searchTarget: vi.fn(),
  openFootballMatch: vi.fn(),
  openWeekend: vi.fn(),
  openMini: vi.fn(async () => undefined),
};

const match = {
  id: 'catchup-match',
  sport: 'football',
  kind: 'end',
  title: 'Arsenal — Chelsea',
  body: 'Arsenal 2 : 1 Chelsea',
  occurredAt: Date.UTC(2026, 10, 8, 15),
  read: false,
  matchId: 'catchup-match',
  leagueId: 'l_4WFCIZ',
};
const weekend = {
  id: 'f1|2026|3',
  sport: 'f1',
  kind: 'result',
  title: 'Гран-при',
  body: 'Итоги гонки',
  occurredAt: Date.UTC(2026, 10, 8, 12),
  read: false,
  season: '2026',
  round: '3',
};

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

const bell = () =>
  [...host.querySelectorAll<HTMLButtonElement>('.nav-rail button')].find(
    (button) => button.textContent?.trim() === 'События',
  )!;
const catchUpButton = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.catchup-panel button')].find(
    (button) => button.textContent === text,
  )!;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.mocked(rpc).mockReset();
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'event_center_list') return [];
    if (command === 'catchup_summary')
      return {
        from: Date.UTC(2026, 10, 6),
        to: Date.UTC(2026, 10, 9),
        truncated: false,
        footballIncomplete: false,
        f1Incomplete: false,
        items: [match, weekend],
      };
    return {};
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mountShell(overrides: Partial<FrameProps> = {}) {
  await act(async () =>
    root.render(<AppShell {...base} {...overrides} route={TODAY} navigate={vi.fn()} />),
  );
  await flush();
}

async function openDrawer() {
  await act(async () => bell().click());
  await flush();
}

it('opens a match and a weekend from «Пока вас не было» in the new frame', async () => {
  const openFootballMatch = vi.fn(),
    openWeekend = vi.fn();
  await mountShell({ openFootballMatch, openWeekend });
  await openDrawer();

  expect(host.querySelector('.catchup-panel')).not.toBeNull();
  await act(async () => catchUpButton('Открыть матч').click());
  expect(openFootballMatch).toHaveBeenCalledWith('catchup-match', 'l_4WFCIZ');
  expect(host.querySelector('[role="dialog"]')).toBeNull();

  await openDrawer();
  await act(async () => catchUpButton('Открыть уикенд').click());
  expect(openWeekend).toHaveBeenCalledWith('2026', '3');
});

it('shows the catch-up panel inside the events drawer', async () => {
  await mountShell();
  await openDrawer();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.querySelector('.catchup-panel')?.textContent).toContain('Пока вас не было');
  expect(base.openFootballMatch).not.toHaveBeenCalled();
});
