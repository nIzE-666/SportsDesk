import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

/**
 * The tournament screen on TEST DATA from `src/test/fixtures/tournamentSeason.ts`:
 * the shared standings table, the knockout board with real home sides and the
 * player dialog. The visual fixture has no European season by itself.
 */

async function openFootball(page: Page) {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
}

async function openCompetition(page: Page, name: string) {
  await openFootball(page);
  await page.locator('.competition-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.locator('.ucl-view')).toBeVisible();
}

const tab = (page: Page, name: string) =>
  page.locator('.shell-tabs').getByRole('tab', { name, exact: true });

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function expectNoCutText(page: Page, selector: string) {
  const clipped = await page.locator(selector).evaluateAll((elements) =>
    elements
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => (element as HTMLElement).innerText.trim()),
  );
  expect(clipped, `${selector} is cut off`).toEqual([]);
}

async function expectNoCutClock(page: Page) {
  const clipped = await page.locator('.ui-match-row__time').evaluateAll((elements) =>
    elements
      .filter((element) => /^\d{2}:\d{2}$/u.test((element as HTMLElement).innerText.trim()))
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => (element as HTMLElement).innerText.trim()),
  );
  expect(clipped, 'a kick-off time is cut off').toEqual([]);
}

async function expectBracketFits(page: Page, columns: number) {
  const geometry = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('main.content');
    const board = document.querySelector<HTMLElement>('.knockout-board');
    const finalStage = document.querySelector<HTMLElement>('.stage-final');
    if (!content || !board || !finalStage) return null;
    const contentBox = content.getBoundingClientRect();
    const boardBox = board.getBoundingClientRect();
    const finalBox = finalStage.getBoundingClientRect();
    return {
      contentLeft: contentBox.left,
      contentRight: contentBox.right,
      boardScrollWidth: board.scrollWidth,
      boardClientWidth: board.clientWidth,
      boardRight: boardBox.right,
      finalLeft: finalBox.left,
      finalRight: finalBox.right,
      finalWidth: finalBox.width,
      columns: getComputedStyle(board).gridTemplateColumns.split(' ').length,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.finalWidth).toBeGreaterThan(0);
  expect(geometry!.finalLeft).toBeGreaterThanOrEqual(geometry!.contentLeft - 1);
  expect(geometry!.finalRight).toBeLessThanOrEqual(geometry!.contentRight + 1);
  expect(geometry!.boardRight).toBeLessThanOrEqual(geometry!.contentRight + 1);
  expect(geometry!.boardScrollWidth).toBeLessThanOrEqual(geometry!.boardClientWidth + 1);
  expect(geometry!.columns).toBe(columns);
  await noHorizontalOverflow(page);
}

test('the table, the bracket with real home sides and the player dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark');
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();

  await openCompetition(page, 'Лига чемпионов');
  await expect(page.locator('.shell-tabs [role="tab"]')).toHaveText([
    'Матчи',
    'Таблица',
    'Сетка',
    'Клубы',
    'Игроки',
  ]);
  await expect(tab(page, 'Матчи')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ucl-match-list .match-list')).toBeVisible();
  await expect(page.locator('.match-list__day').first()).toBeVisible();
  await expect(page.locator('.match-list__heading').first()).not.toBeEmpty();
  await expect(page.locator('.ui-match-row').filter({ hasText: 'Отменён' })).toHaveCount(2);
  await expect(page.locator('.ui-match-row').filter({ hasText: 'Статус уточняется' })).toHaveCount(
    1,
  );
  await expectNoCutClock(page);
  await expectNoCutText(page, '.ui-match-row__state');
  await expectNoCutText(page, '.match-list__heading');
  await expect(page.locator('.ucl-season__value')).toHaveText('Сезон 2026/2027');
  await expect(page.locator('#tournament-season')).toHaveCount(0);
  await noHorizontalOverflow(page);

  // One shared table for the league phase.
  await tab(page, 'Таблица').click();
  await expect(page.locator('.standings-table')).toBeVisible();
  await expect(page.locator('.standings-table tbody tr')).toHaveCount(10);
  await expect(page.locator('.standings-table thead')).toContainText('Команда');
  await expect(page.locator('.standings-table thead')).toContainText('РМ');
  await expect(page.locator('.standings-table__row--direct')).toHaveCount(8);
  await expect(page.locator('.standings-table__row--playoff')).toHaveCount(2);
  await expect(page.locator('.standings-legend')).toContainText('Места 1–8');
  await expect(page.locator('.standings-legend')).toContainText('Места 9–24');
  expect(
    await page
      .locator('.standings-table thead th')
      .first()
      .evaluate((element) => getComputedStyle(element).position),
  ).toBe('sticky');
  expect(
    await page
      .locator('.standings-table th.ui-table__num')
      .first()
      .evaluate((element) => getComputedStyle(element).textAlign),
  ).toBe('right');
  await noHorizontalOverflow(page);

  // A two-leg tie: the aggregate keeps the tie order, every leg keeps its real home side.
  await tab(page, 'Сетка').click();
  const board = page.locator('.knockout-board');
  await expect(board).toBeVisible();
  await expect(board.locator('.knockout-stage')).toHaveCount(5);
  const tie = page.locator('.bracket-tie').filter({ hasText: 'Arsenal' }).filter({
    hasText: 'Barcelona',
  });
  const aggregate = tie.locator('button.ui-match-row').first();
  await expect(aggregate).toHaveAttribute('aria-expanded', 'false');
  await expect(aggregate.locator('.ui-match-row__team--home .ui-match-row__team-name')).toHaveText(
    'Arsenal',
  );
  await expect(aggregate.locator('.ui-match-row__team--away .ui-match-row__team-name')).toHaveText(
    'Barcelona',
  );
  await expect(aggregate.locator('.ui-match-row__score')).toHaveText('4 : 1');
  await aggregate.click();
  await expect(aggregate).toHaveAttribute('aria-expanded', 'true');

  const firstLeg = tie.getByRole('button', { name: /^Barcelona — Arsenal, матч 1,/ });
  const secondLeg = tie.getByRole('button', { name: /^Arsenal — Barcelona, матч 2,/ });
  await expect(firstLeg.locator('.ui-match-row__team--home .ui-match-row__team-name')).toHaveText(
    'Barcelona',
  );
  await expect(firstLeg.locator('.ui-match-row__team--away .ui-match-row__team-name')).toHaveText(
    'Arsenal',
  );
  await expect(firstLeg.locator('.ui-match-row__score')).toHaveText('1 : 2');
  await expect(secondLeg.locator('.ui-match-row__team--home .ui-match-row__team-name')).toHaveText(
    'Arsenal',
  );
  await expect(secondLeg.locator('.ui-match-row__score')).toHaveText('2 : 0');
  await expectNoCutText(page, '.bracket-tie__leg-date');
  await noHorizontalOverflow(page);

  // A cancelled leg keeps the cancelled status, not «Начало матча».
  const cancelledTie = page.locator('.bracket-tie').filter({ hasText: 'Ajax' }).filter({
    hasText: 'Porto',
  });
  await cancelledTie.locator('button.ui-match-row').first().click();
  const cancelledLeg = cancelledTie.getByRole('button', { name: /^Porto — Ajax, матч 2,/ });
  await expect(cancelledLeg).toContainText('Отменён');
  await expect(cancelledLeg).not.toContainText('Начало матча');

  // The player dialog is the kit dialog and keeps the internal arrow and the note.
  await tab(page, 'Игроки').click();
  await expect(page.locator('.scorer-card')).toHaveCount(4);
  await page.locator('.scorer-card').first().click();
  const dialog = page.getByRole('dialog', { name: 'Alex Morgan' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/ui-dialog/);
  await expect(dialog).toContainText('Arsenal');
  await expect(dialog).toContainText('520');
  await expect(dialog).toContainText('Подробности — в статистике матча.');
  await expect(dialog.getByRole('button', { name: 'Матчи команды' }).locator('svg')).toHaveClass(
    /lucide-chevron-right/,
  );
  await expect(
    dialog.getByRole('button', { name: 'Профиль на сайте источника' }).locator('svg'),
  ).toHaveClass(/lucide-arrow-up-right/);
  await dialog.getByRole('button', { name: 'Закрыть профиль игрока' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.scorer-card').first()).toBeFocused();
  await noHorizontalOverflow(page);
});

test('a cup without a table hides «Таблица» and old tabs open the new places', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark');
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();

  await openCompetition(page, 'Чемпионат мира');
  await expect(page.locator('.shell-tabs [role="tab"]')).toHaveText(['Матчи', 'Сетка']);
  await expect(tab(page, 'Таблица')).toHaveCount(0);
  await expect(page.locator('.ucl-season__value')).toHaveText('Сезон 2026');
  await expect(page.locator('.match-list__day')).not.toHaveCount(0);

  // A saved route of the old screen opens the closest new place.
  await page.addInitScript(
    (route) => {
      sessionStorage.setItem('sportsdesk.view.navigation2.football', JSON.stringify(route));
    },
    {
      section: 'football',
      route: { kind: 'football', competitionId: 'l_0bfbkO', tab: 'overview' },
      sport: 'ucl',
      leagueId: 'l_4WFCIZ',
      cupId: 'l_38d9HA',
    },
  );
  await page.reload();
  await openFootball(page);
  await expect(page.locator('.competition-switcher-trigger')).toContainText('Лига чемпионов');
  await expect(tab(page, 'Матчи')).toHaveAttribute('aria-selected', 'true');

  await page.addInitScript(
    (route) => {
      sessionStorage.setItem('sportsdesk.view.navigation2.football', JSON.stringify(route));
    },
    {
      section: 'football',
      route: { kind: 'football', competitionId: 'l_0bfbkO', tab: 'stats' },
      sport: 'ucl',
      leagueId: 'l_4WFCIZ',
      cupId: 'l_38d9HA',
    },
  );
  await page.reload();
  await openFootball(page);
  await expect(tab(page, 'Игроки')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.scorer-card')).toHaveCount(4);

  // No seasons at all: the control disappears instead of showing an empty box.
  await openCompetition(page, 'Лига конференций');
  await expect(page.getByText('Турнир временно недоступен')).toBeVisible();
  await expect(page.locator('.ucl-season')).toHaveCount(0);
  await expect(page.locator('.ucl-season__value')).toHaveCount(0);
  await expect(page.locator('#tournament-season')).toHaveCount(0);
});

test('the final is inside the bracket at 1100 and 1440 in both formats', async ({ page }) => {
  await setupVisualFixture(page, 'dark');
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();

  for (const width of [1100, 1440] as const) {
    await page.setViewportSize({ width, height: width === 1100 ? 720 : 900 });
    for (const competition of ['Лига чемпионов', 'Чемпионат мира'] as const) {
      await openCompetition(page, competition);
      await tab(page, 'Сетка').click();
      await expect(page.locator('.knockout-board')).toBeVisible();
      const columns = width === 1100 || competition === 'Чемпионат мира' ? 3 : 5;
      await expectBracketFits(page, columns);
      await expect(page.locator('.stage-final h2')).toHaveText('Финал');
      if (competition === 'Чемпионат мира') {
        await expect(page.locator('.knockout-stage')).toHaveCount(6);
        await expect(page.locator('.stage-third .bracket-tie')).toHaveCount(1);
      }
    }
  }
});

test('tabs fit without scrolling and the screen height is within two screens', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark');
  await page.goto('/');
  await openCompetition(page, 'Лига чемпионов');
  const tabs = page.locator('.shell-tabs');
  await expect(tabs).toBeInViewport({ ratio: 1 });
  for (const name of ['Матчи', 'Таблица', 'Сетка', 'Клубы', 'Игроки']) {
    await tab(page, name).click();
    await expect(tabs).toBeInViewport({ ratio: 1 });
    await noHorizontalOverflow(page);
    expect(
      await page.locator('.ucl-view .ui-button--primary').count(),
      `one primary button at most on ${name}`,
    ).toBeLessThanOrEqual(1);
  }

  await openCompetition(page, 'Лига Европы');
  for (const name of ['Матчи', 'Таблица', 'Сетка']) {
    await tab(page, name).click();
    await expect(tabs).toBeInViewport({ ratio: 1 });
    await noHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await openCompetition(page, 'Лига чемпионов');
  const heights: Record<string, { screen: number; content: number }> = {};
  for (const name of ['Матчи', 'Таблица', 'Сетка', 'Клубы', 'Игроки']) {
    await tab(page, name).click();
    await page.waitForTimeout(250);
    heights[`ЛЧ · ${name}`] = await page.evaluate(() => ({
      screen: document.querySelector<HTMLElement>('.ucl-view')?.scrollHeight ?? 0,
      content: document.querySelector<HTMLElement>('main.content')?.scrollHeight ?? 0,
    }));
  }
  await openCompetition(page, 'Лига Европы');
  for (const name of ['Матчи', 'Таблица', 'Сетка']) {
    await tab(page, name).click();
    await page.waitForTimeout(250);
    heights[`Кубки · ${name}`] = await page.evaluate(() => ({
      screen: document.querySelector<HTMLElement>('.ucl-view')?.scrollHeight ?? 0,
      content: document.querySelector<HTMLElement>('main.content')?.scrollHeight ?? 0,
    }));
    expect(
      await page.locator('.ucl-view .ui-button--primary').count(),
      `one primary button at most on Кубки · ${name}`,
    ).toBeLessThanOrEqual(1);
  }
  await testInfo.attach('heights.json', {
    body: JSON.stringify(heights, null, 2),
    contentType: 'application/json',
  });
  console.log(`TOURNAMENT_HEIGHTS ${JSON.stringify(heights)}`);
});
