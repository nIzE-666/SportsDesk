import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

const rail = (page: Page) => page.getByRole('navigation', { name: 'Разделы' });

async function openPlayers(page: Page) {
  await rail(page).getByRole('button', { name: 'Футбол', exact: true }).click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Игроки', exact: true }).click();
  await expect(page.locator('.players-view')).toBeVisible();
}

async function seedFavorites(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'sportsdesk.football.favorites.players',
      JSON.stringify([
        {
          id: 'a',
          name: 'Alex Morgan',
          teamId: 'arsenal',
          teamName: 'Arsenal',
          matchId: 'test-match',
          matchLabel: 'Arsenal — Chelsea',
          savedAt: '2026-10-21',
        },
        {
          id: 'c',
          name: 'Jamie Wilson',
          teamId: 'chelsea',
          teamName: 'Chelsea',
          matchId: 'test-match',
          matchLabel: 'Arsenal — Chelsea',
          savedAt: '2026-10-21',
        },
      ]),
    );
  });
}

async function servePlayerData(page: Page) {
  const entries = [
    {
      player: { id: 'a', name: 'Alex Morgan', image_url: null },
      team_id: 'arsenal',
      stats: [
        {
          key: 'summary',
          title: 'Summary',
          stats: {
            Rating: { key: 'rating', stat: { type: 'number', value: 7.5 } },
            Goals: { key: 'goals', stat: { type: 'number', value: 2 } },
            Assists: { key: 'assists', stat: { type: 'number', value: 1 } },
            'Minutes played': { key: 'minutes', stat: { type: 'number', value: 90 } },
          },
        },
      ],
    },
    {
      player: { id: 'c', name: 'Jamie Wilson', image_url: null },
      team_id: 'chelsea',
      stats: [
        {
          key: 'summary',
          title: 'Summary',
          stats: {
            Rating: { key: 'rating', stat: { type: 'number', value: 7 } },
            Goals: { key: 'goals', stat: { type: 'number', value: 3 } },
            Assists: { key: 'assists', stat: { type: 'number', value: 1 } },
            'Minutes played': { key: 'minutes', stat: { type: 'number', value: 90 } },
          },
        },
      ],
    },
  ];
  await page.route('**/bridge/command', async (route) => {
    const body = route.request().postDataJSON() as { command?: string } | null;
    if (body?.command !== 'history_team_matches') return route.fallback();
    const teamId = (body as { args?: { teamId?: string } }).args?.teamId ?? 'arsenal';
    return route.fulfill({
      json: [
        {
          id: `history-${teamId}`,
          leagueId: 'l_4WFCIZ',
          season: '2026/2027',
          homeId: teamId,
          homeName: teamId,
          awayId: 'rival',
          awayName: 'Rivals',
          homeScore: 2,
          awayScore: 0,
          status: 'finished',
          date: '2026-10-10',
          round: '9',
        },
      ],
    });
  });
  await page.route('**/bridge/api*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.searchParams.get('source') === 'pitch' &&
      /^matches\/[^/]+\/players$/u.test(url.searchParams.get('path') ?? '')
    )
      return route.fulfill({
        json: {
          payload: { data: entries },
          source: 'pitch',
          stale: false,
          fetchedAt: '2026-10-25T00:00:00Z',
        },
      });
    return route.fallback();
  });
}

async function contentHeight(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => (element as HTMLElement).scrollHeight);
}

for (const scheme of ['dark', 'light'] as const)
  for (const [width, height] of [
    [1100, 720],
    [1440, 900],
  ] as const) {
    test(`${scheme} ${width}: «Игроки» keeps favourites, search, season and comparison on the kit`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await setupVisualFixture(page, scheme, true);
      await seedFavorites(page);
      await servePlayerData(page);
      await page.goto('/');
      await openPlayers(page);

      // The page and its header tabs fit without sideways scrolling.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(
        await page
          .locator('.players-view')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      for (const label of ['Матчи', 'Таблица', 'Клубы', 'Игроки'])
        await expect(page.locator('.shell-tabs').getByRole('tab', { name: label })).toBeInViewport({
          ratio: 1,
        });

      // Favourites sit first as one compact row each, and each star names its player.
      await expect(page.locator('.players-favorites__row')).toHaveCount(2);
      await expect(page.locator('.players-favorites__title')).toHaveText(/Избранные игроки\s*2/u);
      const favorites = page.locator('.players-favorites');
      const directory = page.locator('.players-directory');
      const favoritesBox = await favorites.boundingBox();
      const directoryBox = await directory.boundingBox();
      expect(favoritesBox!.y).toBeLessThan(directoryBox!.y);
      await expect(
        page.getByRole('button', { name: 'Убрать из избранного: Alex Morgan' }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: 'Убрать из избранного: Jamie Wilson' }),
      ).toHaveCount(1);
      expect(await page.locator('.players-view .ui-button--primary').count()).toBe(0);
      if (width === 1440) expect(await contentHeight(page, '.players-view')).toBeLessThan(1800);

      // «Сравнить» belongs to its own row and toggles the first free slot.
      const firstCompare = page.getByRole('button', { name: 'Сравнить: Alex Morgan' });
      await expect(firstCompare).toBeVisible();
      await firstCompare.click();
      await expect(page.getByLabel('Первый игрок для сравнения')).toHaveValue('Alex Morgan');
      const removeAlex = page.getByRole('button', {
        name: 'В сравнении · убрать: Alex Morgan',
      });
      await expect(removeAlex).toContainText('В сравнении · убрать');
      await removeAlex.click();
      await expect(page.getByLabel('Первый игрок для сравнения')).toHaveValue('');
      await expect(
        page.getByText('Выберите двух игроков здесь или нажмите «Сравнить» в их строке.'),
      ).toBeVisible();

      // One picker searches clubs and favourite players, grouped where it helps.
      const picker = directory.getByLabel('Клуб или игрок');
      await expect(picker).toHaveAttribute('role', 'combobox');
      await picker.fill('Ars');
      await expect(directory.getByRole('group', { name: 'Premier League' })).toBeVisible();
      await directory.getByRole('option', { name: 'Arsenal', exact: true }).click();
      await expect(page.locator('.players-squad__row')).toHaveCount(2);
      await expect(page.locator('.players-squad__title .ui-badge')).toHaveText('2 игрока');
      await expect(page.getByLabel('Найти игрока в составе')).toBeVisible();
      if (width === 1440) {
        const withClub = await contentHeight(page, '.players-view');
        expect(withClub).toBeLessThan(1800);
      }

      // Comparison: two SearchSelects, one table, the better value is marked.
      const compare = page.locator('.players-compare-picker');
      await expect(compare.getByLabel('Первый игрок для сравнения')).toBeVisible();
      await compare.getByLabel('Первый игрок для сравнения').fill('Alex');
      await compare.getByRole('option', { name: 'Alex Morgan' }).click();
      await compare.getByLabel('Второй игрок для сравнения').fill('Jamie');
      await compare.getByRole('option', { name: 'Jamie Wilson' }).click();
      const table = page.locator('.players-compare__table');
      await expect(table).toContainText('Показатель');
      await expect(table).toContainText('Матчей с данными');
      const best = table.locator('.players-compare__best');
      await expect(best.first()).toContainText('лучше');
      await table.getByRole('button', { name: 'Открыть профиль: Alex Morgan' }).click();
      await expect(page.locator('.players-profile')).toBeVisible();
      await page.getByRole('button', { name: 'К игрокам' }).click();
      await expect(page.locator('.players-compare__table')).toBeVisible();
      if (width === 1440) expect(await contentHeight(page, '.players-view')).toBeLessThan(1800);
      await compare.getByRole('button', { name: 'Сбросить выбор' }).click();
      await expect(table).toHaveCount(0);

      // A club player opens as the whole screen; the season and the form keep
      // their data and only one of their actions is primary.
      await page.locator('.players-squad__open').first().click();
      const profile = page.locator('.players-profile');
      await expect(profile).toBeVisible();
      await expect(page.locator('.players-head')).toHaveCount(0);
      await expect(profile.locator('.player-form')).toBeVisible();
      await expect(profile.locator('.player-season')).toBeVisible();
      expect(await profile.locator('.ui-button--primary').count()).toBeLessThanOrEqual(1);
      await profile.getByRole('button', { name: 'Собрать статистику по матчам' }).click();
      await expect(profile.locator('.player-season__metrics .ui-stat').first()).toBeVisible();
      await expect(profile.locator('.player-season__table tbody tr').first()).toBeVisible();
      await profile.getByRole('button', { name: 'Показать форму игрока' }).click();
      await expect(profile.locator('.player-form__table tbody tr').first()).toBeVisible();
      expect(await profile.locator('.ui-button--primary').count()).toBeLessThanOrEqual(1);
      if (width === 1440) expect(await contentHeight(page, '.players-view')).toBeLessThan(1800);
      await profile.getByRole('button', { name: 'К составу' }).click();
      await expect(page.locator('.players-head')).toBeVisible();
      await expect(page.locator('.players-squad__row')).toHaveCount(2);

      // The same page names a route without horizontally overflowing at 1100.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });

    test(`${scheme} ${width}: «Игроки» without favourites is one short phrase`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height });
      await setupVisualFixture(page, scheme, true);
      await page.addInitScript(() => {
        localStorage.removeItem('sportsdesk.football.favorites.players');
      });
      await page.goto('/');
      await openPlayers(page);
      await expect(page.locator('.players-favorites__row')).toHaveCount(0);
      await expect(page.locator('.players-compare-picker')).toHaveCount(0);
      await expect(page.locator('.ui-empty')).toHaveText(
        /Выберите клуб ниже и отметьте игроков звёздочкой\./u,
      );
      await expect(page.getByLabel('Клуб или игрок')).toBeVisible();
      expect(await page.locator('.players-view .ui-button--primary').count()).toBe(0);
      if (width === 1440) expect(await contentHeight(page, '.players-view')).toBeLessThan(1800);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
