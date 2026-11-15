import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

test('overviews have useful headings without slogan banners', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('today.png') });

  const rail = page.getByRole('navigation', { name: 'Разделы' });
  await rail.getByRole('button', { name: 'Формула 1', exact: true }).click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Обзор', exact: true }).click();
  await expect(page.locator('.f1-root h2.screen-title')).toHaveText('Ваш гоночный уикенд');

  await rail.getByRole('button', { name: 'Футбол', exact: true }).click();
  await page.locator('.competition-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Лига чемпионов' }).click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Обзор', exact: true }).click();
  await expect(page.locator('main h2.screen-title')).toContainText('Европейский вечер');

  await page.locator('.competition-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Лига Европы' }).click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Обзор', exact: true }).click();
  await expect(page.locator('main h2.screen-title')).toContainText('Лига Европы');
  await expect(page.locator('.mode-hero')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /баннер/ })).toHaveCount(0);
});
