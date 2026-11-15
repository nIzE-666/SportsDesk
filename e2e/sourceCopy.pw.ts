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
        stale: true,
      },
    });
  });
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: 'Разделы' });
  await rail.getByRole('button', { name: 'Футбол', exact: true }).click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Матчи', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Фильтр матчей' })
    .getByRole('radio', { name: 'Сейчас идут', exact: true })
    .click();
  await expect(page.locator('.live-panel')).toContainText('Arsenal');
  await expect(page.locator('.live-panel .source-foot')).toHaveCount(1);
  await expect(page.locator('.live-panel .source-foot')).toContainText('LiveScore');
  await expect(page.locator('.live-panel .source-foot')).toContainText('устаревшими');
  await rail.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.locator('.shell-page-title')).toHaveText('Настройки');
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
