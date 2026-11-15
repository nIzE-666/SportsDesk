import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

const liveEvent = {
  Eid: 'e2e-live',
  T1: [{ Nm: 'Arsenal' }],
  T2: [{ Nm: 'Chelsea' }],
  Eps: "67'",
  Esd: 20261022210000,
  Tr1: '2',
  Tr2: '1',
};
const livePayload = {
  Stages: [{ CompN: 'Premier League', CompD: 'England', Events: [liveEvent] }],
};
const baseMatch = {
  id: 'test-match',
  status: 'finished',
  home_team: { id: 'arsenal', name: 'Arsenal' },
  away_team: { id: 'chelsea', name: 'Chelsea' },
  time_utc: '2026-10-20T18:00:00Z',
  date: '2026-10-20',
  score_home: 2,
  score_away: 1,
};
const nextMatch = {
  ...baseMatch,
  id: 'next-match',
  status: 'scheduled',
  time_utc: '2026-10-23T09:00:00Z',
  date: '2026-10-23',
  score_home: null,
  score_away: null,
};
const livePitch = {
  ...baseMatch,
  id: 'live-pitch',
  status: 'live',
  time_utc: '2026-10-22T12:00:00Z',
  date: '2026-10-22',
};
const catchUp = {
  from: Date.parse('2026-10-20T00:00:00Z'),
  to: Date.parse('2026-10-22T00:00:00Z'),
  truncated: false,
  footballIncomplete: false,
  f1Incomplete: false,
  items: [
    {
      id: 'football|end|test-match',
      sport: 'football',
      kind: 'end',
      title: 'Матч завершён',
      body: 'Arsenal 2 : 1 Chelsea',
      occurredAt: Date.parse('2026-10-20T20:00:00Z'),
      read: false,
      matchId: 'test-match',
    },
    {
      id: 'f1|race|1',
      sport: 'f1',
      kind: 'result',
      title: 'Гран-при завершён',
      body: 'Победитель: Lando Norris',
      occurredAt: Date.parse('2026-10-21T12:00:00Z'),
      read: false,
      season: '2026',
      round: '1',
    },
  ],
};

async function openToday(page: Page) {
  await page.setViewportSize({ width: 1100, height: 720 });
  const errors = await setupVisualFixture(page, 'dark', true);
  await page.route('**/bridge/command', async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === 'catchup_summary') return route.fulfill({ json: catchUp });
    if (body.command === 'catchup_dismiss') return route.fulfill({ json: {} });
    return route.fallback();
  });
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source');
    const path = url.searchParams.get('path') ?? '';
    if (source === 'livescore')
      return route.fulfill({
        json: {
          payload: livePayload,
          source: 'livescore',
          stale: false,
          fetchedAt: '2026-10-22T09:00:00Z',
        },
      });
    if (source === 'pitch' && path.startsWith('leagues/') && path.includes('/matches'))
      return route.fulfill({
        json: {
          payload: {
            data: {
              league: { id: 'l_4WFCIZ', name: 'Premier League' },
              matches: path.includes('l_4WFCIZ') ? [baseMatch, nextMatch, livePitch] : [],
            },
          },
          source: 'pitch',
          stale: false,
          fetchedAt: '2026-10-22T09:00:00Z',
        },
      });
    return route.fallback();
  });
  await page.goto('/');
  return errors;
}

test('four content blocks, mode tabs, a club tile and the live source choice', async ({ page }) => {
  const sportScoreRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/bridge/api') && url.includes('source=sportscore'))
      sportScoreRequests.push(url);
  });
  const errors = await openToday(page);

  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await expect(page.locator('.today-view')).toBeVisible();
  const blocks = page.locator('[data-block]');
  await expect(blocks).toHaveCount(4);
  await expect(blocks.nth(0)).toHaveAttribute('data-block', 'catchup');
  await expect(blocks.nth(1)).toHaveAttribute('data-block', 'live');
  await expect(blocks.nth(2)).toHaveAttribute('data-block', 'upcoming');
  await expect(blocks.nth(3)).toHaveAttribute('data-block', 'teams');

  await expect(page.locator('[data-block="catchup"]')).toContainText('Пока вас не было · 2');
  await expect(page.locator('[data-block="live"]')).toContainText("67'");
  await expect(page.locator('[data-block="live"]')).toContainText('2 : 1');
  await expect(page.locator('[data-block="live"]')).toContainText('Premier League');
  await expect(
    page.locator('[data-block="live"]').getByRole('button', { name: 'Открыть', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-block="live"]').getByRole('button', { name: 'Смотреть', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-block="upcoming"]')).toContainText('Arsenal — Chelsea');
  await expect(page.locator('[data-block="upcoming"]')).toContainText('завтра');
  await expect(page.locator('[data-block="upcoming"]')).toContainText('Premier League');
  await expect(page.locator('.today-team-tile').first()).toContainText('Arsenal');
  await expect(page.locator('.today-view .source-foot')).toHaveCount(1);
  await expect(page.locator('.today-view .source-foot')).toContainText('LiveScore');

  const tabs = page.locator('.shell-tabs');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await tabs.getByRole('tab', { name: 'Неделя', exact: true }).click();
  await expect(page.locator('.today-week-day').first()).toBeVisible();
  await tabs.getByRole('tab', { name: 'Мой план', exact: true }).click();
  await expect(page.locator('.viewing-planner')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Сегодня', exact: true }).click();
  await expect(page.locator('[data-block="teams"]')).toBeVisible();

  await page.getByRole('button', { name: 'Открыть Arsenal', exact: true }).click();
  await expect(page.locator('.team-view')).toBeVisible();
  await expect(page.locator('.team-view')).toContainText('Arsenal');

  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Настройки', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Категории настроек' })
    .getByRole('button', { name: 'Источники', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Живые матчи', exact: true })).toBeVisible();
  await expect(page.locator('.settings-category')).toContainText(
    'неофициальные бесплатные источники',
  );
  await page.locator('#live-source').selectOption('espn');
  expect(await page.evaluate(() => localStorage.getItem('sportsdesk.football.liveSource'))).toBe(
    'espn',
  );
  await expect(page.locator('#live-source')).toHaveValue('espn');

  expect(sportScoreRequests).toEqual([]);
  expect(errors).toEqual([]);
});
