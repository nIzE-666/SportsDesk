// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rpc } from '../../lib/bridge';
import { viewState } from '../../lib/viewState';
import { completeOfflineSeason, offlineSeason } from '../../test/fixtures/offline';
import { summarizeSeason, type OfflineSeason } from './offlineModel';
import { OFFLINE_QUEUE_KEY, type OfflineJob } from './offlineQueue';
import { OfflineView } from './OfflineView';

vi.mock('../../lib/bridge', () => ({ api: vi.fn(), rpc: vi.fn(), isTauriRuntime: () => false }));

const job = (state: OfflineJob['state'], season = '2027/2028'): OfflineJob => ({
  leagueId: 'l_4WFCIZ',
  leagueName: 'Premier League',
  season,
  attempt: `attempt-${season}`,
  pin: true,
  state,
  error: null,
  addedAt: '2026-11-09T00:00:00Z',
});
const seedQueue = (jobs: OfflineJob[], paused = false) =>
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify({ version: 1, paused, jobs }));
const complete = (() => {
  const season = completeOfflineSeason();
  season.season = '2025/2026';
  return season;
})();

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  vi.mocked(rpc).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function show(packages: OfflineSeason[]) {
  vi.mocked(rpc).mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'offline_list') return packages.map(summarizeSeason);
    if (command === 'offline_get')
      return packages.find((p) => p.leagueId === args?.leagueId && p.season === args?.season);
    if (command === 'history_seasons') return [];
    return {};
  });
  await act(async () => root.render(<OfflineView />));
  await act(async () => {});
}
const text = () => host.textContent ?? '';
const queue = () => host.querySelector('[aria-label="Очередь загрузки"]');
const button = (label: string, within: ParentNode = host) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const click = async (element: Element | undefined) => {
  expect(element).toBeDefined();
  await act(async () => (element as HTMLElement).click());
  await act(async () => {});
};
async function type(label: string, value: string) {
  const input = [...host.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector('input') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('shows an empty library as one phrase, without a zero count, an idle reload or an empty queue', async () => {
  await show([]);
  expect(text()).toContain('Пока нет офлайн-пакетов');
  expect(text()).not.toContain('из 60 пакетов');
  expect(text()).not.toContain('0 Б');
  expect(button('Перечитать библиотеку')).toBeUndefined();
  expect(queue()).toBeNull();
  expect(text()).not.toContain('Очередь пуста');
  expect(text()).not.toContain('ожидают: 0');
});
it('shows the queue only while it has jobs, and its controls only while they can act', async () => {
  seedQueue([job('done')]);
  await show([]);
  // A finished job stays listed, but there is nothing to pause or wait for.
  expect(queue()).not.toBeNull();
  expect(text()).toContain('Сохранено');
  expect(text()).not.toContain('ожидают');
  expect(button('Пауза')).toBeUndefined();
  expect(button('Продолжить')).toBeUndefined();
  expect(text()).not.toContain('После перезапуска');
  await act(async () => root.unmount());
  root = createRoot(host);
  seedQueue([job('queued'), job('done', '2026/2027')]);
  await show([]);
  expect(queue()?.textContent).toContain('Выполняется по одному сезону · ожидают: 1');
  expect(button('Пауза')).toBeDefined();
  await act(async () => root.unmount());
  root = createRoot(host);
  seedQueue([job('queued')], true);
  await show([]);
  expect(queue()?.textContent).toContain('На паузе · ожидают: 1');
  expect(button('Продолжить')).toBeDefined();
});
it('shows a complete package without zero facts and counts matches in the right form', async () => {
  await show([complete]);
  expect(text()).toContain('1 из 60 пакетов');
  expect(button('Перечитать библиотеку')).toBeDefined();
  const card = host.querySelector('.offline-package')!;
  expect(card.textContent).toContain('Полный календарь · 380 из 380 матчей');
  expect([...card.querySelectorAll('dt')].map((el) => el.textContent)).toEqual([
    'Обновлён',
    'Размер данных',
    'Завершено по снимку',
  ]);
  expect(card.textContent).not.toContain('без счёта');
  expect(card.textContent).not.toContain('Время уточняется');
});
it('shows facts for matches without a time and says "2 матча" for a package of unknown format', async () => {
  const unverified = {
    ...offlineSeason,
    leagueId: 'l_0eg6C9',
    leagueName: 'MLS',
    season: '2026',
    pinned: false,
  };
  await show([unverified]);
  const card = host.querySelector('.offline-package')!;
  expect(card.textContent).toContain('Полнота не проверена · 2 матча');
  expect([...card.querySelectorAll('dt')].map((el) => el.textContent)).toEqual([
    'Обновлён',
    'Размер данных',
    'Завершено по снимку',
    'Время уточняется',
  ]);
  expect(card.querySelector('dl')?.textContent).toContain('1 матч');
  expect(card.querySelector('dl')?.textContent).not.toContain('без счёта');
});
it('keeps "из" and the plural of the expected count for a partial calendar', async () => {
  await show([offlineSeason]);
  expect(host.querySelector('.offline-package')?.textContent).toContain(
    'Частичный календарь · 2 из 380 матчей',
  );
});
it('names missing scores only when there are some', async () => {
  const unscored: OfflineSeason = {
    ...offlineSeason,
    matches: offlineSeason.matches.map((m) =>
      m.status === 'finished' ? { ...m, homeScore: null, awayScore: null } : m,
    ),
  };
  await show([unscored]);
  expect(host.querySelector('dl')?.textContent).toContain('1 · без счёта: 1');
});
it('opens a package and offers the search and the finished filter only when they can change the list', async () => {
  await show([offlineSeason]);
  await click(button('Открыть без сети'));
  const reader = host.querySelector('[aria-label="Офлайн-календарь"]')!;
  expect(reader.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(
    [...reader.querySelectorAll('.offline-select label')].map((l) => l.firstChild?.textContent),
  ).toEqual(['Поиск команды', 'Матчи']);
  // One page: the count stays, the pager does not.
  expect(reader.textContent).toContain('2 матча');
  expect(reader.textContent).not.toContain('страница');
  expect(button('Следующие', reader)).toBeUndefined();
  expect(button('Предыдущие', reader)).toBeUndefined();
});
it('hides the finished filter when every match is finished and pages a long package', async () => {
  await show([complete]);
  await click(button('Открыть без сети'));
  const reader = host.querySelector('[aria-label="Офлайн-календарь"]')!;
  expect(reader.querySelector('select')).toBeNull();
  expect(reader.querySelector('.offline-select input')).not.toBeNull();
  expect(reader.textContent).toContain('380 матчей · страница 1 из 16');
  expect(button('Следующие', reader)).toBeDefined();
});
it('offers neither search nor filter for a single match', async () => {
  await show([{ ...offlineSeason, matches: [offlineSeason.matches[0]!] }]);
  await click(button('Открыть без сети'));
  const reader = host.querySelector('[aria-label="Офлайн-календарь"]')!;
  expect(reader.querySelector('.offline-select')).toBeNull();
  expect(reader.textContent).toContain('1 матч');
  expect(reader.textContent).not.toContain('1 матчей');
});
it('says nothing was found with one action that clears the search and the filter', async () => {
  await show([offlineSeason]);
  await click(button('Открыть без сети'));
  const reader = host.querySelector('[aria-label="Офлайн-календарь"]')!;
  await type('Поиск команды', 'Неизвестная команда');
  expect(reader.querySelectorAll('tbody tr')).toHaveLength(0);
  expect(reader.textContent).toContain('Матчи по этим условиям не найдены');
  // Nothing is listed, so there is no count and no pager either.
  expect(reader.textContent).not.toContain('матча ·');
  expect(reader.querySelectorAll('.offline-empty button')).toHaveLength(1);
  await click(button('Сбросить поиск и фильтр', reader));
  expect(reader.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(reader.querySelector('.offline-empty')).toBeNull();
});
