// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { api } from './lib/bridge';
import { viewState } from './lib/viewState';
import { readInterfaceDesign } from './lib/interfaceDesign';
import { writeAtmosphere } from './features/atmosphere/atmosphereStore';

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
const reply = (payload: unknown) => ({
  payload,
  source: 'test',
  stale: false,
  fetchedAt: '2026-10-21T00:00:00Z',
});
const button = (text: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
};
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
    import('./features/games/StartLightsGame'),
    import('./features/ucl/ChampionsView'),
    import('./features/ucl/CupsView'),
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
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  localStorage.setItem('sportsdesk.sport', 'football');
  localStorage.setItem('sportsdesk.league', 'l_4WFCIZ');
  viewState.write('navigation.football', { kind: 'football', section: 'matches' });
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

// This first navigation test loads all lazy screens on a cold test worker.
it('switches designs in place, keeps the selected fixture/tab and does not refetch provider data', async () => {
  viewState.write('navigation.football', { kind: 'football-match', matchId: fixture.id });
  await renderApp();
  await click(button('Статистика'));
  const requests = vi.mocked(api).mock.calls.length;
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Включить спортивную обложку"]')!);
  expect(host.querySelector('.app-root')?.getAttribute('data-design')).toBe('broadcast');
  expect(readInterfaceDesign()).toBe('broadcast');
  expect(host.querySelector('.md-score')?.textContent).toContain('2 : 1');
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBeTruthy();
  expect(
    [...host.querySelectorAll('[role="tab"][aria-selected="true"]')].some(
      (t) => t.textContent === 'Статистика',
    ),
  ).toBe(true);
  expect(vi.mocked(api).mock.calls).toHaveLength(requests);
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Вернуть классический дизайн"]')!);
  expect(host.querySelector('.app-root')?.getAttribute('data-design')).toBe('classic');
  expect(host.querySelector('.md-score')?.textContent).toContain('2 : 1');
}, 15000);

it('applies the design from Settings, restores it on launch, and uses a real fixture on the cover', async () => {
  localStorage.setItem('sportsdesk.design', 'broadcast');
  viewState.write('navigation.football', { kind: 'football', section: 'dashboard' });
  await renderApp();
  expect(host.querySelector('.app-root')?.getAttribute('data-design')).toBe('broadcast');
  expect(host.querySelector('.event-cover')?.textContent).toContain('Arsenal');
  expect(host.querySelector('.event-cover-score')?.textContent).toBe('2 : 1');
  const dashboard = host.querySelector('.football-dashboard')!;
  const focusOrder = [...dashboard.querySelectorAll('button')];
  expect(
    focusOrder.indexOf(dashboard.querySelector<HTMLButtonElement>('.recent-game')!),
  ).toBeLessThan(
    focusOrder.indexOf(dashboard.querySelector<HTMLButtonElement>('.calendar-export-bar button')!),
  );
  await click(button('Разбор матча'));
  expect(host.querySelector('.md-score')?.textContent).toContain('2 : 1');
  await click(button('Назад'));
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Настройки"]')!);
  await click(
    host.querySelector<HTMLInputElement>('input[name="interface-design"][value="classic"]')!,
  );
  expect(host.querySelector('.app-root')?.getAttribute('data-design')).toBe('classic');
  expect(localStorage.getItem('sportsdesk.design')).toBe('classic');
});

it('opens the F1 cover weekend in its actual season and round', async () => {
  localStorage.setItem('sportsdesk.design', 'broadcast');
  localStorage.setItem('sportsdesk.sport', 'f1');
  viewState.write('f1.year', 2025);
  viewState.write('navigation.f1', { kind: 'f1', tab: 'overview' });
  await renderApp();
  expect(host.querySelector('.event-cover')?.textContent).toContain('Test Grand Prix');
  await click(button('Открыть уикенд'));
  expect(viewState.read('f1.year', 2026)).toBe(2025);
  expect(viewState.read('f1.2025.calendar.round', 0)).toBe(1);
  expect(host.querySelector('.calendar-board')).not.toBeNull();
});

it('puts key match statistics first only in the new design without changing provider order', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  const stats = {
    periods: [
      {
        period: 'All',
        groups: [
          {
            group_name: 'Defence',
            items: [
              { key: 'tackles', title: 'Tackles', home: '2', away: '3', format_type: 'integer' },
            ],
          },
          {
            group_name: 'Top stats',
            items: [
              {
                key: 'ballpossesion',
                title: 'Ball possession',
                home: '62',
                away: '38',
                format_type: 'integer',
              },
            ],
          },
        ],
      },
    ],
  };
  vi.mocked(api).mockImplementation(async (...args) =>
    args[0] === 'pitch' && args[1].endsWith('/stats') ? reply({ data: stats }) : original(...args),
  );
  viewState.write('navigation.football', { kind: 'football-match', matchId: fixture.id });
  viewState.write(`match.${fixture.id}.tab`, 'stats');
  await renderApp();
  expect(host.querySelector('.stat-group h3')?.textContent).toBe('Оборона');
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Включить спортивную обложку"]')!);
  expect(host.querySelector('.stat-group h3')?.textContent).toBe('Основные показатели');
  expect(stats.periods[0]!.groups[0]!.group_name).toBe('Defence');
});

it('opens the exact older fixture statistics from its team name, date, score and analysis link', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  const latest = { ...fixture, id: 'newer-match', time_utc: '2026-10-21T18:00:00Z' };
  vi.mocked(api).mockImplementation(async (...args) =>
    args[0] === 'pitch' && args[1].startsWith('leagues/')
      ? reply({ data: { matches: [fixture, latest] } })
      : original(...args),
  );
  await renderApp();
  for (const selector of ['.fixture-club', '.mt-date', '.fixture-score', '.link-btn']) {
    const row = host.querySelector<HTMLElement>('[data-match-id="test-match"]')!;
    await click(row.querySelector<HTMLElement>(selector)!);
    expect(viewState.read('navigation.football', {})).toEqual({
      kind: 'football-match',
      matchId: fixture.id,
    });
    expect(host.querySelector('.md-tabs [aria-selected="true"]')?.textContent).toBe('Статистика');
    expect(host.querySelector('.team-view')).toBeNull();
    await click(button('Назад'));
  }
});

it('toggles a team star without opening a match or a club', async () => {
  await renderApp();
  const star = host.querySelector<HTMLButtonElement>('[data-match-id="test-match"] .row-star')!;
  const before = star.getAttribute('aria-pressed');
  await click(star);
  expect(star.getAttribute('aria-pressed')).not.toBe(before);
  expect(host.querySelector('.matches-view')).not.toBeNull();
  expect(host.querySelector('.match-detail')).toBeNull();
});

it('navigates real cup routes, profile settings and keyboard/mouse history once per action', async () => {
  await renderApp();
  await click(button('Кубки'));
  expect(host.querySelector('.sport-toggle [aria-selected="true"]')?.textContent).toBe('Кубки');
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Профиль и настройки"]')!);
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(host.querySelector('.sport-toggle [aria-selected="true"]')?.textContent).toBe('Кубки');
  expect(host.querySelector('.settings-view')).toBeNull();
  await act(async () => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }));
    window.dispatchEvent(
      new MouseEvent('auxclick', { button: 3, bubbles: true, cancelable: true }),
    );
  });
  expect(host.querySelector('.sport-toggle [aria-selected="true"]')?.textContent).toBe('Футбол');
});

it('explains that upcoming match statistics are not available yet and points to the formation', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (...args) =>
    args[0] === 'pitch' && args[1] === `matches/${fixture.id}`
      ? reply({ data: { ...fixture, status: 'not_started', score_home: null, score_away: null } })
      : original(...args),
  );
  await renderApp();
  await click(host.querySelector<HTMLButtonElement>('.fixture-club')!);
  expect(host.textContent).toContain('Матч ещё не начался');
  expect(host.textContent).toContain('Опубликованные составы можно посмотреть');
  expect(host.querySelector('.md-tabs [aria-selected="true"]')?.textContent).toBe('Статистика');
});

it('shows loading instead of a false missing-statistics message while match statistics are pending', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  let complete!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((resolve) => {
    complete = resolve;
  });
  vi.mocked(api).mockImplementation(async (...args) =>
    args[0] === 'pitch' && args[1] === `matches/${fixture.id}/stats` ? pending : original(...args),
  );
  await renderApp();
  await click(host.querySelector<HTMLButtonElement>('.fixture-club')!);
  expect(host.textContent).toContain('Загружаем статистику матча');
  expect(host.textContent).not.toContain('Статистика не загружена');
  await act(async () => complete(reply({ data: { periods: [] } })));
  expect(host.textContent).toContain('Статистика не загружена');
});

it('retains football season, filters, detail tab and list scroll through settings and back', async () => {
  await renderApp();
  await change(host.querySelector<HTMLSelectElement>('#football-season')!, '2025/2026');
  await change(host.querySelector<HTMLInputElement>('#match-search')!, 'Arsenal');
  await click(button('Завершённые'));
  const main = host.querySelector<HTMLElement>('main.content')!;
  Object.defineProperties(main, {
    scrollHeight: { get: () => 3500 },
    clientHeight: { get: () => 600 },
  });
  main.scrollTop = 640;
  main.dispatchEvent(new Event('scroll'));
  await click(host.querySelector<HTMLButtonElement>('.fixture-score')!);
  expect(host.querySelector('.match-detail')).not.toBeNull();
  await click(button('Статистика'));
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Настройки"]')!);
  expect(host.textContent).toContain('Настройки');
  await click(button('Вернуться к спорту'));
  expect(host.querySelector('.md-tabs [aria-selected="true"]')?.textContent).toBe('Статистика');
  await click(button('Назад'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(host.querySelector<HTMLInputElement>('#match-search')?.value).toBe('Arsenal');
  expect(host.querySelector<HTMLSelectElement>('#football-season')?.value).toBe('2025/2026');
  expect(host.querySelector('.segmented .active')?.textContent).toBe('Завершённые');
  expect(main.scrollTop).toBe(640);
});

it('retains the F1 year, calendar round and result tab through settings and sport switches', async () => {
  viewState.write('navigation.f1.tab', 'calendar');
  await renderApp();
  await click(button('Формула 1'));
  await change(host.querySelector<HTMLSelectElement>('[aria-label="Сезон Формулы-1"]')!, '2025');
  const race = [...host.querySelectorAll<HTMLButtonElement>('.calendar-stage')].find((button) =>
    button.textContent?.includes('Test Grand Prix'),
  )!;
  await click(race);
  await click(button('Квалификация'));
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Настройки"]')!);
  await click(button('Вернуться к спорту'));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Сезон Формулы-1"]')?.value).toBe(
    '2025',
  );
  expect(host.querySelector('.race-weekend [aria-selected="true"]')?.textContent).toBe(
    'Квалификация',
  );
  await click(button('Футбол'));
  await click(button('Формула 1'));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Сезон Формулы-1"]')?.value).toBe(
    '2025',
  );
  expect(host.querySelector('.race-weekend')).not.toBeNull();
});

it('returns from settings and football details to the planner, then back to its original sport', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  const nextMatch = {
    ...fixture,
    status: 'scheduled',
    score_home: null,
    score_away: null,
    time_utc: new Date(Date.now() + 3_600_000).toISOString(),
  };
  vi.mocked(api).mockImplementation(async (...args) =>
    args[0] === 'pitch' && args[1].startsWith('leagues/')
      ? reply({
          data: { league: { id: 'l_4WFCIZ', name: 'Premier League' }, matches: [nextMatch] },
        })
      : original(...args),
  );
  localStorage.setItem('sportsdesk.football.favorites.teams', JSON.stringify({ ids: ['arsenal'] }));
  await renderApp();
  await click(button('Формула 1'));
  await click(button('Мой спортивный вечер'));
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Настройки"]')!);
  await click(button('Вернуться к спорту'));
  expect(host.querySelector('.viewing-planner')).not.toBeNull();
  await click(host.querySelector<HTMLButtonElement>('aside [title="Настройки"]')!);
  await click(button('Вернуться к спорту'));
  expect(host.querySelector('.viewing-planner')).not.toBeNull();
  await click(button('Онлайн-просмотр'));
  await click(button('Вернуться к спорту'));
  expect(host.querySelector('.viewing-planner')).not.toBeNull();
  await click(host.querySelector<HTMLButtonElement>('.planner-title')!);
  expect(host.querySelector('.match-detail')).not.toBeNull();
  await click(button('Назад'));
  expect(host.querySelector('.viewing-planner')).not.toBeNull();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
    'Формула 1',
  );
  await click(button('Вернуться к спорту'));
  expect(host.querySelector('.viewing-planner')).toBeNull();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
    'Формула 1',
  );
});

it('restores the original football league after opening a planner match in another league', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  const upcoming = {
    ...fixture,
    status: 'scheduled',
    score_home: null,
    score_away: null,
    time_utc: new Date(Date.now() + 3_600_000).toISOString(),
  };
  vi.mocked(api).mockImplementation(async (...args) => {
    if (args[0] === 'pitch' && args[1] === 'leagues')
      return reply({
        data: {
          leagues: [
            { id: 'l_4WFCIZ', name: 'Premier League' },
            { id: 'l_0ErfuF', name: 'La Liga' },
          ],
        },
      });
    if (args[0] === 'pitch' && args[1].startsWith('leagues/'))
      return reply({
        data: { matches: args[1].startsWith('leagues/l_0ErfuF/') ? [upcoming] : [] },
      });
    return original(...args);
  });
  localStorage.setItem('sportsdesk.football.favorites.teams', JSON.stringify({ ids: ['arsenal'] }));
  await renderApp();
  await click(button('Мой спортивный вечер'));
  await click(host.querySelector<HTMLButtonElement>('.planner-title')!);
  expect(localStorage.getItem('sportsdesk.league')).toBe('l_0ErfuF');
  await click(button('Назад'));
  await click(button('Вернуться к спорту'));
  expect(localStorage.getItem('sportsdesk.league')).toBe('l_4WFCIZ');
  expect(host.querySelector('.viewing-planner')).toBeNull();
});

it('preserves the original match back target when another match is opened from its planner', async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  const upcoming = {
    ...fixture,
    id: 'planner-match',
    status: 'scheduled',
    time_utc: new Date(Date.now() + 3_600_000).toISOString(),
  };
  vi.mocked(api).mockImplementation(async (...args) => {
    if (args[0] === 'pitch' && args[1].startsWith('leagues/'))
      return reply({ data: { matches: [upcoming] } });
    if (args[0] === 'pitch' && args[1] === 'matches/planner-match')
      return reply({ data: upcoming });
    return original(...args);
  });
  viewState.write('navigation.football', { kind: 'football-match', matchId: fixture.id });
  viewState.write('navigation.football.return', { kind: 'football', section: 'matches' });
  localStorage.setItem('sportsdesk.football.favorites.teams', JSON.stringify({ ids: ['arsenal'] }));
  await renderApp();
  await click(button('Мой спортивный вечер'));
  await click(host.querySelector<HTMLButtonElement>('.planner-title')!);
  await click(button('Мой спортивный вечер'));
  await click(button('Вернуться к спорту'));
  expect(viewState.read('navigation.football', {})).toEqual({
    kind: 'football-match',
    matchId: fixture.id,
  });
  await click(button('Назад'));
  expect(viewState.read('navigation.football', {})).toEqual({
    kind: 'football',
    section: 'matches',
  });
  expect(host.querySelector('.match-detail')).toBeNull();
});

it('opens the games page from the sidebar, returns with the same button and starts nothing by itself', async () => {
  await renderApp();
  expect(host.querySelector('.games-view')).toBeNull();
  await click(button('Игры'));
  expect(host.querySelector('.games-view')).not.toBeNull();
  expect(host.querySelector('.page-breadcrumb')?.textContent).toContain('Игры');
  expect(host.querySelector('.lights-pad')).not.toBeNull();
  expect(host.querySelectorAll('.lamp.on')).toHaveLength(0);
  await click(button('Игры'));
  expect(host.querySelector('.games-view')).toBeNull();
});

it('hides the games entry while the games block is switched off', async () => {
  writeAtmosphere({ enabled: false });
  await renderApp();
  expect([...host.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Игры')).toBe(
    false,
  );
});
