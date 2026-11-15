import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

const longNames = [
  'Newcastle United',
  'Manchester United',
  'Wolverhampton Wanderers',
  'Brighton & Hove Albion',
];

/** Arsenal plays every long-named opponent at home and away, upcoming and finished. */
function longNameMatches() {
  const arsenal = { id: 'arsenal', name: 'Arsenal' };
  const upcoming = { status: 'scheduled', score_home: null, score_away: null };
  const fixture = (id: string, day: number, home: object, away: object, state: object) => ({
    id,
    time_utc: `2026-10-${String(day).padStart(2, '0')}T18:00:00Z`,
    date: `2026-10-${String(day).padStart(2, '0')}`,
    home_team: home,
    away_team: away,
    ...state,
  });
  return longNames.flatMap((name, index) => {
    const rival = { id: `rival-${index}`, name };
    return [
      fixture(`up-home-${index}`, 23 + index, arsenal, rival, upcoming),
      fixture(`up-away-${index}`, 27 + index, rival, arsenal, upcoming),
      fixture(`old-home-${index}`, 10 + index, arsenal, rival, {
        status: 'finished',
        score_home: 2,
        score_away: 1,
      }),
      fixture(`old-away-${index}`, 1 + index, rival, arsenal, {
        status: 'finished',
        score_home: 0,
        score_away: 3,
      }),
    ];
  });
}

async function openArsenalWithLongNames(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'sportsdesk.view.navigation2.football',
      JSON.stringify({
        section: 'football',
        route: { kind: 'football', competitionId: 'l_4WFCIZ', tab: 'team', teamId: 'arsenal' },
        sport: 'football',
        leagueId: 'l_4WFCIZ',
        cupId: 'l_38d9HA',
      }),
    );
  });
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
            matches: longNameMatches(),
          },
        },
        source: 'fixture',
        fetchedAt: '2026-10-22T00:00:00Z',
        stale: false,
      },
    });
  });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
  await expect(page.locator('.team-view h2.screen-title')).toHaveText('Arsenal');
  await expect(page.locator('.team-schedule .team-match-row')).toHaveCount(longNames.length * 4);
}

for (const width of [1100, 1290, 1440]) {
  test(`${width}: club names in schedule and history are fully readable`, async ({
    page,
  }, testInfo) => {
    await openArsenalWithLongNames(page, width);
    await page.locator('.team-cols').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`team-columns-broadcast-${width}.png`) });
    const report = await page.evaluate((names) => {
      const problems: string[] = [];
      const found: Record<string, number> = {};
      const sections = Array.from(document.querySelectorAll('.team-cols .team-schedule'));
      sections.forEach((section, index) => {
        const column = index === 0 ? 'schedule' : 'history';
        for (const row of Array.from(section.querySelectorAll<HTMLElement>('.team-match-row'))) {
          const rowBox = row.getBoundingClientRect();
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = (node.textContent ?? '').trim();
            if (!names.includes(text)) continue;
            found[`${column}:${text}`] = (found[`${column}:${text}`] ?? 0) + 1;
            const range = document.createRange();
            range.selectNodeContents(node);
            const box = range.getBoundingClientRect();
            if (box.left < rowBox.left - 1 || box.right > rowBox.right + 1)
              problems.push(`${column}: "${text}" sticks out of its row`);
            for (let el = node.parentElement; el && el !== row; el = el.parentElement) {
              const clip = el.getBoundingClientRect();
              const hides = getComputedStyle(el).overflowX !== 'visible';
              if (hides && (box.left < clip.left - 1 || box.right > clip.right + 1))
                problems.push(`${column}: "${text}" is cut by <${el.tagName.toLowerCase()}>`);
              if (hides && el.scrollWidth > el.clientWidth + 1)
                problems.push(`${column}: "${text}" is shortened with an ellipsis`);
            }
          }
        }
      });
      const scrollers: string[] = [];
      for (let el: Element | null = document.querySelector('.team-view'); el; el = el.parentElement)
        if (el.scrollWidth > el.clientWidth + 1)
          scrollers.push(`${el.tagName.toLowerCase()}.${el.className}`);
      return { problems: [...new Set(problems)], found, scrollers };
    }, longNames);
    for (const column of ['schedule', 'history'])
      for (const name of longNames)
        expect(report.found[`${column}:${name}`], `${column} shows ${name}`).toBe(2);
    expect(report.problems).toEqual([]);
    expect(report.scrollers, 'no horizontal scrolling').toEqual([]);
  });
}

test('long away team names start inside the schedule cell', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
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
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Клубы', exact: true }).click();
  await expect(page.locator('.team-view h2.screen-title')).toHaveText('Клубы');
  await page.screenshot({ path: testInfo.outputPath('favorite-teams.png') });
  await page.locator('#team-picker-select').selectOption('arsenal');
  await expect(page.locator('.team-view h2.screen-title')).toHaveText('Arsenal');
  const away = page.locator('.team-schedule .team-match-away').first();
  const name = away.locator('.team-match-name');
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
