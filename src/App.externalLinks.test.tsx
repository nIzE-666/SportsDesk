// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { leagueModuleId, writeModules } from './lib/modules';
import { viewState } from './lib/viewState';
import type { FrameProps } from './app/frame';

const listeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    listeners.set(name, callback);
    return () => listeners.delete(name);
  }),
}));
vi.mock('./lib/bridge', () => ({
  api: vi.fn(),
  rpc: vi.fn(async () => ({})),
  isTauriRuntime: () => true,
  openExternal: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('./app/AppShell', () => ({
  AppShell: (props: FrameProps) => (
    <div data-testid="shell" data-route={JSON.stringify(props.route)}>
      <button onClick={() => props.navigate({ kind: 'f1', tab: 'overview' })}>go-f1</button>
    </div>
  ),
}));
vi.mock('./features/football/SportsNotifications', () => ({
  SportsNotifications: () => null,
}));
vi.mock('./features/settings/Updates', () => ({
  UpdateProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./features/onboarding/FirstRunWizard', () => ({ FirstRunWizard: () => null }));
vi.mock('./components/WhatsNewDialog', () => ({ default: () => null }));
vi.mock('./features/atmosphere/FinishCelebration', () => ({ FinishCelebration: () => null }));
vi.mock('./features/atmosphere/GoalCelebration', () => ({ GoalCelebration: () => null }));
vi.mock('./features/atmosphere/TeamRadioSignal', () => ({ TeamRadioSignal: () => null }));

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

const route = () =>
  JSON.parse(host.querySelector('[data-testid="shell"]')!.getAttribute('data-route')!);
const event = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind,
  ...extra,
});

async function mountApp() {
  localStorage.setItem('sportsdesk.preview.shell', '1');
  await act(async () => root.render(<App />));
  await act(async () => {
    await vi.dynamicImportSettled();
    await Promise.resolve();
  });
  expect(listeners.get('sportsdesk://open-event')).toBeTypeOf('function');
}

async function emit(payload: unknown) {
  await act(async () => listeners.get('sportsdesk://open-event')!({ payload }));
  await act(async () => Promise.resolve());
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  listeners.clear();
  localStorage.setItem('sportsdesk.sport', 'football');
  localStorage.setItem('sportsdesk.league', 'l_4WFCIZ');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

it('opens a match, a Formula 1 weekend and the events drawer from open-event payloads', async () => {
  await mountApp();

  await emit(event('match', { matchId: 'match-1' }));
  expect(route()).toEqual({
    kind: 'football-match',
    matchId: 'match-1',
    competitionId: 'l_4WFCIZ',
  });

  await emit(event('f1', { season: '2026', round: '3' }));
  expect(route()).toEqual({ kind: 'f1', tab: 'calendar' });
  expect(viewState.read('f1.year', 0)).toBe(2026);
  expect(viewState.read('f1.2026.calendar.round', 0)).toBe(3);

  await emit(event('events'));
  expect(route()).toEqual({ kind: 'events' });
});

it('sends a match link of a hidden competition to «Сегодня»', async () => {
  localStorage.setItem('sportsdesk.league', 'l_0ErfuF');
  writeModules({ [leagueModuleId('l_0ErfuF')]: false });
  await mountApp();

  await act(async () => host.querySelector('button')!.click());
  expect(route()).toEqual({ kind: 'f1', tab: 'overview' });

  await emit(event('match', { matchId: 'hidden-match' }));
  expect(route()).toEqual({ kind: 'today', mode: 'today' });
});
