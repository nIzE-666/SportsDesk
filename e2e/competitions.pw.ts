import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

const LA_LIGA = 'l_0ErfuF';

async function openFootball(
  page: Page,
  options: { modules?: Record<string, boolean>; saved?: unknown } = {},
) {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark');
  await page.addInitScript(
    ({ modules, saved }) => {
      if (modules)
        localStorage.setItem('sportsdesk.modules', JSON.stringify({ version: 1, modules }));
      if (saved)
        sessionStorage.setItem('sportsdesk.view.navigation2.football', JSON.stringify(saved));
    },
    { modules: options.modules ?? null, saved: options.saved ?? null },
  );
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
  return page.locator('.shell-page-title .competition-switcher-trigger');
}

const tabs = (page: Page) => page.locator('.shell-tabs [role="tab"]');

test('switches Premier League → Лига чемпионов → Лига Европы and the tabs follow the kind', async ({
  page,
}) => {
  const switcher = await openFootball(page);
  await expect(switcher).toContainText('Premier League');
  await expect(page.locator('.matches-view')).toBeVisible();
  await expect(tabs(page)).toHaveText(['Матчи', 'Таблица', 'Клубы', 'Игроки', 'Сейчас идут']);

  await switcher.click();
  const menu = page.getByRole('menu', { name: 'Соревнование' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Лиги' })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Еврокубки и сборные' })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: 'Лига чемпионов' }).click();
  await expect(switcher).toContainText('Лига чемпионов');
  await expect(tabs(page)).toHaveText(['Обзор', 'Таблица', 'Сетка', 'Матчи', 'Игроки']);
  await expect(page.locator('.ucl-view')).toBeVisible();

  await switcher.click();
  await page.getByRole('menuitemradio', { name: 'Лига Европы' }).click();
  await expect(switcher).toContainText('Лига Европы');
  await expect(tabs(page)).toHaveText(['Обзор', 'Таблица', 'Сетка', 'Матчи']);
  await expect(page.locator('.ucl-view')).toContainText('Лига Европы');
});

test('a hidden league is not listed in the switcher', async ({ page }) => {
  const switcher = await openFootball(page, { modules: { [`league.${LA_LIGA}`]: false } });
  await switcher.click();
  const menu = page.getByRole('menu', { name: 'Соревнование' });
  await expect(menu.getByRole('menuitemradio')).toHaveCount(9);
  await expect(menu.getByRole('menuitemradio', { name: 'Ла Лига' })).toHaveCount(0);
  await expect(menu.getByRole('menuitemradio', { name: 'Premier League' })).toBeVisible();
});

test('«Матчи» has no league select in the new frame', async ({ page }) => {
  await openFootball(page);
  await expect(page.locator('.matches-view')).toBeVisible();
  await expect(page.locator('#league-select')).toHaveCount(0);
  await expect(page.locator('.filters-bar').getByText('Лига', { exact: true })).toHaveCount(0);
});

test('a saved link to a hidden league opens the first visible league', async ({ page }) => {
  const switcher = await openFootball(page, {
    modules: { [`league.${LA_LIGA}`]: false },
    saved: {
      section: 'football',
      route: { kind: 'football', competitionId: LA_LIGA, tab: 'standings' },
      sport: 'football',
      leagueId: LA_LIGA,
      cupId: 'l_38d9HA',
    },
  });
  await expect(switcher).toContainText('Premier League');
  await expect(page.locator('.standings-view')).toBeVisible();
});

test('the competition accent belongs to football pages and the rail stays neutral', async ({
  page,
}) => {
  const switcher = await openFootball(page);
  const root = page.locator('.app-root');
  const rail = page.locator('.nav-rail');
  const railBackground = await rail.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(railBackground).toBe('rgb(17, 17, 17)');
  await expect(root).toHaveAttribute('data-theme', 'epl');

  await switcher.click();
  await page.getByRole('menuitemradio', { name: 'Ла Лига' }).click();
  await expect(switcher).toContainText('Ла Лига');
  await expect(root).toHaveAttribute('data-theme', 'laliga');
  expect(await rail.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    railBackground,
  );

  await rail.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'neutral');
});
