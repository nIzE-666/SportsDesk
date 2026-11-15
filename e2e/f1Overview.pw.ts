import { expect, test, type Page } from '@playwright/test';
import { setupF1Fixture } from './f1Fixture';

/**
 * U4.6: the Formula 1 overview reads as four compact blocks, the calendar,
 * standings and analysis use the kit, and no F1 stop keeps a long explanatory
 * text. Sizes: 1440×900 is the target; 1100×720 guards the narrow window.
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Разделы' });
async function openF1(page: Page) {
  await page.goto('/');
  await rail(page).getByRole('button', { name: 'Формула 1', exact: true }).click();
  await expect(page.locator('.f1-root')).toBeVisible();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Обзор', exact: true }).click();
  await page.waitForTimeout(500);
}
const tab = (page: Page, name: string) =>
  page.locator('.shell-tabs').getByRole('tab', { name, exact: true }).click();

async function longTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('.f1-root');
    if (!root) return [];
    const visible = (element: Element) => {
      if (element.closest('.ui-tooltip__bubble')) return false;
      const style = getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0
      );
    };
    const out: string[] = [];
    for (const element of Array.from(
      root.querySelectorAll('p, small, .muted, .eyebrow, [class*="note"], summary, label'),
    )) {
      if (!visible(element)) continue;
      const text = (element as HTMLElement).innerText.replace(/\s+/gu, ' ').trim();
      if (text && text.split(' ').length >= 6) out.push(text);
    }
    return out;
  });
}

test('overview is compact and shows the weekend, podium, top five and favourites', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupF1Fixture(page, 'dark');
  await openF1(page);

  const root = page.locator('.f1-root');
  const weekend = page.locator('[aria-label="Расписание уикенда"]');
  const lastRace = page.locator('[aria-label="Последняя гонка"]');
  const championship = page.locator('[aria-label="Чемпионат"]');
  const favourites = page.locator('[aria-label="Избранные пилоты"]');

  await expect(weekend).toContainText('Гран-при Лас-Вегаса');
  await expect(weekend.locator('.f1-session-row')).toHaveCount(5);
  await expect(weekend).toContainText('Практика 1');
  await expect(weekend).toContainText('Гонка');
  await expect(lastRace).toContainText('Гран-при Японии');
  await expect(lastRace).toContainText('Победитель');
  await expect(lastRace).toContainText('БК');

  const top = championship.locator('tbody tr');
  await expect(top).toHaveCount(5);
  await expect(top.nth(0)).toContainText('Max Verstappen');
  await expect(top.nth(0).locator('td').last()).toHaveText('0');
  await expect(top.nth(1).locator('td').last()).toHaveText('−20');
  await expect(top.nth(4)).toContainText('George Russell');
  const constructorLeader = championship.locator('.f1-constructor-leader');
  await expect(constructorLeader).toContainText('Кубок конструкторов:');
  await expect(constructorLeader).toContainText('Red Bull');
  await expect(constructorLeader).toContainText('520 очков');

  const favouriteRows = favourites.locator('tbody tr');
  await expect(favouriteRows).toHaveCount(4);
  await expect(favouriteRows.nth(0)).toContainText('Max Verstappen');
  await expect(favouriteRows.nth(1)).toContainText('Lando Norris');
  await expect(favouriteRows.nth(1).locator('td').last()).toHaveText('−20');
  await expect(favourites).toContainText('Red Bull');
  await expect(favourites).toContainText('Ferrari');

  // The table columns keep the same alignment as every other `.ui-table`.
  const gaps = favourites.locator('tbody td:last-child');
  for (let index = 0; index < (await gaps.count()); index += 1) {
    expect(await gaps.nth(index).evaluate((cell) => getComputedStyle(cell).textAlign)).toBe(
      'right',
    );
  }

  // One primary action, one source line, no horizontal overflow, 1.5 screens.
  await expect(page.locator('.f1-root .ui-button--primary:visible')).toHaveCount(1);
  await expect(page.locator('.f1-root .f1-sourcebar')).toHaveCount(1);
  await expect(page.locator('.f1-root .f1-sourcebar')).toContainText('Jolpica');
  expect(await root.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  expect(await root.evaluate((element) => element.scrollHeight)).toBeLessThanOrEqual(1350);
  // Header tabs are visible without scrolling.
  const tabs = await page.locator('.shell-tabs').boundingBox();
  expect(tabs!.y + tabs!.height).toBeLessThan(900);
});

test('calendar, standings and analysis use the kit and keep the shared choice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupF1Fixture(page, 'dark');
  await openF1(page);

  await tab(page, 'Календарь');
  await expect(page.locator('.calendar-next.ui-panel')).toBeVisible();
  await page.getByRole('radio', { name: /Все этапы/ }).click();
  await expect(page.locator('.calendar-stage')).toHaveCount(5);
  await expect(page.locator('.calendar-stage .ui-badge').first()).toContainText('Ближайший');
  expect(
    await page.locator('.f1-root').evaluate((element) => element.scrollHeight),
  ).toBeLessThanOrEqual(1800);

  await tab(page, 'Зачёты');
  const standings = page.locator('.f1-standings');
  await expect(standings).toBeVisible();
  await expect(standings.locator('.ui-table')).toHaveCount(1);
  await expect(standings.locator('tbody tr')).toHaveCount(10);
  await standings.locator('tbody tr').first().click();
  await expect(standings.locator('.f1-expand')).toContainText('Код');
  await page
    .getByRole('tablist', { name: 'Зачёты сезона' })
    .getByRole('tab', { name: 'Команды', exact: true })
    .click();
  await expect(standings.locator('tbody tr')).toHaveCount(6);
  await expect(page.locator('.f1-root .f1-card')).toHaveCount(0);
  await expect(page.locator('.f1-root .ui-button--primary:visible')).toHaveCount(0);

  await tab(page, 'Анализ');
  const modes = page.getByRole('tablist', { name: 'Режим анализа' });
  await expect(modes.getByRole('tab')).toHaveCount(3);
  await expect(page.locator('.f1-root select[aria-label*="Сезон"]')).toHaveCount(1);
  const choice = page.locator('.f1-analysis-choice');
  await expect(choice.getByLabel('Гран-при')).toHaveCount(1);
  await expect(choice.getByLabel('Сессия')).toHaveCount(1);
  await modes.getByRole('tab', { name: 'Темп по кругам', exact: true }).click();
  const chosen = await choice.getByLabel('Сессия').inputValue();
  expect(chosen).not.toBe('');
  await modes.getByRole('tab', { name: 'Центр сессии', exact: true }).click();
  await expect(choice.getByLabel('Сессия')).toHaveValue(chosen);
  await modes.getByRole('tab', { name: 'Сравнение пилотов', exact: true }).click();
  expect(
    await page.locator('.f1-root').evaluate((element) => element.scrollHeight),
  ).toBeLessThanOrEqual(1800);
  await modes.getByRole('tab', { name: 'Центр сессии', exact: true }).click();
  await expect(choice.getByLabel('Сессия')).toHaveValue(chosen);
  await expect(page.locator('.f1-root .f1-card')).toHaveCount(0);
  expect(
    await page.locator('.f1-root').evaluate((element) => element.scrollHeight),
  ).toBeLessThanOrEqual(1800);
});

for (const scheme of ['dark', 'light'] as const) {
  test(`session names use the primary text role in the ${scheme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupF1Fixture(page, scheme);
    await openF1(page);

    const overviewLabel = page.locator('.f1-session-label').first();
    const overviewTitle = page.locator('[aria-label="Расписание уикенда"] .ui-panel__title');
    expect(await overviewLabel.evaluate((element) => getComputedStyle(element).color)).toBe(
      await overviewTitle.evaluate((element) => getComputedStyle(element).color),
    );

    await tab(page, 'Календарь');
    const calendarLabel = page.locator('.weekend-schedule .ui-stat__label').first();
    const calendarTitle = page.locator('.race-weekend .ui-panel__title');
    expect(await calendarLabel.evaluate((element) => getComputedStyle(element).color)).toBe(
      await calendarTitle.evaluate((element) => getComputedStyle(element).color),
    );
  });
}

test('no Formula 1 stop keeps a long explanatory text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupF1Fixture(page, 'dark');
  await openF1(page);
  expect(await longTexts(page)).toEqual([]);

  await tab(page, 'Календарь');
  expect(await longTexts(page)).toEqual([]);
  await tab(page, 'Зачёты');
  expect(await longTexts(page)).toEqual([]);
  await tab(page, 'Анализ');
  const modes = page.getByRole('tablist', { name: 'Режим анализа' });
  for (const mode of ['Сравнение пилотов', 'Темп по кругам', 'Центр сессии']) {
    await modes.getByRole('tab', { name: mode, exact: true }).click();
    await page.waitForTimeout(300);
    expect(await longTexts(page), mode).toEqual([]);
  }
});
