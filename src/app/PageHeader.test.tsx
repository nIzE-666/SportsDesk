// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CHAMPIONS_LEAGUE_ID, DEFAULT_CUP_ID, type ShellRoute } from '../lib/navigation';
import { viewState } from '../lib/viewState';
import { PageHeader } from './PageHeader';

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

const tab = (text: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Tab missing: ${text}`);
  return found;
};

async function renderHeader(route: ShellRoute, onNavigate = vi.fn()) {
  await act(async () =>
    root.render(
      <PageHeader
        route={route}
        leagueId="l_4WFCIZ"
        sport={route.kind === 'f1' ? 'f1' : 'football'}
        canBack={false}
        onBack={() => {}}
        onNavigate={onNavigate}
        onSearchTarget={() => {}}
        onOpenMini={async () => {}}
      />,
    ),
  );
  return onNavigate;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  viewState.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('switches «Сегодня» and «Мой план»', async () => {
  const navigate = await renderHeader({ kind: 'today', mode: 'today' });
  expect(tab('Сегодня').getAttribute('aria-selected')).toBe('true');
  await act(async () => tab('Мой план').click());
  expect(navigate).toHaveBeenCalledWith({ kind: 'today', mode: 'plan' });
});

it('switches the league tabs', async () => {
  const navigate = await renderHeader({
    kind: 'football',
    competitionId: 'l_4WFCIZ',
    tab: 'matches',
  });
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(tab('Матчи').getAttribute('aria-selected')).toBe('true');
  await act(async () => tab('Таблица').click());
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: 'l_4WFCIZ',
    tab: 'standings',
  });
});

it('switches the Champions League and cup tabs', async () => {
  const navigate = await renderHeader({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'overview',
  });
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
  await act(async () => tab('Игроки').click());
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'stats',
  });

  navigate.mockClear();
  await renderHeader(
    { kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'overview' },
    navigate,
  );
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
  await act(async () => tab('Сетка').click());
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: DEFAULT_CUP_ID,
    tab: 'bracket',
  });
});

it('keeps «Анализ» active on pace and reopens the last analysis mode', async () => {
  await renderHeader({ kind: 'f1', tab: 'pace' });
  expect(tab('Анализ').getAttribute('aria-selected')).toBe('true');
  const navigate = await renderHeader({ kind: 'f1', tab: 'overview' });
  await act(async () => tab('Анализ').click());
  expect(navigate).toHaveBeenCalledWith({ kind: 'f1', tab: 'compare' });

  viewState.write('f1.analysis.mode', 'session');
  navigate.mockClear();
  await act(async () => tab('Анализ').click());
  expect(navigate).toHaveBeenCalledWith({ kind: 'f1', tab: 'session' });
});

it('opens «Моё» on favorites and switches to the other tabs', async () => {
  const navigate = await renderHeader({ kind: 'my' });
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(tab('Избранное').getAttribute('aria-selected')).toBe('true');
  await act(async () => tab('Игры и прогнозы').click());
  expect(navigate).toHaveBeenCalledWith({ kind: 'my', tab: 'games' });
  await act(async () => tab('Схемы').click());
  expect(navigate).toHaveBeenLastCalledWith({ kind: 'my', tab: 'schemes' });
});

it('hides the «Моё» tabs whose modules are off and marks the first visible one', async () => {
  localStorage.setItem(
    'sportsdesk.modules',
    JSON.stringify({
      version: 1,
      modules: { diary: false, games: false, predictions: false, tactics: false },
    }),
  );
  await renderHeader({ kind: 'my', tab: 'schemes' });
  expect(
    [...host.querySelectorAll('[role="tab"]')].map((button) => button.textContent?.trim()),
  ).toEqual(['Избранное']);
  expect(tab('Избранное').getAttribute('aria-selected')).toBe('true');
});

it('shows no frame tabs on service pages and matches, and titles a match by competition', async () => {
  await renderHeader({ kind: 'settings' });
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Настройки');

  await renderHeader({ kind: 'football-match', matchId: 'm1', competitionId: 'l_4WFCIZ' });
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Premier League · Матч');
});
