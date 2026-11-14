import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

const LIVE_DAY = JSON.parse(
  readFileSync('src/test/fixtures/liveSources/livescore-date-20261108-offset9.json', 'utf8'),
) as unknown;

test('source information and settings remain clear when saved data is stale', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'broadcast', 'dark');
  await page.clock.setFixedTime(new Date('2026-11-08T10:00:00Z'));
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('source') !== 'livescore') return route.fallback();
    await route.fulfill({
      json: {
        payload: LIVE_DAY,
        source: 'livescore',
        fetchedAt: '2026-11-08T10:00:00Z',
        stale: true,
      },
    });
  });
  await page.goto('/');
  await page.locator('aside').getByTitle('Счёт и события', { exact: true }).click();
  await expect(page.locator('.live-flat-list')).toContainText('Arsenal');
  await expect(page.locator('.live-view .source-foot')).toHaveCount(1);
  await expect(page.locator('.live-view .source-foot')).toContainText('LiveScore');
  await expect(page.locator('.live-view .source-foot')).toContainText('устаревшими');
  await page.getByRole('button', { name: 'Настройки', exact: true }).first().click();
  await expect(page.locator('.settings-view h1')).toHaveText('Настройки');
  await page
    .getByRole('navigation', { name: 'Категории настроек' })
    .getByRole('button', { name: 'Источники', exact: true })
    .click();
  await expect(page.locator('.settings-category > h2')).toHaveText('Источники');
  await expect(page.locator('.settings-view')).toContainText('Ключи хранятся в зашифрованном виде');
  await expect(page.locator('.settings-view')).not.toContainText(
    /DPAPI|JS-бандл|localStorage|опрос на Rust/,
  );
  await page.screenshot({ path: testInfo.outputPath('settings.png') });
});
