import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

for (const design of ['classic', 'broadcast']) {
  test(`${design}: overviews have useful headings without slogan banners`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await setupVisualFixture(page, design, 'dark', true);
    await page.goto('/');
    await expect(page.locator('.football-dashboard')).toContainText('Arsenal');
    await expect(page.locator('.football-dashboard h1')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('football.png') });
    for (const [sport, heading] of [
      ['Формула 1', 'Ваш гоночный уикенд'],
      ['Лига чемпионов', 'Европейский вечер'],
      ['Кубки', 'Лига Европы'],
    ]) {
      await page.getByRole('tab', { name: sport, exact: true }).click();
      if (sport === 'Формула 1')
        await page.locator('aside').getByTitle('Паддок', { exact: true }).click();
      await expect(page.locator('main h1')).toContainText(heading);
      await expect(page.locator('.mode-hero')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /баннер/ })).toHaveCount(0);
    }
  });
}
