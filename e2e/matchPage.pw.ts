import { test, expect, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';
import { addMatchDetails, enabled } from './matchDetails';

const home = { id: 'arsenal', name: 'Arsenal' };
const away = { id: 'chelsea', name: 'Chelsea' };
const league = { id: 'l_4WFCIZ', name: 'Premier League' };

const finishedDetail = {
  id: 'test-match',
  status: 'finished',
  league,
  season: '2026/2027',
  home_team: home,
  away_team: away,
  time_utc: '2026-10-20T18:00:00Z',
  date: '2026-10-20',
  score_home: 2,
  score_away: 1,
  round_name: '10',
  stadium: 'Emirates Stadium',
  referee: 'Farai Hallam',
};

const upcomingDetail = {
  id: 'next-match',
  status: 'scheduled',
  league,
  season: '2026/2027',
  home_team: home,
  away_team: away,
  time_utc: '2026-11-20T18:00:00Z',
  date: '2026-11-20',
  score_home: null,
  score_away: null,
  round_name: '12',
  stadium: 'Emirates Stadium',
  referee: 'Farai Hallam',
};

/** Detail responses with a league: prediction availability depends on it. */
async function addLeagueDetails(page: Page) {
  await page.route(
    (url) => url.pathname === '/bridge/api',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('source') !== 'pitch') return route.fallback();
      const path = url.searchParams.get('path');
      const detail =
        path === 'matches/test-match'
          ? finishedDetail
          : path === 'matches/next-match'
            ? upcomingDetail
            : null;
      if (!detail) return route.fallback();
      return route.fulfill({
        json: {
          payload: { data: detail },
          source: 'pitch',
          stale: false,
          fetchedAt: '2026-10-22T00:00:00Z',
        },
      });
    },
  );
}

async function setup(page: Page, scheme: string, details = true) {
  enabled.finished = details;
  enabled.upcoming = details;
  const errors = await setupVisualFixture(page, scheme, true);
  await addMatchDetails(page);
  await addLeagueDetails(page);
  return errors;
}

async function openMatch(page: Page, id = 'test-match') {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Матчи', exact: true }).click();
  await page.locator(`[data-match-id="${id}"] .mt-open`).first().click();
  await expect(page.locator('.md-score')).toBeVisible();
}

/** Search opens a match without choosing a tab, as external links do. */
async function openMatchFromSearch(page: Page) {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Матчи', exact: true }).click();
  await page.getByRole('button', { name: 'Поиск · Ctrl+K' }).click();
  const dialog = page.getByRole('dialog', { name: 'Поиск' });
  await dialog.getByRole('combobox').fill('Arsenal Chelsea');
  await dialog.locator('[role="option"]').filter({ hasText: 'Arsenal — Chelsea' }).first().click();
  await expect(page.locator('.md-score')).toBeVisible();
}

const matchTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Разделы матча' }).getByRole('tab');

/** Rendered colours on the current tab. The themes are the same ones the shell applies. */
async function renderedColours(page: Page, theme: string, scheme: string) {
  return page.evaluate(
    ({ theme, scheme }) => {
      const root = document.querySelector<HTMLElement>('.app-root');
      if (!root) throw new Error('app root is missing');
      root.setAttribute('data-theme', theme);
      root.setAttribute('data-scheme', scheme);
      const resolve = (value: string) => {
        const probe = document.createElement('span');
        probe.style.color = value;
        root.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const read = (selector: string, property: string) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).getPropertyValue(property) || null : null;
      };
      return {
        home: resolve('var(--color-team-home)'),
        away: resolve('var(--color-team-away)'),
        text: resolve('var(--color-text)'),
        headerChipHomeBorder: read('.md-side.home .team-badge-fallback', 'border-top-color'),
        headerChipAwayBorder: read('.md-side.away .team-badge-fallback', 'border-top-color'),
        headerChipHomeText: read('.md-side.home .team-badge-fallback', 'color'),
        headerChipAwayText: read('.md-side.away .team-badge-fallback', 'color'),
        statsHomeTeam: read('.stats-home-team', 'color'),
        statsAwayTeam: read('.stats-away-team', 'color'),
        statHome: read('.stat-home', 'color'),
        statAway: read('.stat-away', 'color'),
        statsChipHomeBorder: read('.stats-home-team .team-badge-fallback', 'border-top-color'),
        statsChipAwayBorder: read('.stats-away-team .team-badge-fallback', 'border-top-color'),
        statsChipHomeText: read('.stats-home-team .team-badge-fallback', 'color'),
        statsChipAwayText: read('.stats-away-team .team-badge-fallback', 'color'),
        statsChipHomeBackground: read('.stats-home-team .team-badge-fallback', 'background-color'),
        statsChipAwayBackground: read('.stats-away-team .team-badge-fallback', 'background-color'),
        compareA: read('.compare-a', 'color'),
        compareB: read('.compare-b', 'color'),
        compareContextHome: read('.compare-context strong:first-child', 'color'),
        compareContextAway: read('.compare-context strong:last-child', 'color'),
        pitchTagHome: read('.pitch-side-label.home', 'color'),
        pitchTagAway: read('.pitch-side-label.away', 'color'),
        pitchTagHomeBorder: read('.pitch-side-label.home', 'border-top-color'),
        pitchTagAwayBorder: read('.pitch-side-label.away', 'border-top-color'),
        ringHome: read('.pitch-player.home .person-avatar', 'border-top-color'),
        ringAway: read('.pitch-player.away .person-avatar', 'border-top-color'),
        headingChipHomeBorder: read(
          '.pitch-team-headings .home .team-badge-fallback',
          'border-top-color',
        ),
        headingChipAwayBorder: read(
          '.pitch-team-headings .away .team-badge-fallback',
          'border-top-color',
        ),
        headingChipHomeText: read('.pitch-team-headings .home .team-badge-fallback', 'color'),
        headingChipAwayText: read('.pitch-team-headings .away .team-badge-fallback', 'color'),
        listChipHomeBorder: read(
          '.lineup-team-lists > .ui-panel:first-child .team-badge-fallback',
          'border-top-color',
        ),
        listChipAwayBorder: read(
          '.lineup-team-lists > .ui-panel:last-child .team-badge-fallback',
          'border-top-color',
        ),
        listChipHomeText: read(
          '.lineup-team-lists > .ui-panel:first-child .team-badge-fallback',
          'color',
        ),
        listChipAwayText: read(
          '.lineup-team-lists > .ui-panel:last-child .team-badge-fallback',
          'color',
        ),
        analysisTotalHome: read('.analysis-total.home > strong', 'color'),
        analysisTotalAway: read('.analysis-total.away > strong', 'color'),
        analysisTeamHome: read('.analysis-table-scroll .analysis-team.home', 'color'),
        analysisTeamAway: read('.analysis-table-scroll .analysis-team.away', 'color'),
        shotHomeFill: read('.analysis-shot.home', 'fill'),
        shotAwayFill: read('.analysis-shot.away', 'fill'),
        xgHomeStroke: read('.analysis-xg.home', 'stroke'),
        xgAwayStroke: read('.analysis-xg.away', 'stroke'),
        pressureHome: read('.analysis-pressure-bar.home', 'stroke'),
        pressureAway: read('.analysis-pressure-bar.away', 'stroke'),
        tacticHome: read('.tactics-player.home > span', 'background-color'),
        tacticAway: read('.tactics-player.away > span', 'background-color'),
      };
    },
    { theme, scheme },
  );
}

test('one team pair is rendered in the default, UCL and Ligue 1 themes', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await setup(page, 'dark');
  await page.goto('/');
  await openMatch(page);

  await matchTabs(page).filter({ hasText: 'Составы' }).click();
  const compare = page.locator('.compare-selects');
  await compare.getByLabel('Первый игрок').fill('Alex');
  await compare.getByRole('option', { name: /Alex Morgan/ }).click();
  await compare.getByLabel('Второй игрок').fill('Jamie');
  await compare.getByRole('option', { name: /Jamie Wilson/ }).click();
  await page.getByRole('button', { name: 'На доску', exact: true }).click();
  await page.getByRole('button', { name: 'Создать из состава', exact: true }).click();
  await expect(page.locator('.tactics-player').first()).toBeVisible();
  await page.getByRole('button', { name: 'К составам', exact: true }).click();

  for (const scheme of ['dark', 'light'])
    for (const theme of ['epl', 'ucl', 'ligue1']) {
      await matchTabs(page).filter({ hasText: 'Статистика' }).click();
      await expect(page.locator('.match-statistics')).toBeVisible();
      let colours = await renderedColours(page, theme, scheme);
      expect(colours.home, `${scheme} ${theme}`).not.toBe(colours.away);
      expect(colours.headerChipHomeBorder).toBe(colours.home);
      expect(colours.headerChipAwayBorder).toBe(colours.away);
      expect(colours.headerChipHomeText).toBe(colours.text);
      expect(colours.headerChipAwayText).toBe(colours.text);
      expect(colours.statsHomeTeam).toBe(colours.home);
      expect(colours.statsAwayTeam).toBe(colours.away);
      expect(colours.statHome).toBe(colours.home);
      expect(colours.statAway).toBe(colours.away);
      expect(colours.statsChipHomeBorder).toBe(colours.home);
      expect(colours.statsChipAwayBorder).toBe(colours.away);
      expect(colours.statsChipHomeText).toBe(colours.text);
      expect(colours.statsChipAwayText).toBe(colours.text);
      expect(colours.statsChipHomeBackground).not.toBeNull();
      expect(colours.statsChipAwayBackground).not.toBeNull();
      expect(colours.statsChipHomeBackground).not.toBe(colours.statsChipAwayBackground);

      await matchTabs(page).filter({ hasText: 'Составы' }).click();
      await expect(page.locator('.match-lineups')).toBeVisible();
      colours = await renderedColours(page, theme, scheme);
      expect(colours.pitchTagHome).toBe(colours.home);
      expect(colours.pitchTagAway).toBe(colours.away);
      expect(colours.pitchTagHomeBorder).toBe(colours.home);
      expect(colours.pitchTagAwayBorder).toBe(colours.away);
      expect(colours.ringHome).toBe(colours.home);
      expect(colours.ringAway).toBe(colours.away);
      expect(colours.headingChipHomeBorder).toBe(colours.home);
      expect(colours.headingChipAwayBorder).toBe(colours.away);
      expect(colours.headingChipHomeText).toBe(colours.text);
      expect(colours.headingChipAwayText).toBe(colours.text);
      expect(colours.listChipHomeBorder).toBe(colours.home);
      expect(colours.listChipAwayBorder).toBe(colours.away);
      expect(colours.listChipHomeText).toBe(colours.text);
      expect(colours.listChipAwayText).toBe(colours.text);
      expect(colours.compareA).toBe(colours.home);
      expect(colours.compareB).toBe(colours.away);
      expect(colours.compareContextHome).toBe(colours.home);
      expect(colours.compareContextAway).toBe(colours.away);

      await matchTabs(page).filter({ hasText: 'Разбор' }).click();
      await expect(page.locator('.match-analysis')).toBeVisible();
      await expect(page.locator('.analysis-total.home')).toBeVisible();
      await expect(page.locator('.analysis-shot.home').first()).toBeVisible();
      colours = await renderedColours(page, theme, scheme);
      expect(colours.analysisTotalHome).toBe(colours.home);
      expect(colours.analysisTotalAway).toBe(colours.away);
      expect(colours.analysisTeamHome).toBe(colours.home);
      expect(colours.analysisTeamAway).toBe(colours.away);
      expect(colours.shotHomeFill).toBe(colours.home);
      expect(colours.shotAwayFill).toBe(colours.away);
      expect(colours.xgHomeStroke).toBe(colours.home);
      expect(colours.xgAwayStroke).toBe(colours.away);
      expect(colours.pressureHome).toBe(colours.home);
      expect(colours.pressureAway).toBe(colours.away);

      await matchTabs(page).filter({ hasText: 'Составы' }).click();
      await page.getByRole('button', { name: 'На доску', exact: true }).click();
      await expect(page.locator('.tactics-player').first()).toBeVisible();
      colours = await renderedColours(page, theme, scheme);
      expect(colours.tacticHome).toBe(colours.home);
      expect(colours.tacticAway).toBe(colours.away);
      await page.getByRole('button', { name: 'К составам', exact: true }).click();
    }

  expect(errors).toEqual([]);
});

test('a compact header and four tabs fit a 1100 × 720 window', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  const errors = await setup(page, 'dark');
  await page.goto('/');
  await openMatch(page);
  await matchTabs(page).filter({ hasText: 'Обзор' }).click();

  await expect(matchTabs(page)).toHaveText(['Обзор', 'Составы', 'Статистика', 'Разбор']);
  await expect(page.locator('.md-meta-line')).toHaveText(
    /Premier League · Тур 10 · .* · Emirates Stadium · Арбитр: Farai Hallam/u,
  );

  const header = await page.locator('.match-detail > .md-header').boundingBox();
  expect(header).not.toBeNull();
  expect(header!.height).toBeLessThanOrEqual(220);

  const strip = await page.getByRole('tablist', { name: 'Разделы матча' }).boundingBox();
  expect(strip).not.toBeNull();
  expect(strip!.y).toBeLessThanOrEqual(320);
  expect(strip!.y + strip!.height).toBeLessThanOrEqual(720);

  // One row of actions: each visible action starts at the same y.
  const actionTops = await page.locator('.md-actions button').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((button) => Math.round(button.getBoundingClientRect().top)),
  );
  expect(new Set(actionTops).size).toBe(1);

  // A finished match without a prediction does not show «Мой прогноз».
  await expect(
    page.locator('.md-actions').getByRole('button', { name: 'Мой прогноз' }),
  ).toHaveCount(0);
  await expect(
    page.locator('.md-actions').getByRole('button', { name: 'Просмотрено' }),
  ).toBeVisible();
  await expect(page.locator('.md-actions').getByRole('button', { name: 'Смотреть' })).toBeVisible();
  await expect(
    page.locator('.md-actions').getByRole('button', { name: 'Без спойлеров' }),
  ).toBeVisible();
  await expect(page.locator('.match-detail .ui-button--primary')).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('«Мой прогноз» opens on click for an upcoming match', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setup(page, 'dark');
  await page.goto('/');
  await openMatch(page, 'next-match');
  const prediction = page.locator('.md-actions').getByRole('button', { name: 'Мой прогноз' });
  await expect(prediction).toBeVisible();
  await expect(prediction).toHaveAttribute('aria-expanded', 'false');
  await prediction.click();
  await expect(prediction).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.md-actions')).toContainText('Угадай счёт · мой прогноз');
  await expect(page.locator('.match-detail .ui-button--primary')).toHaveCount(1);
});

test('«Обзор» keeps the summary, the goal timeline and the event feed', async ({ page }) => {
  await setup(page, 'dark');
  await page.goto('/');
  await openMatch(page);
  await matchTabs(page).filter({ hasText: 'Обзор' }).click();
  await expect(page.getByRole('heading', { name: 'Сводка матча', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Хронология голов', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'События матча', exact: true })).toBeVisible();
  await expect(page.locator('.md-events .event-row')).toHaveCount(3);
  await expect(page.locator('.md-events')).toContainText('Жёлтая');
});

test('«Составы» holds the pitch, player stats, the comparison and «На доску»', async ({ page }) => {
  await setup(page, 'dark');
  await page.goto('/');
  await openMatch(page);
  await matchTabs(page).filter({ hasText: 'Составы' }).click();
  await expect(page.locator('.pitch-card')).toContainText('Поле и оценки');
  await expect(page.locator('.players-grid .player-card')).toHaveCount(3);
  await expect(page.locator('.compare-panel')).toContainText('Сравнение двух игроков матча');
  await page.getByRole('button', { name: 'На доску', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Тактическая доска', exact: true })).toBeVisible();
  await expect(matchTabs(page).filter({ hasText: 'Составы' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'К составам', exact: true }).click();
  await expect(page.locator('.pitch-card')).toBeVisible();
});

const MIGRATION_CASES = [
  ['events', 'Обзор'],
  ['players', 'Составы'],
  ['lineups', 'Составы'],
  ['stats', 'Статистика'],
  ['analysis', 'Разбор'],
  ['overview', 'Обзор'],
  ['tactics', 'Составы'],
] as const;

for (const [saved, expected] of MIGRATION_CASES) {
  test(`old saved tab «${saved}» opens «${expected}»`, async ({ page }) => {
    await setup(page, 'dark');
    await page.goto('/');
    await page.evaluate(
      ({ id, tab }) =>
        sessionStorage.setItem(`sportsdesk.view.match.${id}.tab`, JSON.stringify(tab)),
      { id: 'test-match', tab: saved },
    );
    await openMatchFromSearch(page);
    await expect(matchTabs(page).filter({ hasText: expected })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    if (saved === 'tactics')
      await expect(
        page.getByRole('region', { name: 'Тактическая доска', exact: true }),
      ).toBeVisible();
    if (saved === 'events') await expect(page.locator('.md-events')).toBeVisible();
    if (saved === 'players' || saved === 'lineups')
      await expect(page.locator('.pitch-card')).toBeVisible();
  });
}

test('the page height at 1440 × 900', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, 'dark');
  await page.goto('/');
  await openMatch(page);
  const heights: Record<string, number> = {};
  for (const tab of ['Обзор', 'Составы', 'Статистика', 'Разбор']) {
    await matchTabs(page).filter({ hasText: tab }).click();
    await page.waitForTimeout(300);
    heights[tab] = await page
      .locator('.match-detail')
      .evaluate((element) => Math.round(element.scrollHeight));
  }
  console.log('match page heights at 1440x900', JSON.stringify(heights));
  expect(heights['Обзор']).toBeLessThanOrEqual(1800);
  expect(heights['Статистика']).toBeLessThanOrEqual(1800);
});
