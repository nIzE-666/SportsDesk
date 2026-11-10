import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

for (const design of ['classic', 'broadcast']) {
  test(`${design}: F1 headings, season and layout`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await setupVisualFixture(page, design, 'dark', true);
    const requests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/bridge/api') requests.push(url.searchParams.get('path') ?? '');
    });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Формула 1' }).click();
    await page.locator('aside').getByTitle('Паддок', { exact: true }).click();
    await expect(page.locator('.f1-overview-grid')).toBeVisible();
    const overview = page.locator('.f1-overview-grid');
    const favoriteGrid = page.locator('.f1-overview-favorites');
    await expect(favoriteGrid).toContainText('Пилоты избранных команд');
    expect((await favoriteGrid.boundingBox())!.y).toBeGreaterThan(
      (await overview.boundingBox())!.y,
    );
    await page.screenshot({ path: testInfo.outputPath('f1-overview.png') });
    for (const title of ['Зачёты', 'Сравнение пилотов', 'Темп по кругам', 'Центр сессии']) {
      await page.locator('aside').getByTitle(title, { exact: true }).click();
      await expect(page.locator('.f1-root h1')).toHaveText(title);
      await expect(page.locator('.f1-root select[aria-label*="Сезон"]')).toHaveCount(1);
      await expect(page.getByRole('tablist', { name: 'Разделы Формулы-1' })).toHaveCount(0);
    }
    await page.getByLabel('Сезон Формулы-1').selectOption('2025');
    await expect
      .poll(() => requests.some((path) => path.includes('meetings?year=2025')))
      .toBe(true);
  });
}
