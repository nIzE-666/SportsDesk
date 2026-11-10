import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

test('long away team names start inside the schedule cell', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'broadcast', 'dark', true);
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') ?? '';
    if (url.searchParams.get('source') !== 'pitch' || !path.startsWith('leagues/'))
      return route.fallback();
    await route.fulfill({
      json: {
        payload: {
          data: {
            league: { id: 'l_4WFCIZ', name: 'Premier League' },
            matches: [
              {
                id: 'long-match',
                status: 'scheduled',
                time_utc: '2026-10-23T18:00:00Z',
                date: '2026-10-23',
                home_team: { id: 'arsenal', name: 'Arsenal' },
                away_team: { id: 'newcastle', name: 'Newcastle United Football Club' },
                score_home: null,
                score_away: null,
              },
            ],
          },
        },
        source: 'fixture',
        fetchedAt: '2026-10-22T00:00:00Z',
        stale: false,
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('.football-dashboard')).toContainText('Newcastle United Football Club');
  await page.locator('aside').getByTitle('Клубы', { exact: true }).click();
  await page.locator('#team-picker-select').selectOption('arsenal');
  const away = page.locator('.team-schedule .team-match-away').first();
  const name = away.locator('.truncate');
  await expect(name).toHaveText('Newcastle United Football Club');
  const bounds = await name.evaluate((node) => {
    const parent = node.parentElement!.getBoundingClientRect();
    const child = node.getBoundingClientRect();
    return {
      start: child.left - parent.left,
      end: child.right - parent.right,
      textAlign: getComputedStyle(node).textAlign,
    };
  });
  expect(bounds.start).toBeGreaterThanOrEqual(-1);
  expect(bounds.end).toBeLessThanOrEqual(1);
  expect(bounds.textAlign).not.toBe('right');
  await away.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('team-schedule.png') });
});
