// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/bridge';
import { viewState } from '../lib/viewState';

vi.mock('../lib/bridge', () => ({
  api: vi.fn(),
  rpc: vi.fn(async () => ({ pitch: true, kino: false })),
  isTauriRuntime: () => false,
  openExternal: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('../features/football/SportsNotifications', () => ({ SportsNotifications: () => null }));

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const home = { id: 'arsenal', name: 'Arsenal' },
  away = { id: 'chelsea', name: 'Chelsea' };
const fixture = {
  id: 'test-match',
  status: 'finished',
  home_team: home,
  away_team: away,
  time_utc: '2026-10-20T18:00:00Z',
  date: '2026-10-20',
  score_home: 2,
  score_away: 1,
};
const reply = (payload: unknown) => ({
  payload,
  source: 'test',
  stale: false,
  fetchedAt: '2026-10-21T00:00:00Z',
});

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

function railButton(text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('.nav-rail button')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Rail button missing: ${text}`);
  return found;
}

function headerTab(text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('.shell-tabs [role="tab"]')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Header tab missing: ${text}`);
  return found;
}

async function renderApp() {
  await Promise.all([
    import('../features/football/FootballView'),
    import('../features/f1/F1View'),
    import('../features/settings/SettingsView'),
    import('../features/planner/ViewingPlanner'),
    import('../features/games/GamesView'),
    import('../features/diary/DiaryView'),
    import('../features/offline/OfflineView'),
    import('../features/games/StartLightsGame'),
    import('../features/ucl/ChampionsView'),
    import('../features/ucl/CupsView'),
  ]);
  await act(async () => root.render(<App />));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  localStorage.setItem('sportsdesk.sport', 'football');
  localStorage.setItem('sportsdesk.league', 'l_4WFCIZ');
  localStorage.setItem('sportsdesk.onboarding', JSON.stringify({ status: 'completed' }));
  localStorage.setItem('sportsdesk.whatsnew.seen', '1.8.0');
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
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (source, path) => {
    if (source === 'pitch') {
      if (path === 'leagues')
        return reply({
          data: {
            leagues: [
              { id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027', '2025/2026'] },
            ],
          },
        });
      if (path.startsWith('leagues/'))
        return reply({
          data: { league: { id: 'l_4WFCIZ', name: 'Premier League' }, matches: [fixture] },
        });
      if (path === `matches/${fixture.id}`) return reply({ data: fixture });
      if (path.endsWith('/players')) return reply({ data: [] });
      if (path.endsWith('/events')) return reply({ data: { events: [] } });
      if (path.endsWith('/stats')) return reply({ data: { periods: [] } });
      return reply({ data: {} });
    }
    const year = path.split('/')[0]?.slice(0, 4) ?? '2026';
    if (/^\d{4}\.json/.test(path))
      return reply({
        MRData: {
          total: '1',
          RaceTable: {
            season: year,
            Races: [
              {
                season: year,
                round: '1',
                raceName: 'Test Grand Prix',
                date: `${year}-05-01`,
                time: '12:00:00Z',
                Qualifying: { date: `${year}-04-30`, time: '12:00:00Z' },
                Circuit: { circuitId: 'test', circuitName: 'Test Circuit' },
              },
            ],
          },
        },
      });
    return reply({ MRData: { total: '0', RaceTable: { Races: [] } } });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('starts on «Сегодня» when the flag is on, whatever the saved sport was', async () => {
  localStorage.setItem('sportsdesk.preview.shell', '1');
  localStorage.setItem('sportsdesk.sport', 'f1');
  viewState.write('navigation.f1', { kind: 'f1', tab: 'calendar' });
  await renderApp();
  expect(host.querySelector('.nav-rail')).not.toBeNull();
  expect(host.querySelector('.topbar')).toBeNull();
  expect(railButton('Сегодня').getAttribute('aria-current')).toBe('page');
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Сегодня');
  expect(host.querySelector('.today-view')).not.toBeNull();
});

it('keeps the remembered place of each section when switching between them', async () => {
  localStorage.setItem('sportsdesk.preview.shell', '1');
  await renderApp();
  await click(railButton('Футбол'));
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Premier League');
  await click(headerTab('Таблица'));
  expect(host.querySelector('.standings-view')).not.toBeNull();
  await click(railButton('Формула 1'));
  expect(host.querySelector('.f1-root')).not.toBeNull();
  await click(railButton('Футбол'));
  expect(headerTab('Таблица').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('.standings-view')).not.toBeNull();
});

it('goes back through the header history button', async () => {
  localStorage.setItem('sportsdesk.preview.shell', '1');
  await renderApp();
  await click(railButton('Футбол'));
  const back = host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]');
  expect(back).not.toBeNull();
  await click(back!);
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Сегодня');
  expect(railButton('Сегодня').getAttribute('aria-current')).toBe('page');
});

it('keeps Alt+arrows and the mouse history buttons working', async () => {
  localStorage.setItem('sportsdesk.preview.shell', '1');
  await renderApp();
  await click(railButton('Футбол'));
  await click(railButton('Формула 1'));
  const key = async (name: string) => {
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: name,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  };
  await key('ArrowLeft');
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Premier League');
  await key('ArrowRight');
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Формула 1');
  await act(async () => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }));
    window.dispatchEvent(
      new MouseEvent('auxclick', { button: 3, bubbles: true, cancelable: true }),
    );
  });
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Premier League');
});

it('keeps the current frame when the flag is off', async () => {
  localStorage.setItem('sportsdesk.preview.shell', '0');
  await renderApp();
  expect(host.querySelector('.topbar')).not.toBeNull();
  expect(host.querySelector('aside.sidebar')).not.toBeNull();
  expect(host.querySelector('.nav-rail')).toBeNull();
  expect(host.querySelector('.shell-frame')).toBeNull();
});

it('switches the frame at once from «Настройки → О программе»', async () => {
  await renderApp();
  await click(host.querySelector<HTMLButtonElement>('.topbar [aria-label="Настройки"]')!);
  await click(
    [...host.querySelectorAll<HTMLButtonElement>('.settings-category-link')].find(
      (button) => button.textContent?.trim() === 'О программе',
    )!,
  );
  const label = [...host.querySelectorAll<HTMLLabelElement>('label')].find(
    (item) => item.textContent?.trim() === 'Новая структура (проба)',
  );
  const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(input).not.toBeNull();
  await act(async () => input!.click());
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(localStorage.getItem('sportsdesk.preview.shell')).toBe('1');
  expect(host.querySelector('.nav-rail')).not.toBeNull();
  expect(host.querySelector('.topbar')).toBeNull();
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Настройки');
});
