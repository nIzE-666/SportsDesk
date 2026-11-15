import { test, expect } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

for (const scheme of ['dark', 'light'])
  for (const width of [1100, 1440]) {
    test(`${scheme} ${width}: dashboard, match and calendar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = await setupVisualFixture(page, scheme);
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('.app-root')).toHaveAttribute('data-scheme', scheme);
      await expect(page.locator('.today-view')).toBeVisible();
      const shot = async (name: string) => {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await expect(page).toHaveScreenshot(`broadcast-${scheme}-${width}-${name}.png`, {
          fullPage: true,
        });
      };
      await shot('dashboard');
      const rail = page.getByRole('navigation', { name: 'Разделы' });
      await rail.getByRole('button', { name: 'Футбол', exact: true }).click();
      await page.locator('.shell-tabs').getByRole('tab', { name: 'Матчи', exact: true }).click();
      await page.locator('[data-match-id="test-match"] .fixture-club').first().click();
      await expect(page.locator('.md-score')).toContainText('2 : 1');
      await page.getByRole('tab', { name: 'Статистика' }).click();
      await expect(page.locator('.match-statistics')).toContainText('62');
      await shot('statistics');
      await page.getByRole('tab', { name: 'Поле и оценки' }).click();
      await expect(page.locator('.match-lineups')).toContainText('Alex Morgan');
      await page.locator('.lineup-pitch').scrollIntoViewIfNeeded();
      await shot('lineups');
      await rail.getByRole('button', { name: 'Формула 1', exact: true }).click();
      await page
        .locator('.shell-tabs')
        .getByRole('tab', { name: 'Календарь', exact: true })
        .click();
      await expect(page.locator('.calendar-board')).toContainText('Circuit');
      await shot('calendar');
      expect(errors).toEqual([]);
    });
  }

test('match actions and tabs fit in a 720px window', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark');
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Матчи', exact: true }).click();
  await page.locator('[data-match-id="test-match"] .fixture-club').first().click();
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  await expect(page.locator('.md-actions').getByRole('button', { name: 'Смотреть' })).toBeVisible();
  await expect(
    page.locator('.md-actions').getByRole('button', { name: 'Отметить просмотр' }),
  ).toBeVisible();
  await expect(
    page.locator('.md-actions').getByRole('button', { name: 'Без спойлеров' }),
  ).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Разделы матча' });
  await expect(tabs).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('match.png') });
});

test('keyboard search, events and match viewing', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  const errors = await setupVisualFixture(page, 'dark');
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Поиск' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveScreenshot('broadcast-search.png');
  const overlay = await page.locator('.ui-dialog-scrim').boundingBox();
  expect(overlay?.height).toBe(900);
  await page.getByRole('combobox').fill('Arsenal Chelsea');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('combobox').press('Enter');
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  await page.locator('.md-actions').getByRole('button', { name: 'Смотреть', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Просмотр события' })).toContainText(
    'Arsenal — Chelsea',
  );
  await expect(page.locator('.watch-root-signed-out')).toBeVisible();
  await page
    .locator('.shell-header-bar')
    .getByRole('button', { name: 'Назад', exact: true })
    .click();
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'События', exact: true })
    .click();
  await expect(page.locator('.event-entry.unread')).toHaveCount(1);
  await expect(page.locator('.event-center')).toHaveScreenshot('broadcast-events.png');
  await page.getByRole('button', { name: 'Прочитать все', exact: true }).click();
  await expect(page.locator('.event-entry.unread')).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть матч', exact: true }).click();
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  expect(errors).toEqual([]);
});
