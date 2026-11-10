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

test('empty planner hides filters while retaining a way to refresh', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'broadcast', 'dark');
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source');
    const path = url.searchParams.get('path') ?? '';
    if (source !== 'pitch' && source !== 'jolpica') return route.fallback();
    const payload =
      source === 'jolpica'
        ? { MRData: { RaceTable: { Races: [] } } }
        : path === 'leagues'
          ? {
              data: {
                leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }],
              },
            }
          : { data: { league: { id: 'l_4WFCIZ', name: 'Premier League' }, matches: [] } };
    await route.fulfill({
      json: { payload, source, stale: false, fetchedAt: '2026-10-25T00:00:00Z' },
    });
  });
  await page.goto('/');
  await page.locator('aside').getByTitle('Мой спортивный вечер').click();
  await expect(
    page.getByText('Когда расписание появится, события будут показаны здесь.'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Период плана' })).toHaveCount(0);
  await expect(page.locator('.planner-insights')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обновить расписание' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('empty-planner.png') });
});
