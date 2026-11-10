import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

test('source information and settings remain clear when saved data is stale', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'broadcast', 'dark');
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.searchParams.get('source') !== 'sportscore' ||
      !(url.searchParams.get('path') ?? '').startsWith('matches/')
    )
      return route.fallback();
    await route.fulfill({
      json: {
        payload: {
          matches: [
            {
              home: 'Arsenal',
              away: 'Chelsea',
              competition: 'Premier League',
              status: 'live',
              home_score: 1,
              away_score: 0,
            },
          ],
        },
        source: 'sportscore',
        fetchedAt: '2026-10-25T00:00:00Z',
        stale: true,
      },
    });
  });
  await page.goto('/');
  await page.locator('aside').getByTitle('Счёт и события', { exact: true }).click();
  await expect(page.locator('.live-flat-list')).toContainText('Arsenal');
  await expect(page.locator('.live-view .source-foot')).toHaveCount(1);
  await expect(page.locator('.live-view .source-foot')).toContainText('устаревшими');
  await page.getByRole('button', { name: 'Настройки', exact: true }).first().click();
  await expect(page.locator('.settings-view h1')).toHaveText('Настройки');
  await expect(page.locator('.settings-view')).toContainText('Ключи хранятся в зашифрованном виде');
  await expect(page.locator('.settings-view')).not.toContainText(
    /DPAPI|JS-бандл|localStorage|опрос на Rust/,
  );
  await page.screenshot({ path: testInfo.outputPath('settings.png') });
});
