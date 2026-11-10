import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

test('empty diary and event center keep useful actions without empty filters', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'broadcast', 'dark');
  await page.route('**/bridge/command', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: body.command === 'event_center_list' ? [] : {} });
  });
  await page.goto('/');
  await page.locator('aside').getByTitle('Дневник просмотра').click();
  await expect(page.getByText('Сохраните первый просмотр')).toBeVisible();
  await expect(page.locator('.diary-filter-panel')).toHaveCount(0);
  await expect(page.locator('.diary-summary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить просмотр вручную' })).toBeVisible();
  await expect(page.locator('.diary-import')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('empty-diary.png') });
  await page.getByRole('button', { name: 'Центр событий' }).click();
  await expect(page.getByText('Пока нет событий')).toBeVisible();
  await expect(page.locator('.event-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обновить', exact: true }).first()).toBeVisible();
});
