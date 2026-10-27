import { test, expect, type Page } from '@playwright/test';

const home = { id: 'arsenal', name: 'Arsenal' };
const away = { id: 'chelsea', name: 'Chelsea' };
const match = {
  id: 'test-match',
  status: 'finished',
  home_team: home,
  away_team: away,
  time_utc: '2026-10-20T18:00:00Z',
  date: '2026-10-20',
  score_home: 2,
  score_away: 1,
};
const stats = {
  periods: [
    {
      period: 'All',
      groups: [
        {
          group_name: 'Top stats',
          items: [
            {
              key: 'ballpossesion',
              title: 'Ball possession',
              home: '62',
              away: '38',
              format_type: 'integer',
            },
            { key: 'shots', title: 'Shots', home: '12', away: '8', format_type: 'integer' },
          ],
        },
      ],
    },
  ],
};
const lineups = {
  match_id: match.id,
  home_team: home,
  away_team: away,
  home: {
    formation: '4-2-3-1',
    confirmed: true,
    starters: [{ player_id: 'a', name: 'Alex Morgan', pitch_x: 0.1, pitch_y: 0.5 }],
    subs: [{ player_id: 'b', name: 'Sam Taylor' }],
  },
  away: {
    formation: '4-3-3',
    confirmed: true,
    starters: [{ player_id: 'c', name: 'Jamie Wilson', pitch_x: 0.1, pitch_y: 0.5 }],
    subs: [],
  },
};
const races = ['2026-10-01', '2026-11-01', '2026-11-08'].map((date, i) => ({
  season: '2026',
  round: String(i + 1),
  raceName: ['Australian Grand Prix', 'Chinese Grand Prix', 'Japanese Grand Prix'][i],
  date,
  time: '12:00:00Z',
  Qualifying: { date, time: '08:00:00Z' },
  Circuit: {
    circuitId: `test-${i}`,
    circuitName: `Circuit ${i + 1}`,
    Location: { country: ['Australia', 'China', 'Japan'][i], locality: 'Test City' },
  },
}));

async function setup(page: Page, design: string, scheme: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge/api') {
      const source = url.searchParams.get('source');
      const path = url.searchParams.get('path') ?? '';
      let payload: unknown;
      if (source === 'pitch') {
        if (path === 'leagues')
          payload = {
            data: { leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }] },
          };
        else if (path.startsWith('leagues/'))
          payload = {
            data: { league: { id: 'l_4WFCIZ', name: 'Premier League' }, matches: [match] },
          };
        else if (path === `matches/${match.id}`) payload = { data: match };
        else if (path.endsWith('/stats')) payload = { data: stats };
        else if (path.endsWith('/lineups')) payload = { data: lineups };
        else if (path.endsWith('/players')) payload = { data: [] };
        else if (path.endsWith('/events')) payload = { data: { events: [] } };
        else payload = { data: {} };
      } else if (source === 'jolpica')
        payload = {
          MRData: {
            total: '3',
            RaceTable: { season: '2026', Races: path.startsWith('2026.json') ? races : [] },
          },
        };
      else payload = [];
      return route.fulfill({
        json: { payload, source: 'fixture', stale: false, fetchedAt: '2026-10-25T00:00:00Z' },
      });
    }
    if (url.pathname === '/bridge/command') {
      const body = route.request().postDataJSON();
      if (body.command === 'event_center_list')
        return route.fulfill({
          json: [
            {
              id: 'football|score|test-match',
              sport: 'football',
              kind: 'goal',
              title: 'Изменение счёта',
              body: 'Arsenal — Chelsea · 2 : 1',
              occurredAt: 1792886400000,
              read: false,
              matchId: 'test-match',
              leagueId: 'l_4WFCIZ',
            },
          ],
        });
      return route.fulfill({ json: {} });
    }
    if (url.pathname.startsWith('/bridge/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:1421')
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="13" fill="#76849a"/></svg>',
      });
    return route.continue();
  });
  await page.addInitScript(
    ({ design, scheme }) => {
      localStorage.setItem('sportsdesk.design', design);
      localStorage.setItem('sportsdesk.scheme', scheme);
      localStorage.setItem('sportsdesk.sport', 'football');
      localStorage.setItem('sportsdesk.league', 'l_4WFCIZ');
      sessionStorage.setItem(
        'sportsdesk.view.navigation.football',
        JSON.stringify({ kind: 'football', section: 'dashboard' }),
      );
      sessionStorage.setItem('sportsdesk.view.navigation.f1.tab', JSON.stringify('calendar'));
      sessionStorage.setItem('sportsdesk.view.f1.year', JSON.stringify(2026));
    },
    { design, scheme },
  );
  await page.clock.setFixedTime(new Date('2026-10-25T00:00:00Z'));
  return errors;
}

for (const design of ['classic', 'broadcast'])
  for (const scheme of ['dark', 'light'])
    for (const width of [1100, 1440]) {
      test(`${design} ${scheme} ${width}: dashboard, match and calendar`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors = await setup(page, design, scheme);
        await page.goto('/');
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('.app-root')).toHaveAttribute('data-design', design);
        await expect(page.locator('.app-root')).toHaveAttribute('data-scheme', scheme);
        await expect(page.locator('.football-dashboard')).toContainText('Arsenal');
        const shot = async (name: string) => {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await expect(page).toHaveScreenshot(`${design}-${scheme}-${width}-${name}.png`, {
            fullPage: true,
          });
        };
        await shot('dashboard');
        await page.locator('.recent-game').first().click();
        await expect(page.locator('.md-score')).toContainText('2 : 1');
        await page.getByRole('tab', { name: 'Статистика' }).click();
        await expect(page.locator('.match-statistics')).toContainText('62');
        await shot('statistics');
        await page.getByRole('tab', { name: 'Поле и оценки' }).click();
        await expect(page.locator('.match-lineups')).toContainText('Alex Morgan');
        await page.locator('.lineup-pitch').scrollIntoViewIfNeeded();
        await shot('lineups');
        await page.getByRole('tab', { name: 'Формула 1' }).click();
        await expect(page.locator('.calendar-board')).toContainText('Circuit');
        await shot('calendar');
        expect(errors).toEqual([]);
      });
    }

for (const design of ['classic', 'broadcast'])
  test(`${design}: keyboard search, events and match viewing`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    const errors = await setup(page, design, 'dark');
    await page.goto('/');
    await expect(page.locator('.football-dashboard')).toContainText('Arsenal');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Глобальный поиск' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveScreenshot(`${design}-search.png`);
    const overlay = await page.locator('.command-backdrop').boundingBox();
    expect(overlay?.height).toBe(900);
    await page.getByRole('combobox').fill('Arsenal Chelsea');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('combobox').press('Enter');
    await expect(page.locator('.md-score')).toContainText('2 : 1');
    await page.locator('.md-topbar').getByRole('button', { name: 'Смотреть', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Просмотр события' })).toContainText(
      'Arsenal — Chelsea',
    );
    await expect(page.locator('.watch-root-signed-out')).toBeVisible();
    await page.getByRole('button', { name: 'Назад по истории', exact: true }).click();
    await expect(page.locator('.md-score')).toContainText('2 : 1');
    await page.getByRole('button', { name: 'Центр событий', exact: true }).click();
    await expect(page.locator('.event-entry.unread')).toHaveCount(1);
    await expect(page.locator('.event-center')).toHaveScreenshot(`${design}-events.png`);
    await page.getByRole('button', { name: 'Прочитать все', exact: true }).click();
    await expect(page.locator('.event-entry.unread')).toHaveCount(0);
    await page.getByRole('button', { name: 'Открыть матч', exact: true }).click();
    await expect(page.locator('.md-score')).toContainText('2 : 1');
    expect(errors).toEqual([]);
  });
