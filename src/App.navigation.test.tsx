// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { api } from './lib/bridge';
import { viewState } from './lib/viewState';
import { START_SECTION_KEY } from './lib/navigation';
import { setModule } from './lib/modules';
import { diaryFootballEntry, diaryFixture } from './test/fixtures/diary';
import { schemeFromLineups } from './features/tactics/tacticsModel';
import { tacticLineups, tacticMatch } from './test/fixtures/tactics';

vi.mock('./lib/bridge', () => ({
  api: vi.fn(),
  rpc: vi.fn(async () => ({ pitch: true, kino: false })),
  isTauriRuntime: () => false,
  openExternal: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('./features/football/SportsNotifications', () => ({ SportsNotifications: () => null }));

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
const nextMatch = {
  ...fixture,
  id: 'next-match',
  status: 'scheduled',
  time_utc: '2026-10-23T18:00:00Z',
  date: '2026-10-23',
  score_home: null,
  score_away: null,
};
const prediction = {
  matchId: nextMatch.id,
  leagueId: 'l_4WFCIZ',
  home: 2,
  away: 1,
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  kickoff: '2099-01-01T12:00:00Z',
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  rules: 1,
};
const scheme = {
  ...schemeFromLineups(tacticMatch, tacticLineups, 'fixture-scheme'),
  title: 'Прессинг на фланге',
  updatedAt: '2026-11-09T00:00:00Z',
};
const reply = (payload: unknown) => ({
  payload,
  source: 'test',
  stale: false,
  fetchedAt: '2026-10-21T00:00:00Z',
});

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
function button(text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}
async function renderApp() {
  await Promise.all([
    import('./features/football/FootballView'),
    import('./features/f1/F1View'),
    import('./features/settings/SettingsView'),
    import('./features/planner/ViewingPlanner'),
    import('./features/games/GamesView'),
    import('./features/diary/DiaryView'),
    import('./features/games/StartLightsGame'),
    import('./features/ucl/ChampionsView'),
    import('./features/ucl/CupsView'),
    import('./features/today/TodayView'),
    import('./features/home/HomeView'),
  ]);
  await act(async () => root.render(<App />));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

async function choose(label: string, optionText: string) {
  const input = host.querySelector<HTMLInputElement>(`[role="combobox"][aria-label="${label}"]`);
  if (!input) throw new Error(`Combobox missing: ${label}`);
  await act(async () => input.focus());
  const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (entry) => entry.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`Option missing: ${optionText}`);
  await click(option);
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
              { id: 'l_0bfbkO', name: 'Champions League', seasons: ['2026/2027'] },
            ],
          },
        });
      if (path.startsWith('leagues/'))
        return reply({
          data: {
            league: { id: 'l_4WFCIZ', name: 'Premier League' },
            matches: [fixture, nextMatch],
          },
        });
      if (path === `matches/${fixture.id}`) return reply({ data: fixture });
      if (path.endsWith('/players')) return reply({ data: [] });
      if (path.endsWith('/events')) return reply({ data: { events: [] } });
      if (path.endsWith('/stats')) return reply({ data: { periods: [] } });
      if (path.endsWith('/lineups')) return reply({ data: tacticLineups });
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

it('starts on «Сегодня» whatever sport an old profile saved', async () => {
  localStorage.setItem('sportsdesk.sport', 'f1');
  viewState.write('navigation2.f1', { kind: 'f1', tab: 'calendar' });
  await renderApp();
  expect(host.querySelector('.nav-rail')).not.toBeNull();
  expect(host.querySelector('.topbar')).toBeNull();
  expect(host.querySelector('aside.sidebar')).toBeNull();
  expect(railButton('Сегодня').getAttribute('aria-current')).toBe('page');
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Сегодня');
  expect(host.querySelector('.today-view')).not.toBeNull();
});

it('starts on «Главное» only while the selected module is enabled', async () => {
  localStorage.setItem(START_SECTION_KEY, 'home');
  await renderApp();
  expect(railButton('Главное').getAttribute('aria-current')).toBe('page');
  expect(host.querySelector('.home-screen')).not.toBeNull();
  await act(async () => {
    setModule('home', false);
  });
  expect(host.querySelector('#rail-home')).toBeNull();
  expect(railButton('Сегодня').getAttribute('aria-current')).toBe('page');
});

it('keeps the remembered place of each section and moves back through the header', async () => {
  await renderApp();
  await click(railButton('Футбол'));
  expect(host.querySelector('.shell-page-title')?.textContent).toContain('Premier League');
  await click(headerTab('Таблица'));
  expect(host.querySelector('.standings-view')).not.toBeNull();
  await click(railButton('Формула 1'));
  expect(host.querySelector('.f1-root')).not.toBeNull();
  await click(headerTab('Календарь'));
  expect(host.querySelector('.calendar-board')).not.toBeNull();
  await click(railButton('Футбол'));
  expect(headerTab('Таблица').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('.standings-view')).not.toBeNull();

  const back = host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]')!;
  await click(back);
  expect(host.querySelector('.f1-root')).not.toBeNull();
  expect(headerTab('Календарь').getAttribute('aria-selected')).toBe('true');
  await click(host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]')!);
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Формула 1');
  await click(host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]')!);
  expect(headerTab('Таблица').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('.shell-page-title')?.textContent).toContain('Premier League');
  await click(host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]')!);
  expect(host.querySelector('.shell-page-title')?.textContent).toContain('Premier League');
  await click(host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]')!);
  expect(railButton('Сегодня').getAttribute('aria-current')).toBe('page');
});

it('keeps Alt+arrows and the mouse history buttons working', async () => {
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
  expect(host.querySelector('.shell-page-title')?.textContent).toContain('Premier League');
  await key('ArrowRight');
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Формула 1');
  await act(async () => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }));
    window.dispatchEvent(
      new MouseEvent('auxclick', { button: 3, bubbles: true, cancelable: true }),
    );
  });
  expect(host.querySelector('.shell-page-title')?.textContent).toContain('Premier League');
});

it('keeps service pages neutral and the events drawer over the last page', async () => {
  await renderApp();
  await click(railButton('Футбол'));
  expect(host.querySelector('.app-root')?.getAttribute('data-theme')).toBe('epl');
  await click(railButton('Настройки'));
  expect(host.querySelector('.settings-view')).not.toBeNull();
  expect(host.querySelector('.app-root')?.getAttribute('data-sport')).toBe('neutral');
  expect(host.querySelector('.app-root')?.getAttribute('data-theme')).toBe('neutral');
  expect(railButton('Настройки').getAttribute('aria-current')).toBe('page');
  await click(railButton('События'));
  expect(host.querySelector('.event-center')).not.toBeNull();
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Настройки');
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Закрыть события"]')!);
  expect(host.querySelector('.settings-view')).not.toBeNull();
});

it('opens a match from «Матчи» and leaves only the header back button', async () => {
  await renderApp();
  await click(railButton('Футбол'));
  await click(headerTab('Матчи'));
  await click(host.querySelector<HTMLButtonElement>('[data-match-id="test-match"] .mt-open')!);
  expect(host.querySelector('.md-score')?.textContent).toContain('2 : 1');
  expect(host.querySelector('.match-detail .md-meta-row')?.textContent).not.toContain('Назад');
  expect(host.querySelectorAll('.match-detail [aria-label="Назад"]')).toHaveLength(0);
  expect(host.querySelectorAll('.shell-header-bar [aria-label="Назад"]')).toHaveLength(1);
});

it('opens an old «Сейчас идут» tab as the live filter of «Матчи»', async () => {
  sessionStorage.setItem(
    'sportsdesk.view.navigation2.football',
    JSON.stringify({
      section: 'football',
      route: { kind: 'football', competitionId: 'l_4WFCIZ', tab: 'live' },
      sport: 'football',
      leagueId: 'l_4WFCIZ',
      cupId: 'l_38d9HA',
    }),
  );
  await renderApp();
  await click(railButton('Футбол'));
  expect(headerTab('Матчи').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('.ui-segmented [aria-checked="true"]')?.textContent).toBe(
    'Сейчас идут',
  );
  expect(host.querySelector('.live-panel')).not.toBeNull();
});

it('opens the same live filter from the search item «Сейчас идут»', async () => {
  await renderApp();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })),
  );
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const input = dialog?.querySelector<HTMLInputElement>('[role="combobox"]');
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Сейчас идут',
    );
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const option = [...(dialog?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
    (entry) => entry.textContent?.includes('Сейчас идут'),
  );
  expect(option).toBeTruthy();
  await click(option!);
  expect(host.querySelector('.ui-segmented [aria-checked="true"]')?.textContent).toBe(
    'Сейчас идут',
  );
  expect(host.querySelector('.live-panel')).not.toBeNull();
});

it('navigates to «Главное» from global search and blocks the target when the home module is disabled', async () => {
  await renderApp();
  expect(railButton('Сегодня').getAttribute('aria-current')).toBe('page');

  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })),
  );
  let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  let input = dialog?.querySelector<HTMLInputElement>('[role="combobox"]');
  expect(input).toBeTruthy();
  await change(input!, 'Главное');
  const homeOption = [...(dialog?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
    (entry) => entry.textContent?.includes('Главное'),
  );
  expect(homeOption).toBeTruthy();
  await click(homeOption!);
  expect(railButton('Главное').getAttribute('aria-current')).toBe('page');
  expect(host.querySelector('.home-screen')).not.toBeNull();

  await act(async () => {
    setModule('home', false);
  });
  expect(railButton('Сегодня').getAttribute('aria-current')).toBe('page');

  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })),
  );
  dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  input = dialog?.querySelector<HTMLInputElement>('[role="combobox"]');
  expect(input).toBeTruthy();
  await change(input!, 'Главное');
  const blockedOption = [...(dialog?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
    (entry) => entry.textContent?.includes('Главное'),
  );
  expect(blockedOption).toBeUndefined();
});

it('opens the F1 cover weekend in its actual season and round', async () => {
  viewState.write('f1.year', 2025);
  viewState.write('navigation2.f1', { kind: 'f1', tab: 'overview' });
  await renderApp();
  await click(railButton('Формула 1'));
  expect(host.querySelector('.event-cover')?.textContent).toContain('Test Grand Prix');
  await click(button('Открыть уикенд'));
  expect(viewState.read('f1.year', 2026)).toBe(2025);
  expect(viewState.read('f1.2025.calendar.round', 0)).toBe(1);
  expect(host.querySelector('.calendar-board')).not.toBeNull();
});

it('retains football season, filters and list scroll through settings and back', async () => {
  await renderApp();
  await click(railButton('Футбол'));
  await click(headerTab('Матчи'));
  await choose('Сезон', '2025/2026');
  await choose('Команда', 'Arsenal');
  await click(button('Мои'));
  const main = host.querySelector<HTMLElement>('main.content')!;
  Object.defineProperties(main, {
    scrollHeight: { get: () => 3500 },
    clientHeight: { get: () => 600 },
  });
  main.scrollTop = 640;
  main.dispatchEvent(new Event('scroll'));
  await click(host.querySelector<HTMLButtonElement>('[data-match-id="test-match"] .mt-open')!);
  await click(button('Статистика'));
  await click(railButton('Настройки'));
  expect(host.textContent).toContain('Настройки');
  await click(host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]')!);
  expect(host.querySelector('.ui-tabs [aria-selected="true"]')?.textContent).toBe('Статистика');
  await click(host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]')!);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(host.querySelector<HTMLInputElement>('[role="combobox"][aria-label="Сезон"]')?.value).toBe(
    '2025/2026',
  );
  expect(
    host.querySelector<HTMLInputElement>('[role="combobox"][aria-label="Команда"]')?.value,
  ).toBe('Arsenal');
  expect(host.querySelector('.ui-segmented [aria-checked="true"]')?.textContent).toBe('Мои');
  expect(main.scrollTop).toBe(640);
});

it('shows «Мой план» as a mode of «Сегодня» and returns to the same screen', async () => {
  localStorage.setItem('sportsdesk.football.favorites.teams', JSON.stringify({ ids: ['arsenal'] }));
  await renderApp();
  await click(headerTab('Мой план'));
  expect(host.querySelector('.viewing-planner')).not.toBeNull();
  await click(railButton('Настройки'));
  await click(host.querySelector<HTMLButtonElement>('.shell-header-bar [aria-label="Назад"]')!);
  expect(host.querySelector('.viewing-planner')).not.toBeNull();
  await click(headerTab('Сегодня'));
  expect(host.querySelector('.today-view')).not.toBeNull();
  expect(host.querySelector('.viewing-planner')).toBeNull();
});

it('opens the viewing diary from «Моё» without creating a record', async () => {
  await renderApp();
  await click(railButton('Моё'));
  await click(headerTab('Дневник'));
  expect(host.querySelector('.diary-view')).not.toBeNull();
  expect(localStorage.getItem('sportsdesk.view.diary')).toBeNull();
});

it('opens offline seasons in «Настройки → Данные» and never as its own route', async () => {
  await renderApp();
  await click(railButton('Настройки'));
  await click(button('Данные'));
  expect(host.querySelector('.settings-category > h2')?.textContent).toBe('Данные');
  expect(host.querySelector('.settings-offline')).not.toBeNull();
  expect(host.querySelector('.offline-view')).toBeNull();
  const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
    item.textContent?.includes('Офлайн-сезоны'),
  );
  expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  await click(toggle!);
  expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('.offline-view')).not.toBeNull();
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Настройки');
});

it('opens a 1.7.0 profile in the new structure without losing its data', async () => {
  localStorage.setItem('sportsdesk.sport', 'ucl');
  localStorage.setItem('sportsdesk.sidebar.collapsed', '1');
  localStorage.setItem('sportsdesk.sidebar.competitionsOpen', '0');
  localStorage.setItem('sportsdesk.sidebar.teamsOpen', '0');
  localStorage.setItem(
    'sportsdesk.football.favorites.teams',
    JSON.stringify({ ids: ['arsenal'], seeded: [], seededDefault: true }),
  );
  localStorage.setItem(
    'sportsdesk.football.catalogue',
    JSON.stringify([
      { id: 'arsenal', name: 'Arsenal', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
    ]),
  );
  localStorage.setItem('sportsdesk.view.diary', JSON.stringify(diaryFixture));
  localStorage.setItem(
    'sportsdesk.view.games.predictions',
    JSON.stringify({ version: 1, items: [prediction] }),
  );
  localStorage.setItem(
    'sportsdesk.football.tactics',
    JSON.stringify({ version: 1, schemes: [scheme] }),
  );
  await renderApp();

  expect(host.querySelector('.today-view')).not.toBeNull();
  for (const key of [
    'sportsdesk.sidebar.collapsed',
    'sportsdesk.sidebar.competitionsOpen',
    'sportsdesk.sidebar.teamsOpen',
  ])
    expect(localStorage.getItem(key)).not.toBeNull();

  await click(railButton('Футбол'));
  expect(host.querySelector('.competition-switcher-trigger')?.textContent).toContain(
    'Лига чемпионов',
  );
  expect(host.querySelector('.ucl-view')).not.toBeNull();

  await click(railButton('Моё'));
  expect(host.querySelector('.my-tile')?.textContent).toContain('Arsenal');
  await click(headerTab('Дневник'));
  expect(host.querySelector('.diary-view')?.textContent).toContain(diaryFootballEntry.note);
  await click(headerTab('Игры и прогнозы'));
  expect(host.querySelector('.games-view')).not.toBeNull();
  await click(button('Угадай счёт'));
  expect(host.querySelector('.prediction-list')?.textContent).toContain('Мой прогноз 2 : 1');
  await click(headerTab('Схемы'));
  expect(host.querySelector('.my-scheme')?.textContent).toContain('Прессинг на фланге');

  expect(localStorage.getItem('sportsdesk.view.diary')).not.toBeNull();
  expect(localStorage.getItem('sportsdesk.view.games.predictions')).not.toBeNull();
  expect(localStorage.getItem('sportsdesk.football.tactics')).not.toBeNull();
});
