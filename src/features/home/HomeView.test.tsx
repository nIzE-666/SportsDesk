// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { viewState } from '../../lib/viewState';
import { homeFixturePayload, HOME_FIXTURE_TIME } from '../../test/fixtures/homeWeek';
import { isResultHidden, hideResult } from '../spoilers/spoilerStore';
import { HomeView } from './HomeView';
import { readHomeReminders } from './homePreferences';

vi.mock('../../lib/bridge', async (original) => ({
  ...(await original<typeof import('../../lib/bridge')>()),
  api: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;
const openMatch = vi.fn();
const openWeekend = vi.fn();

async function mount() {
  await act(async () => {
    root.render(<HomeView onOpenMatch={openMatch} onOpenWeekend={openWeekend} />);
  });
  await act(async () => {});
}

function button(name: RegExp): HTMLButtonElement {
  const node = [...host.querySelectorAll('button')].find((item) =>
    name.test(item.getAttribute('aria-label') ?? item.textContent ?? ''),
  );
  if (!node) throw new Error(`Button missing: ${name}`);
  return node;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(HOME_FIXTURE_TIME));
  vi.clearAllMocks();
  viewState.reset();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('sportsdesk.timezone', 'Asia/Yakutsk');
  vi.mocked(api).mockImplementation(async (source, path) => ({
    payload: homeFixturePayload(source, path),
    source,
    fetchedAt: HOME_FIXTURE_TIME,
    stale: false,
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it('uses the app planner, tracks selected reminders and opens the actual event', async () => {
  await mount();
  const live = host.querySelector('.home-live-row');
  expect(live?.textContent).toContain("85'");
  expect(live?.textContent).toContain('2 : 2');
  const title = /Аякс — Интер/;
  await act(async () => button(/Буду смотреть, Аякс — Интер/).click());
  expect(button(/Убрать из плана, Аякс — Интер/).getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('sportsdesk.planner.priorities')).toContain('football:home-next');
  await act(async () => button(/Напомнить, Аякс — Интер/).click());
  expect(readHomeReminders()).toEqual([
    {
      key: 'football:home-next',
      start: Date.parse('2026-11-19T14:55:00Z'),
      fixture: { id: 'home-next', leagueId: 'l_0bfbkO' },
    },
  ]);
  const card = [...host.querySelectorAll<HTMLElement>('.ui-showcase-upcoming')].find((node) =>
    title.test(node.getAttribute('aria-label') ?? ''),
  );
  expect(card).toBeDefined();
  await act(async () => card!.click());
  expect(openMatch).toHaveBeenCalledWith('home-next', 'l_0bfbkO');
});

it('visibly indicates when a selected reminder will not be delivered due to global or team settings and still allows removing it', async () => {
  await mount();

  // Default install: global notifications are disabled ('sportsdesk.notifications.enabled' absent).
  await act(async () => button(/Напомнить, Аякс — Интер/).click());
  expect(readHomeReminders()).toHaveLength(1);
  const blockedGlobalBtn = button(/Отменить напоминание, Аякс — Интер/);
  expect(blockedGlobalBtn.getAttribute('aria-pressed')).toBe('true');
  expect(blockedGlobalBtn.textContent).toBe('Уведомления выключены');
  expect(blockedGlobalBtn.getAttribute('title')).toBe('Уведомления выключены в настройках');

  // Enable global notifications -> button switches to «Напомню»:
  await act(async () => {
    localStorage.setItem('sportsdesk.notifications.enabled', '1');
    window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
  });
  expect(button(/Отменить напоминание, Аякс — Интер/).textContent).toBe('Напомню');

  // Mute the club's reminder notifications in notification policy -> button indicates delivery is disabled:
  await act(async () => {
    localStorage.setItem('sportsdesk.football.favorites.teams', JSON.stringify({ ids: ['ajax'] }));
    localStorage.setItem(
      'sportsdesk.football.catalogue',
      JSON.stringify([{ id: 'ajax', name: 'Аякс', leagueId: 'l_0bfbkO' }]),
    );
    localStorage.setItem(
      'sportsdesk.notifications.policy',
      JSON.stringify({
        events: { goals: true, start: true, end: true, reminder: true },
        teams: {
          ajax: { enabled: false, goals: true, start: true, end: true, reminder: true },
        },
      }),
    );
    window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
  });
  const blockedTeamBtn = button(/Отменить напоминание, Аякс — Интер/);
  expect(blockedTeamBtn.getAttribute('aria-pressed')).toBe('true');
  expect(blockedTeamBtn.textContent).toBe('Уведомления выключены');

  // Clicking the selected reminder while delivery is disabled still removes it:
  await act(async () => blockedTeamBtn.click());
  expect(readHomeReminders()).toEqual([]);
  expect(button(/Напомнить, Аякс — Интер/).getAttribute('aria-pressed')).toBe('false');
});

it('reveals a hidden result only on its card and keeps the sport filter keyboard accessible', async () => {
  hideResult({ kind: 'football', id: 'home-finished', eventTime: '2026-11-16T19:00:00Z' });
  localStorage.setItem('sportsdesk.view.home.hideInterest', '1');
  await mount();
  const tile = button(/Показать счёт, Арсенал — Челси/).closest('.home-tile')!;
  expect(tile.querySelector('.ui-showcase-card')?.getAttribute('aria-label')).not.toContain('3:2');
  expect(tile.querySelector('.ui-interest-meter')).toBeNull();
  expect(tile.textContent).not.toContain('камбэк');
  await act(async () => button(/Показать счёт, Арсенал — Челси/).click());
  expect(tile.querySelector('.ui-showcase-card')?.getAttribute('aria-label')).toContain('3:2');
  expect(isResultHidden('football', 'home-finished')).toBe(true);
  await act(async () => {
    const all = host.querySelector<HTMLButtonElement>('button[role="radio"][aria-checked="true"]')!;
    all.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  });
  expect(host.querySelector('button[role="radio"][aria-checked="true"]')?.textContent).toBe(
    'Формула 1',
  );
  expect(host.textContent).not.toContain('Лучшее за неделю');
  expect(host.textContent).toContain('Lando Norris');
  await act(async () => button(/^Открыть уикенд$/).click());
  expect(openWeekend).toHaveBeenCalledWith('2026', '21');
});

it('restores finished scores and goal events on a new mount without a network reply', async () => {
  await mount();
  expect(
    vi.mocked(api).mock.calls.some(([, path]) => path === 'matches/home-finished/events'),
  ).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.mocked(api).mockClear().mockRejectedValue(new Error('Offline'));
  await mount();
  expect(host.querySelector('.ui-showcase-card__strip')).not.toBeNull();
  expect(host.textContent).toContain('сохранённые данные');
  expect(
    vi.mocked(api).mock.calls.some(([, path]) => path === 'matches/home-finished/events'),
  ).toBe(false);
});
