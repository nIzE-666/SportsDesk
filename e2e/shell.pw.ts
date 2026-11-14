import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

const SECTIONS = ['Сегодня', 'Футбол', 'Формула 1', 'Смотреть', 'Моё'];

async function openShell(page: import('@playwright/test').Page, design = 'classic') {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, design, 'dark', true);
  await page.addInitScript(() => localStorage.setItem('sportsdesk.preview.shell', '1'));
  await page.goto('/');
  return page.getByRole('navigation', { name: 'Разделы' });
}

for (const design of ['classic', 'broadcast']) {
  test(`${design}: shows five sections and two bottom items inside a frame of 12 buttons`, async ({
    page,
  }) => {
    const rail = await openShell(page, design);
    await expect(rail).toBeVisible();
    for (const name of SECTIONS)
      await expect(rail.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'События', exact: true })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Сегодня', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await page.locator('.nav-rail button, .shell-header-bar button').count(),
    ).toBeLessThanOrEqual(12);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test(`${design}: opens every section, switches league tabs and the F1 analysis`, async ({
    page,
  }) => {
    const rail = await openShell(page, design);
    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    await expect(page.locator('.football-dashboard')).toBeVisible();

    await rail.getByRole('button', { name: 'Футбол', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Premier League', exact: true })).toBeVisible();
    await expect(page.locator('.matches-view')).toBeVisible();
    await page.locator('.shell-tabs').getByRole('tab', { name: 'Таблица', exact: true }).click();
    await expect(page.locator('.standings-view')).toBeVisible();
    await expect(
      page.locator('.shell-tabs').getByRole('tab', { name: 'Таблица', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');

    await rail.getByRole('button', { name: 'Формула 1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Формула 1', exact: true })).toBeVisible();
    await expect(page.locator('.f1-root')).toBeVisible();
    await page.locator('.shell-tabs').getByRole('tab', { name: 'Анализ', exact: true }).click();
    await expect(page.locator('.f1-analysis')).toBeVisible();
    await expect(
      page.locator('.shell-tabs').getByRole('tab', { name: 'Анализ', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');

    await rail.getByRole('button', { name: 'Смотреть', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Смотреть', exact: true })).toBeVisible();
    await expect(page.locator('.watch-root')).toBeVisible();

    await rail.getByRole('button', { name: 'Моё', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Моё', exact: true })).toBeVisible();
    await expect(page.locator('.my-view')).toBeVisible();
    await expect(
      page.locator('.shell-tabs').getByRole('tab', { name: 'Избранное', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.locator('.shell-tabs').getByRole('tab', { name: 'Дневник', exact: true }).click();
    await expect(page.locator('.diary-view')).toBeVisible();
  });

  test(`${design}: goes back through the header and keeps service pages neutral`, async ({
    page,
  }) => {
    const rail = await openShell(page, design);
    await rail.getByRole('button', { name: 'Футбол', exact: true }).click();
    await rail.getByRole('button', { name: 'Формула 1', exact: true }).click();
    await page
      .locator('.shell-header-bar')
      .getByRole('button', { name: 'Назад', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Premier League', exact: true })).toBeVisible();

    await rail.getByRole('button', { name: 'События', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'События', exact: true })).toBeVisible();
    await expect(page.locator('.event-center')).toBeVisible();
    await expect(rail.getByRole('button', { name: 'События', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await rail.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    await expect(page.locator('.settings-view')).toBeVisible();
    await expect(page.locator('.app-root')).toHaveAttribute('data-sport', 'neutral');
    await expect(page.locator('.app-root')).toHaveAttribute('data-theme', 'neutral');
    await expect(rail.getByRole('button', { name: 'Настройки', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
}
