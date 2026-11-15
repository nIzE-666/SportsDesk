import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

test('F1 headings, season and layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/bridge/api') requests.push(url.searchParams.get('path') ?? '');
  });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Формула 1', exact: true })
    .click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Обзор', exact: true }).click();
  await expect(page.locator('.f1-overview-grid')).toBeVisible();
  const overview = page.locator('.f1-overview-grid');
  const favoriteGrid = page.locator('.f1-overview-favorites');
  await expect(favoriteGrid).toContainText('Пилоты избранных команд');
  expect((await favoriteGrid.boundingBox())!.y).toBeGreaterThan((await overview.boundingBox())!.y);
  await expect(overview).toContainText('Гран-при Китая');
  await expect(page.locator('.f1-root')).not.toContainText('Grand Prix');
  await expect(page.locator('.f1-root .f1-sourcebar')).toHaveCount(1);
  const refresh = page
    .locator('.f1-root > .f1-toolbar')
    .getByRole('button', { name: 'Обновить данные' });
  await expect(refresh).toBeEnabled();
  const scheduleRequests = requests.filter((path) => path.startsWith('2026.json')).length;
  const standingsRequests = requests.filter((path) => path.includes('driverStandings')).length;
  await refresh.click();
  await expect
    .poll(() => requests.filter((path) => path.startsWith('2026.json')).length)
    .toBeGreaterThan(scheduleRequests);
  await expect
    .poll(() => requests.filter((path) => path.includes('driverStandings')).length)
    .toBeGreaterThan(standingsRequests);
  await page.screenshot({ path: testInfo.outputPath('f1-overview.png') });
  const tabs = page.locator('.shell-tabs');
  await tabs.getByRole('tab', { name: 'Зачёты', exact: true }).click();
  await expect(page.locator('.f1-root h1')).toHaveText('Зачёты');
  await expect(page.locator('.f1-root select[aria-label*="Сезон"]')).toHaveCount(1);
  await tabs.getByRole('tab', { name: 'Анализ', exact: true }).click();
  await expect(page.locator('.f1-root h1')).toHaveText('Анализ');
  const modes = page.getByRole('tablist', { name: 'Режим анализа' });
  await expect(modes).toBeVisible();
  for (const title of ['Сравнение пилотов', 'Темп по кругам', 'Центр сессии']) {
    await modes.getByRole('tab', { name: title, exact: true }).click();
    await expect(modes.getByRole('tab', { name: title, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('Гран-при')).toBeVisible();
    await expect(page.locator('.f1-root select[aria-label*="Сезон"]')).toHaveCount(1);
    await expect(page.getByRole('tablist', { name: 'Разделы Формулы-1' })).toHaveCount(0);
  }
  await page.getByLabel('Сезон Формулы-1').selectOption('2025');
  await expect.poll(() => requests.some((path) => path.includes('meetings?year=2025'))).toBe(true);
});
