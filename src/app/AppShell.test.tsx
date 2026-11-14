// @vitest-environment jsdom
import { act, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { rpc } from '../lib/bridge';
import { writeModules } from '../lib/modules';
import type { ShellRoute } from '../lib/navigation';
import type { FrameProps, Navigate } from './frame';

vi.mock('./RouteContent', () => ({
  RouteContent: ({ route }: { route: ShellRoute }) => (
    <div data-testid="route-content" data-route={route.kind} />
  ),
}));

vi.mock('../features/events/EventCenter', () => ({
  EventCenter: ({ onOpen }: { onOpen: (event: unknown) => void }) => (
    <div className="event-center">
      <button
        onClick={() =>
          onOpen({
            id: 'event-1',
            sport: 'football',
            kind: 'goal',
            title: 'Изменение счёта',
            body: 'Arsenal — Chelsea',
            occurredAt: 0,
            read: false,
            matchId: 'match-1',
            leagueId: 'l_4WFCIZ',
          })
        }
      >
        Открыть матч
      </button>
      <button
        onClick={() =>
          onOpen({
            id: 'event-2',
            sport: 'f1',
            kind: 'reminder',
            title: 'Гран-при',
            body: 'Начало сессии',
            occurredAt: 0,
            read: false,
            season: '2026',
            round: '3',
          })
        }
      >
        Открыть уикенд
      </button>
      <button
        onClick={() =>
          onOpen({
            id: 'event-3',
            sport: 'football',
            kind: 'goal',
            title: 'Пока вас не было',
            body: 'Arsenal — Chelsea',
            occurredAt: 0,
            read: false,
            matchId: 'catchup-match',
            leagueId: 'l_4WFCIZ',
          })
        }
      >
        Пока вас не было: открыть матч
      </button>
    </div>
  ),
}));

vi.mock('../lib/bridge', () => ({ rpc: vi.fn(), isTauriRuntime: () => false }));

const TODAY: ShellRoute = { kind: 'today', mode: 'today' };
const base: Omit<FrameProps, 'route' | 'navigate'> = {
  sport: 'football',
  leagueId: 'l_4WFCIZ',
  cupId: 'l_38d9HA',
  design: 'classic',
  scheme: 'dark',
  density: 'default',
  canBack: false,
  onBack: vi.fn(),
  changeSection: vi.fn(),
  changeSport: vi.fn(),
  auxiliary: vi.fn(),
  setLeagueId: vi.fn(),
  searchTarget: vi.fn(),
  openFootballMatch: vi.fn(),
  openWeekend: vi.fn(),
  openMini: vi.fn(async () => undefined),
};

function Harness({
  initial,
  navigate,
  ...rest
}: Omit<FrameProps, 'route' | 'navigate'> & { initial: ShellRoute; navigate: Navigate }) {
  const [route, setRoute] = useState(initial);
  return (
    <AppShell
      {...rest}
      route={route}
      navigate={(next, options) => {
        navigate(next, options);
        setRoute(next);
      }}
    />
  );
}

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

async function mount(element: ReactElement) {
  await act(async () => root.render(element));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const railButton = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.nav-rail button')].find(
    (button) => button.lastElementChild?.textContent?.trim() === text,
  )!;
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');
const closeButton = () => host.querySelector<HTMLButtonElement>('[aria-label="Закрыть события"]')!;
const routeContent = () => host.querySelector('[data-testid="route-content"]');

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.mocked(rpc).mockReset();
  vi.mocked(rpc).mockResolvedValue([]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('shows the unread count on the bell and hides the badge at zero', async () => {
  vi.mocked(rpc).mockResolvedValue([{ read: false }, { read: true }, { read: false }]);
  await mount(<Harness {...base} initial={TODAY} navigate={vi.fn()} />);
  expect(host.querySelector('.nav-rail-badge')?.textContent).toBe('2');
  expect(railButton('События').getAttribute('title')).toBe('События · непрочитанных: 2');

  await act(async () => root.unmount());
  root = createRoot(host);
  vi.mocked(rpc).mockResolvedValue([{ read: true }, { read: true }]);
  await mount(<Harness {...base} initial={TODAY} navigate={vi.fn()} />);
  expect(host.querySelector('.nav-rail-badge')).toBeNull();
});

it('opens the drawer from the bell, closes it and opens an event', async () => {
  const openFootballMatch = vi.fn();
  await mount(
    <Harness {...base} openFootballMatch={openFootballMatch} initial={TODAY} navigate={vi.fn()} />,
  );
  await act(async () => railButton('События').click());
  expect(dialog()).not.toBeNull();
  expect(host.querySelector('.event-center')).not.toBeNull();
  expect(document.activeElement).toBe(closeButton());

  await act(async () => dialog()!.querySelectorAll<HTMLButtonElement>('button').item(1).click());
  expect(openFootballMatch).toHaveBeenCalledWith('match-1', 'l_4WFCIZ');
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(railButton('События'));
});

it('opens a Formula 1 weekend and a «Пока вас не было» match from the drawer', async () => {
  const openFootballMatch = vi.fn(),
    openWeekend = vi.fn();
  await mount(
    <Harness
      {...base}
      openFootballMatch={openFootballMatch}
      openWeekend={openWeekend}
      initial={TODAY}
      navigate={vi.fn()}
    />,
  );
  await act(async () => railButton('События').click());

  const buttons = () => [...dialog()!.querySelectorAll<HTMLButtonElement>('.event-center button')];
  await act(async () =>
    buttons()
      .find((b) => b.textContent === 'Открыть уикенд')!
      .click(),
  );
  expect(openWeekend).toHaveBeenCalledWith('2026', '3');
  expect(dialog()).toBeNull();

  await act(async () => railButton('События').click());
  await act(async () =>
    buttons()
      .find((b) => b.textContent === 'Пока вас не было: открыть матч')!
      .click(),
  );
  expect(openFootballMatch).toHaveBeenCalledWith('catchup-match', 'l_4WFCIZ');
  expect(dialog()).toBeNull();
});

it('opens the events route as a drawer over the last page and closes back to it', async () => {
  const navigate = vi.fn();
  await mount(<AppShell {...base} route={TODAY} navigate={navigate} />);
  await act(async () =>
    root.render(<AppShell {...base} route={{ kind: 'events' }} navigate={navigate} />),
  );
  expect(dialog()).not.toBeNull();
  expect(routeContent()?.getAttribute('data-route')).toBe('today');
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Сегодня');

  await act(async () => closeButton().click());
  expect(navigate).toHaveBeenCalledWith(TODAY);
  await act(async () => root.render(<AppShell {...base} route={TODAY} navigate={navigate} />));
  expect(dialog()).toBeNull();
  expect(routeContent()?.getAttribute('data-route')).toBe('today');
});

it('hides «Смотреть» and sends a direct watch route to «Сегодня» when its module is off', async () => {
  writeModules({ watch: false });
  const navigate = vi.fn();
  await mount(<Harness {...base} initial={{ kind: 'watch', channelId: 7 }} navigate={navigate} />);
  expect(
    [...host.querySelectorAll('.nav-rail button')].map((button) => button.textContent?.trim()),
  ).not.toContain('Смотреть');
  expect(navigate.mock.calls[0]?.[0]).toEqual(TODAY);
  expect(routeContent()?.getAttribute('data-route')).toBe('today');
});
