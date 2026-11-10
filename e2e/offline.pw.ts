import { test, expect, type Page } from '@playwright/test';
import { offlineSeason, offlinePayload, completeOfflineSeason } from '../src/test/fixtures/offline';
import {
  seasonKey,
  summarizeSeason,
  type OfflineSeason,
} from '../src/features/offline/offlineModel';

async function setup(page: Page, design = 'classic', scheme = 'dark', seed = true) {
  const complete = completeOfflineSeason();
  complete.season = '2025/2026';
  const unknown = {
    ...offlineSeason,
    leagueId: 'l_0eg6C9',
    leagueName: 'MLS',
    season: '2026',
    pinned: false,
  };
  const packages = new Map<string, OfflineSeason>(
    (seed ? [complete, offlineSeason, unknown] : []).map((p) => [
      seasonKey(p.leagueId, p.season),
      structuredClone(p),
    ]),
  );
  const state = {
    offline: false,
    delay: false,
    stale: false,
    failSave: false,
    requests: 0,
    commits: 0,
    release: (() => {}) as () => void,
    errors: [] as string[],
  };
  page.on('pageerror', (e) => state.errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge/command') {
      const { command, args = {} } = route.request().postDataJSON();
      let json: unknown = {};
      const key = seasonKey(args.leagueId, args.season);
      if (command === 'offline_list') json = [...packages.values()].map(summarizeSeason);
      else if (command === 'offline_get') json = packages.get(key) ?? null;
      else if (command === 'offline_put') {
        if (state.failSave)
          return route.fulfill({ status: 500, json: { error: 'Нет места на диске' } });
        packages.set(seasonKey(args.package.leagueId, args.package.season), args.package);
        state.commits++;
        json = summarizeSeason(args.package);
      } else if (command === 'offline_pin') {
        const p = packages.get(key);
        if (p) p.pinned = args.pinned;
        json = null;
      } else if (command === 'offline_remove') {
        const p = packages.get(key);
        if (p?.pinned)
          return route.fulfill({ status: 400, json: { error: 'Сначала открепите сезон.' } });
        packages.delete(key);
        json = null;
      } else if (command === 'history_seasons')
        json = [
          { leagueId: 'legacy', leagueName: 'Старая история', season: '2020/2021', matches: 125 },
        ];
      else if (command === 'secret_status') json = { pitch: true };
      else if (command === 'event_center_list') json = [];
      return route.fulfill({ json });
    }
    if (url.pathname === '/bridge/api') {
      if (state.offline)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'Upstream', message: 'Нет связи с источником.' } },
        });
      const path = url.searchParams.get('path') ?? '';
      let payload: unknown = {};
      if (path === 'leagues')
        payload = {
          data: {
            leagues: [
              {
                id: offlineSeason.leagueId,
                name: offlineSeason.leagueName,
                seasons: ['2026/2027', '2025/2026'],
              },
            ],
          },
        };
      else if (path.startsWith('leagues/')) {
        state.requests++;
        if (state.delay)
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        payload = offlinePayload({
          ...offlineSeason,
          season: new URLSearchParams(path.split('?')[1]).get('season') ?? offlineSeason.season,
        });
      }
      return route.fulfill({
        json: {
          payload,
          source: 'fixture',
          stale: state.stale,
          fetchedAt: offlineSeason.fetchedAt,
        },
      });
    }
    if (url.pathname.startsWith('/bridge/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:1421')
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" />',
      });
    return route.continue();
  });
  await page.addInitScript(
    ({ design, scheme }) => {
      localStorage.setItem('sportsdesk.design', design);
      localStorage.setItem('sportsdesk.scheme', scheme);
      localStorage.setItem('sportsdesk.onboarding', 'done');
      localStorage.setItem(
        'sportsdesk.football.seasonCatalogue',
        JSON.stringify({ l_4WFCIZ: ['2026/2027', '2025/2026'] }),
      );
      sessionStorage.setItem(
        'sportsdesk.view.navigation.football',
        JSON.stringify({ kind: 'football', section: 'matches' }),
      );
    },
    { design, scheme },
  );
  await page.clock.setFixedTime(new Date('2026-11-09T00:00:00Z'));
  return { state, packages };
}
const open = (page: Page) =>
  page.getByRole('button', { name: 'Офлайн-сезоны', exact: true }).click();
for (const design of ['classic', 'broadcast'])
  for (const scheme of ['dark', 'light'])
    for (const width of [1100, 1440])
      test(`${design} ${scheme} ${width}: offline season library`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const { state } = await setup(page, design, scheme);
        await page.goto('/');
        await open(page);
        await page.evaluate(() => document.fonts.ready);
        const feature = page.locator('.offline-view');
        await expect(feature.locator('.offline-package')).toHaveCount(3);
        await expect(feature).toContainText('Полный календарь · 380 из 380');
        await expect(feature).toContainText('Частичный календарь · 2 из 380');
        await expect(feature).toContainText('Полнота не проверена · 2');
        const capture = await page.addStyleTag({
          content:
            '.app-root{height:auto;min-height:100vh;overflow:visible}.shell,.content{overflow:visible}',
        });
        await expect(feature).toHaveScreenshot(`offline-${design}-${scheme}-${width}.png`);
        await capture.evaluate((el) => el.parentNode?.removeChild(el));
        state.offline = true;
        const partial = feature
          .locator('.offline-package')
          .filter({ hasText: 'Частичный календарь' });
        await partial.getByRole('button', { name: 'Открыть без сети', exact: true }).click();
        const reader = page.getByRole('region', { name: 'Офлайн-календарь', exact: true });
        await expect(reader).toContainText('Arsenal — Chelsea');
        await expect(reader).toContainText('2 : 1');
        await expect(reader).toContainText('время уточняется');
        await expect(reader).toContainText('— : —');
        await reader.getByLabel('Поиск команды').fill('Неизвестная команда');
        await expect(reader).toContainText('Матчи по этим условиям не найдены');
        await expect(page.locator('.offline-view')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(state.errors).toEqual([]);
      });
test('pauses a request, resumes after reload, preserves a good package on errors and deletes only after unpinning', async ({
  page,
}) => {
  const { state, packages } = await setup(page, 'classic', 'dark', false);
  await page.goto('/');
  await open(page);
  const feature = page.locator('.offline-view'),
    queue = page.getByRole('region', { name: 'Очередь загрузки', exact: true });
  state.delay = true;
  const initial = state.requests;
  await feature.getByRole('button', { name: 'Загрузить и закрепить', exact: true }).click();
  await expect(queue).toContainText('Получение матчей…');
  await expect.poll(() => state.requests).toBe(initial + 1);
  await page.getByRole('button', { name: 'Дневник просмотра', exact: true }).click();
  await expect(page.locator('.diary-view')).toBeVisible();
  await open(page);
  await expect(queue).toContainText('Получение матчей…');
  await queue.getByRole('button', { name: 'Пауза', exact: true }).click();
  state.release();
  state.delay = false;
  await expect(queue).toContainText('В очереди · на паузе');
  expect(state.commits).toBe(0);
  await page.reload();
  await open(page);
  await expect(queue).toContainText('В очереди · на паузе');
  await queue.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(queue).toContainText('Сохранено');
  await expect(feature.locator('.offline-package')).toHaveCount(1);
  expect(state.commits).toBe(1);
  const p = feature.locator('.offline-package');
  await expect(p.getByRole('button', { name: 'Удалить пакет', exact: true })).toBeDisabled();
  state.stale = true;
  await p.getByRole('button', { name: 'Обновить пакет', exact: true }).click();
  await expect(queue).toContainText('устаревшие данные');
  expect(packages.size).toBe(1);
  expect(state.commits).toBe(1);
  state.stale = false;
  state.failSave = true;
  await queue.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(queue).toContainText('Нет места на диске');
  expect(packages.size).toBe(1);
  state.failSave = false;
  await queue.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(queue).toContainText('Сохранено');
  expect(packages.size).toBe(1);
  expect(state.commits).toBe(2);
  await page.evaluate(() => localStorage.setItem('sportsdesk.view.diary', 'keep-diary'));
  await p.getByRole('button', { name: 'Открепить', exact: true }).click();
  await expect(p).toContainText('Не закреплён');
  await p.getByRole('button', { name: 'Удалить пакет', exact: true }).click();
  await expect(p).toContainText('Автоматическая история результатов и дневник сохранятся');
  await p.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
  await expect(feature.locator('.offline-package')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sportsdesk.view.diary'))).toBe(
    'keep-diary',
  );
  expect(state.errors).toEqual([]);
});
test('keeps future queues read-only while saved packages remain readable without upstream access', async ({
  page,
}) => {
  const { state } = await setup(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'sportsdesk.view.offline',
      JSON.stringify({ version: 2, paused: false, jobs: [] }),
    ),
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      'sportsdesk.view.spoilers',
      JSON.stringify({
        version: 1,
        items: [
          {
            kind: 'football',
            id: 'offline-finished',
            addedAt: '2026-11-09T00:00:00Z',
            eventTime: '2026-11-08T16:30:00Z',
          },
        ],
      }),
    ),
  );
  state.offline = true;
  await page.goto('/');
  await open(page);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Очередь создана новой версией' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Загрузить и закрепить', exact: true }),
  ).toBeDisabled();
  await page
    .locator('.offline-package')
    .filter({ hasText: 'Частичный календарь' })
    .getByRole('button', { name: 'Открыть без сети', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Офлайн-календарь', exact: true })).toContainText(
    'Arsenal — Chelsea',
  );
  const reader = page.getByRole('region', { name: 'Офлайн-календарь', exact: true });
  await expect(
    reader.getByRole('row').filter({ hasText: 'Arsenal — Chelsea' }).getByRole('cell').nth(2),
  ).toHaveText('? : ?');
  expect(state.errors).toEqual([]);
});
