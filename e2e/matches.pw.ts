import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

const LIVE_DAY = JSON.parse(
  readFileSync('src/test/fixtures/liveSources/livescore-date-20261108-offset9.json', 'utf8'),
) as unknown;

const rail = (page: Page) => page.getByRole('navigation', { name: 'Разделы' });
const tab = (page: Page, name: string) =>
  page.locator('.shell-tabs').getByRole('tab', { name, exact: true }).click();
const filter = (page: Page) => page.getByRole('radiogroup', { name: 'Фильтр матчей' });
const option = (page: Page, name: string) => filter(page).getByRole('radio', { name, exact: true });

async function openMatches(page: Page) {
  await rail(page).getByRole('button', { name: 'Футбол', exact: true }).click();
  await tab(page, 'Матчи');
  await expect(page.locator('.matches-view')).toBeVisible();
}

for (const scheme of ['dark', 'light'] as const)
  for (const width of [1100, 1440] as const)
    test(`${scheme} ${width}: «Матчи» day list, filters and the live filter`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: width === 1100 ? 720 : 900 });
      await setupVisualFixture(page, scheme, true);
      await page.goto('/');
      await openMatches(page);

      // The old «Сейчас идут» tab is gone; one segmented control replaces it.
      await expect(page.locator('.shell-tabs').getByRole('tab')).toHaveText([
        'Матчи',
        'Таблица',
        'Клубы',
        'Игроки',
      ]);
      await expect(option(page, 'Мои')).toBeVisible();
      await expect(option(page, 'Все')).toHaveAttribute('aria-checked', 'true');
      await expect(option(page, 'Сейчас идут')).toBeVisible();
      expect((await page.locator('.matches-view .ui-button--primary').count()) ?? 0).toBe(0);

      // Tabs and filters are visible without scrolling; nothing overflows sideways.
      const tabs = page.locator('.shell-tabs');
      expect(await tabs.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      for (const label of ['Матчи', 'Таблица', 'Клубы', 'Игроки'])
        await expect(page.locator('.shell-tabs').getByRole('tab', { name: label })).toBeInViewport({
          ratio: 1,
        });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(
        await page
          .locator('.matches-view')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);

      // One list of kit rows grouped by human day headings.
      await expect(page.locator('.match-list__day')).toHaveCount(2);
      await expect(page.locator('.match-list__heading')).toHaveText(['Вчера', 'сб, 24 окт.']);
      await expect(page.locator('.match-list__rows .ui-match-row')).toHaveCount(2);
      await expect(page.locator('.matches-view')).not.toContainText('Хозяева');
      await expect(page.locator('.matches-view')).not.toContainText('Гости');
      await expect(page.locator('.ui-match-row__badge').first()).toHaveText('Избранное');

      // The score keeps the same column in both day groups.
      const scores = page.locator('.ui-match-row__score');
      const above = (await scores.nth(0).boundingBox())!;
      const below = (await scores.nth(1).boundingBox())!;
      expect(Math.round(above.x)).toBe(Math.round(below.x));
      expect(Math.round(above.width)).toBe(Math.round(below.width));

      // Each star stays next to its own club; «Разбор» opens the match page.
      const firstRow = page.locator('[data-match-id="test-match"]').first();
      const homeName = firstRow.locator('.ui-match-row__team--home .ui-match-row__team-name');
      const awayName = firstRow.locator('.ui-match-row__team--away .ui-match-row__team-name');
      const homeStar = firstRow.locator(
        '.ui-match-row__team--home .ui-match-row__team-action button',
      );
      const awayStar = firstRow.locator(
        '.ui-match-row__team--away .ui-match-row__team-action button',
      );
      const center = async (locator: typeof homeName) => {
        const box = (await locator.boundingBox())!;
        return box.x + box.width / 2;
      };
      expect(Math.abs((await center(homeStar)) - (await center(homeName)))).toBeLessThan(
        Math.abs((await center(homeStar)) - (await center(awayName))),
      );
      expect(Math.abs((await center(awayStar)) - (await center(awayName)))).toBeLessThan(
        Math.abs((await center(awayStar)) - (await center(homeName))),
      );
      await expect(homeStar).toHaveAttribute('title', 'Убрать из отслеживаемых: Arsenal');
      await expect(awayStar).toHaveAttribute('title', 'Убрать из отслеживаемых: Chelsea');
      const activeStar = page
        .getByRole('button', { name: 'Убрать из отслеживаемых: Arsenal' })
        .first();
      await expect(activeStar).toHaveAttribute('aria-pressed', 'true');
      await activeStar.click();
      await expect(
        page.getByRole('button', { name: 'Отслеживать: Arsenal' }).first(),
      ).toHaveAttribute('aria-pressed', 'false');
      await page.locator('[data-match-id="test-match"] .mt-open').first().click();
      await expect(page.locator('.md-score')).toContainText('2 : 1');
      await page.locator('.shell-header-bar').getByRole('button', { name: 'Назад' }).click();
      await expect(page.locator('.matches-view')).toBeVisible();

      // The chosen filter is remembered, as other screens remember theirs.
      await option(page, 'Мои').click();
      await expect(option(page, 'Мои')).toHaveAttribute('aria-checked', 'true');
      await page.reload();
      await openMatches(page);
      await expect(option(page, 'Мои')).toHaveAttribute('aria-checked', 'true');

      // The live filter keeps the live feed, its own filter and the source line.
      await option(page, 'Сейчас идут').click();
      await expect(page.locator('.live-panel')).toBeVisible();
      const feedFilter = page.getByRole('radiogroup', { name: 'Фильтр ленты' });
      await expect(feedFilter).toBeVisible();
      await expect(feedFilter.getByRole('radio')).toHaveText([
        'Все (0)',
        'Live (0)',
        'Завершённые',
        'Избранные (0)',
      ]);
      await expect(page.locator('.live-panel .source-foot')).toContainText('LiveScore');
      await expect(page.locator('.live-panel .source-foot')).toContainText('обновлено');
      await expect(page.locator('.live-panel')).toContainText('Нет матчей ваших клубов и турниров');

      // Two screens at most for the normal list.
      const height = await page
        .locator('.matches-view')
        .evaluate((element) => element.scrollHeight);
      expect(height).toBeLessThanOrEqual(1800);
    });

test('the live feed keeps its own filter with counts', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark');
  await page.clock.setFixedTime(new Date('2026-11-08T10:00:00Z'));
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('source') !== 'livescore') return route.fallback();
    await route.fulfill({
      json: {
        payload: LIVE_DAY,
        source: 'livescore',
        fetchedAt: '2026-11-08T10:00:00Z',
        stale: false,
      },
    });
  });
  await page.goto('/');
  await openMatches(page);
  await option(page, 'Сейчас идут').click();
  const feed = page.getByRole('radiogroup', { name: 'Фильтр ленты' });
  await expect(feed.getByRole('radio')).toHaveText([
    'Все (36)',
    'Live (0)',
    'Завершённые',
    'Избранные (8)',
  ]);
  await feed.getByRole('radio', { name: 'Завершённые', exact: true }).click();
  await expect(page.locator('.ui-match-row')).toHaveCount(36);
  await feed.getByRole('radio', { name: 'Избранные (8)', exact: true }).click();
  await expect(page.locator('.ui-match-row')).toHaveCount(8);
  await feed.getByRole('radio', { name: 'Live (0)', exact: true }).click();
  await expect(page.locator('.ui-match-row')).toHaveCount(0);
  await expect(page.locator('.live-panel')).toContainText('Нет матчей в выбранном фильтре');
  await expect(page.locator('.live-panel')).toContainText('Попробуйте другой фильтр.');
});

test('the calendar export is an action of the «Матчи» menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await openMatches(page);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Матчи' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Будущие матчи избранных клубов или выбранной лиги.');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Скачать .ics', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('sportsdesk-matches.ics');
  const path = await download.path();
  expect(path).toBeTruthy();
  const text = readFileSync(path!, 'utf8');
  expect(text).toContain('BEGIN:VCALENDAR');
  expect(text).toContain('Arsenal — Chelsea');
  await expect(dialog).toContainText('Сохранено:');
  await expect(dialog).toContainText('напоминание за 15 минут');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeFocused();
});
