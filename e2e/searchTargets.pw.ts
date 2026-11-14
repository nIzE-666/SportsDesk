import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

async function openShell(page: Page) {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'classic', 'dark', true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
}

async function search(page: Page, query: string) {
  await page.getByRole('button', { name: 'Поиск · Ctrl+K' }).click();
  const dialog = page.getByRole('dialog', { name: 'Глобальный поиск' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill(query);
  return dialog;
}

test('an old offline link opens «Настройки → Данные»', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'classic', 'dark', true);
  await page.addInitScript(() =>
    localStorage.setItem(
      'sportsdesk.search.index',
      JSON.stringify([
        {
          key: 'section:offline',
          title: 'Офлайн-сезоны',
          subtitle: 'Раздел',
          target: { kind: 'section', id: 'offline' },
        },
      ]),
    ),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  const dialog = await search(page, 'Офлайн-сезоны');
  await dialog.locator('[role="option"]').filter({ hasText: 'Офлайн-сезоны' }).first().click();
  await expect(page.locator('.settings-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Данные', exact: true })).toBeVisible();
  await expect(page.locator('.settings-offline')).toBeVisible();
});

test('search targets open «Моё», settings, a cup and Formula 1 analysis', async ({ page }) => {
  await openShell(page);

  let dialog = await search(page, 'Дневник');
  await expect(dialog.getByRole('option').first()).toContainText('Дневник');
  await dialog.locator('[role="option"]').filter({ hasText: 'Дневник' }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.diary-view')).toBeVisible();
  await expect(
    page.locator('.shell-tabs').getByRole('tab', { name: 'Дневник', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');

  dialog = await search(page, 'Источники');
  await expect(dialog.getByRole('option').first()).toContainText('Источники');
  await dialog.locator('[role="option"]').filter({ hasText: 'Источники' }).first().click();
  await expect(page.locator('.settings-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Источники', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Категории настроек' })
      .getByRole('button', { name: 'Источники', exact: true }),
  ).toHaveAttribute('aria-current', 'true');

  dialog = await search(page, 'Лига Европы');
  await expect(dialog.getByRole('option').first()).toContainText('Лига Европы');
  await dialog.locator('[role="option"]').filter({ hasText: 'Лига Европы' }).first().click();
  await expect(page.locator('.ucl-view')).toBeVisible();
  await expect(page.locator('.competition-switcher-trigger')).toContainText('Лига Европы');
  await expect(
    page.locator('.shell-tabs').getByRole('tab', { name: 'Обзор', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');

  dialog = await search(page, 'Анализ');
  await expect(dialog.getByRole('option').first()).toContainText('Анализ');
  await dialog.locator('[role="option"]').filter({ hasText: 'Анализ' }).first().click();
  await expect(page.locator('.f1-analysis')).toBeVisible();
  await expect(
    page.locator('.shell-tabs').getByRole('tab', { name: 'Анализ', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
});
