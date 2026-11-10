import { test, expect, type Page } from '@playwright/test';

const home = { id: 'arsenal', name: 'Arsenal' };
const away = { id: 'chelsea', name: 'Chelsea' };
const match = {
  id: 'analysis-fixture',
  home_team: home,
  away_team: away,
  status: 'finished',
  score_home: 2,
  score_away: 1,
  time_utc: '2026-11-08T18:00:00Z',
};
const shot = (id: string, minute: number, team = home.id, extra: Record<string, unknown> = {}) => ({
  id,
  team_id: team,
  player: { name: team === home.id ? 'Bukayo Saka' : 'Cole Palmer' },
  minute,
  x: 91,
  y: 30,
  expected_goals: 0.18,
  event_type: 'AttemptSaved',
  ...extra,
});
const shots = {
  match_id: match.id,
  periods: [
    {
      period: 'FirstHalf',
      shots: [
        shot('a', 11, home.id, { event_type: 'Goal', expected_goals: 0.46, x: 98, y: 32 }),
        shot('b', 23, away.id, { x: 78, y: 43, expected_goals: 0.04 }),
        shot('c', 45, home.id, { minute_added: 4, x: 94, y: 39, expected_goals: 0.32 }),
      ],
    },
    {
      period: 'SecondHalf',
      shots: [
        shot('d', 54, away.id, { x: 96, y: 28, expected_goals: 0.52, event_type: 'Goal' }),
        shot('e', 67, home.id, { x: null, y: null, expected_goals: null, event_type: 'Miss' }),
        shot('f', 82, home.id, { x: 99, y: 35, expected_goals: 0.61, event_type: 'Goal' }),
      ],
    },
  ],
};

async function setup(page: Page, design: string, scheme: string, unavailable = false) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge/api') {
      const path = url.searchParams.get('path') ?? '';
      let data: unknown = {};
      if (path === 'leagues')
        data = { leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }] };
      else if (path.startsWith('leagues/'))
        data = { league: { id: 'l_4WFCIZ', name: 'Premier League' }, matches: [match] };
      else if (path === `matches/${match.id}`) data = match;
      else if (path.endsWith('/shots'))
        data = unavailable ? { match_id: match.id, periods: null } : shots;
      else if (path.endsWith('/momentum'))
        data = {
          points: unavailable
            ? []
            : Array.from({ length: 91 }, (_, minute) => ({
                minute,
                value: Math.round(Math.sin(minute * 0.18) * 54 + Math.cos(minute * 0.48) * 25),
              })),
        };
      else if (path.endsWith('/events')) data = { events: [] };
      else if (path.endsWith('/players')) data = [];
      else if (path.endsWith('/stats')) data = { periods: [] };
      return route.fulfill({
        json: {
          payload: { data },
          source: 'fixture',
          stale: false,
          fetchedAt: '2026-11-09T00:00:00Z',
        },
      });
    }
    if (url.pathname.startsWith('/bridge/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:1421')
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" />',
      });
    return route.continue();
  });
  await page.addInitScript(
    ({ design, scheme, matchId }) => {
      localStorage.setItem('sportsdesk.design', design);
      localStorage.setItem('sportsdesk.scheme', scheme);
      localStorage.setItem('sportsdesk.sport', 'football');
      localStorage.setItem('sportsdesk.league', 'l_4WFCIZ');
      sessionStorage.setItem(
        'sportsdesk.view.navigation.football',
        JSON.stringify({ kind: 'football-match', matchId }),
      );
      sessionStorage.setItem(`sportsdesk.view.match.${matchId}.tab`, JSON.stringify('analysis'));
    },
    { design, scheme, matchId: match.id },
  );
  await page.clock.setFixedTime(new Date('2026-11-09T00:00:00Z'));
  return errors;
}

for (const design of ['classic', 'broadcast'])
  for (const scheme of ['dark', 'light'])
    for (const width of [1100, 1440]) {
      test(`${design} ${scheme} ${width}: analysis and filters`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const errors = await setup(page, design, scheme);
        await page.goto('/');
        await page.evaluate(() => document.fonts.ready);
        const feature = page.locator('.match-analysis');
        await expect(page.locator('.app-root')).toHaveAttribute('data-design', design);
        await expect(page.locator('.app-root')).toHaveAttribute('data-scheme', scheme);
        await expect(feature).toHaveCSS(
          '--analysis-away',
          scheme === 'light' ? '#8a3db4' : '#b364d9',
        );
        await expect(feature.locator('.analysis-shot')).toHaveCount(5);
        await expect(feature).toContainText('Неполная кривая xG');
        await expect(page.getByRole('tab', { name: 'Разбор матча' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        // Expand scroll ancestors only for capture: Chromium clips a long element
        // screenshot at the app's internal scroll viewport otherwise.
        const captureStyle = await page.addStyleTag({
          content:
            '.app-root { height: auto; min-height: 100vh; overflow: visible; } .shell, .content { overflow: visible; }',
        });
        await expect(feature).toHaveScreenshot(`${design}-${scheme}-${width}-analysis.png`);
        await captureStyle.evaluate((element) => element.parentNode?.removeChild(element));
        await page.getByLabel('Команда', { exact: true }).selectOption(home.id);
        await page.getByLabel('Период', { exact: true }).selectOption('FirstHalf');
        await expect(feature.locator('.analysis-shot')).toHaveCount(2);
        await expect(feature.locator('.analysis-shots tbody tr')).toHaveCount(2);
        await expect(feature.locator('.analysis-total.home')).toContainText('0,78');
        await page
          .getByRole('button', { name: 'Показать удар: Bukayo Saka, 11′', exact: true })
          .focus();
        await page.keyboard.press('Enter');
        await expect(feature.locator('.analysis-shot.selected')).toHaveCount(1);
        await page.getByRole('tab', { name: 'Сводка', exact: true }).click();
        await page.getByRole('tab', { name: 'Разбор матча', exact: true }).click();
        await expect(page.getByLabel('Команда', { exact: true })).toHaveValue(home.id);
        await expect(feature.locator('.analysis-shots tbody tr')).toHaveCount(2);
        expect(errors).toEqual([]);
      });
    }

test('unavailable analytics preserve the score and other match tabs', async ({ page }) => {
  await setup(page, 'classic', 'dark', true);
  await page.goto('/');
  await expect(page.locator('.match-analysis')).toContainText('Источник не опубликовал удары');
  await expect(page.locator('.match-analysis')).toContainText('Источник не опубликовал давление');
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  await page.getByRole('tab', { name: 'События', exact: true }).click();
  await expect(page.getByText('Событий нет', { exact: true })).toBeVisible();
});
