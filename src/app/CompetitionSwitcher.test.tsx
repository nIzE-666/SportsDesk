// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CHAMPIONS_LEAGUE_ID, DEFAULT_CUP_ID, type ShellRoute } from '../lib/navigation';
import { leagueModuleId, writeModules } from '../lib/modules';
import { viewState } from '../lib/viewState';
import { PageHeader } from './PageHeader';

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

const trigger = () => {
  const found = host.querySelector<HTMLButtonElement>('.competition-switcher-trigger');
  if (!found) throw new Error('Competition switcher missing');
  return found;
};
const menu = () => host.querySelector<HTMLElement>('[role="menu"]');
const options = () => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
const option = (name: string) =>
  options().find((button) => button.textContent?.trim() === name) ?? null;
const groupNames = () =>
  [...host.querySelectorAll<HTMLElement>('[role="menu"] [role="group"]')].map((group) => {
    const id = group.getAttribute('aria-labelledby');
    return id ? (host.querySelector<HTMLElement>(`#${id}`)?.textContent?.trim() ?? null) : null;
  });

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

async function openSwitcher() {
  await act(async () => trigger().click());
}

async function press(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
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

it('lists the visible competitions in the two groups', async () => {
  await renderHeader({ kind: 'football', competitionId: 'l_4WFCIZ', tab: 'matches' });
  expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');

  await openSwitcher();
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(groupNames()).toEqual(['Лиги', 'Еврокубки и сборные']);
  expect(options().map((button) => button.textContent?.trim())).toEqual([
    'Premier League',
    'Ла Лига',
    'Серия A',
    'Бундеслига',
    'Лига 1',
    'MLS',
    'Лига чемпионов',
    'Лига Европы',
    'Лига конференций',
    'Чемпионат мира',
  ]);
  expect(option('Premier League')?.getAttribute('aria-checked')).toBe('true');
});

it('shows only competitions allowed by the module switches', async () => {
  writeModules({ [leagueModuleId('l_0ErfuF')]: false });
  await renderHeader({ kind: 'football', competitionId: 'l_4WFCIZ', tab: 'matches' });
  await openSwitcher();
  expect(option('Ла Лига')).toBeNull();
  expect(options()).toHaveLength(9);

  await act(async () => {
    writeModules({ europe: false });
  });
  expect(groupNames()).toEqual(['Лиги']);
  expect(options()).toHaveLength(5);
  expect(option('Лига чемпионов')).toBeNull();
});

it('moves with the arrow keys, chooses with Enter and closes with Esc or a click outside', async () => {
  const navigate = await renderHeader({
    kind: 'football',
    competitionId: 'l_4WFCIZ',
    tab: 'matches',
  });
  trigger().focus();
  await press(trigger(), 'ArrowDown');
  expect(menu()).not.toBeNull();
  expect(document.activeElement).toBe(option('Premier League'));

  await press(option('Premier League')!, 'ArrowDown');
  expect(document.activeElement).toBe(option('Ла Лига'));
  await press(option('Ла Лига')!, 'Enter');
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: 'l_0ErfuF',
    tab: 'matches',
  });
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(trigger());

  await press(trigger(), 'ArrowDown');
  await press(option('Premier League')!, 'Escape');
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(trigger());

  await press(trigger(), 'ArrowDown');
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
  expect(menu()).toBeNull();
});

it('keeps the tab when the competition has it and falls back to the default otherwise', async () => {
  const navigate = await renderHeader({
    kind: 'football',
    competitionId: 'l_4WFCIZ',
    tab: 'standings',
  });
  await openSwitcher();
  await act(async () => option('Ла Лига')!.click());
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: 'l_0ErfuF',
    tab: 'standings',
  });

  navigate.mockClear();
  await renderHeader({ kind: 'football', competitionId: 'l_4WFCIZ', tab: 'standings' }, navigate);
  await openSwitcher();
  await act(async () => option('Лига чемпионов')!.click());
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'matches',
  });

  navigate.mockClear();
  await renderHeader({ kind: 'football', competitionId: DEFAULT_CUP_ID, tab: 'bracket' }, navigate);
  await openSwitcher();
  await act(async () => option('Лига чемпионов')!.click());
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: CHAMPIONS_LEAGUE_ID,
    tab: 'bracket',
  });
});

it('opens the default tab from a match page and keeps the match suffix', async () => {
  const navigate = await renderHeader(
    { kind: 'football-match', matchId: 'm1', competitionId: 'l_4WFCIZ' },
    vi.fn(),
  );
  expect(host.querySelector('.shell-page-title')?.textContent).toBe('Premier League · Матч');
  expect(trigger().textContent?.trim()).toBe('Premier League');

  await openSwitcher();
  await act(async () => option('Лига Европы')!.click());
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: DEFAULT_CUP_ID,
    tab: 'matches',
  });
});
