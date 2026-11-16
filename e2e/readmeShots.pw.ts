import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { setupF1Fixture } from './f1Fixture';
import { addMatchDetails, enabled } from './matchDetails';
import { mockWatchAccount, seedWatchPreferences } from './watchFixture';

// Запускается только явно: $env:SPORTSDESK_README_OUTPUT='docs/readme'; npx playwright test e2e/readmeShots.pw.ts
// Пишет по одному снимку каждого экрана в светлой и тёмной темах для README.
const output = process.env.SPORTSDESK_README_OUTPUT;

const FAVORITES = [
  { id: 'arsenal', name: 'Arsenal', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
  { id: 'chelsea', name: 'Chelsea', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
];

const PLAYERS = [
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
];

// TEST DATA ONLY — взято из e2e/today.pw.ts: живой матч LiveScore и встреча
// PitchAPI. Пустые ответы для остальных лиг не дают общему фикстуру выдать
// один и тот же матч за матч каждой лиги.
const LIVE_EVENT = {
  Eid: 'e2e-live',
  T1: [{ Nm: 'Arsenal' }],
  T2: [{ Nm: 'Chelsea' }],
  Eps: "67'",
  Esd: 20261022210000,
  Tr1: '2',
  Tr2: '1',
};
const LIVE_PAYLOAD = {
  Stages: [{ CompN: 'Premier League', CompD: 'England', Events: [LIVE_EVENT] }],
};
const TODAY_MATCH = {
  id: 'test-match',
  status: 'finished',
  home_team: { id: 'arsenal', name: 'Arsenal' },
  away_team: { id: 'chelsea', name: 'Chelsea' },
  time_utc: '2026-10-20T18:00:00Z',
  date: '2026-10-20',
  score_home: 2,
  score_away: 1,
};
const TODAY_NEXT = {
  ...TODAY_MATCH,
  id: 'next-match',
  status: 'scheduled',
  time_utc: '2026-10-23T09:00:00Z',
  date: '2026-10-23',
  score_home: null,
  score_away: null,
};
const TODAY_LIVE = {
  ...TODAY_MATCH,
  id: 'live-pitch',
  status: 'live',
  time_utc: '2026-10-22T12:00:00Z',
  date: '2026-10-22',
};
const EMPTY_MATCH_LEAGUES = new Set(['l_0ErfuF', 'l_0ALvwF', 'l_0eg6C9', 'l_1Isor4', 'l_3FJFUl']);

/** The visual fixture plus the favourites and «Сегодня» test data. */
async function readmeFixture(page: Page, scheme: 'light' | 'dark') {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Rich Formula 1 answers for the overview; the other screens use the same base fixture.
  await setupF1Fixture(page, scheme);
  enabled.finished = true;
  enabled.upcoming = false;
  await addMatchDetails(page);
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/bridge/api') return route.fallback();
    const source = url.searchParams.get('source');
    const path = url.searchParams.get('path') ?? '';
    if (source === 'livescore')
      return route.fulfill({
        json: {
          payload: LIVE_PAYLOAD,
          source: 'livescore',
          stale: false,
          fetchedAt: '2026-10-22T09:00:00Z',
        },
      });
    if (source === 'pitch' && path.startsWith('leagues/')) {
      const leagueId = path.split('/')[1] ?? '';
      if (EMPTY_MATCH_LEAGUES.has(leagueId))
        return route.fulfill({
          json: {
            payload: { data: { league: { id: leagueId, name: '' }, matches: [] } },
            source: 'pitch',
            stale: false,
            fetchedAt: '2026-10-22T09:00:00Z',
          },
        });
      if (leagueId === 'l_4WFCIZ')
        return route.fulfill({
          json: {
            payload: {
              data: {
                league: { id: leagueId, name: 'Premier League' },
                matches: [TODAY_MATCH, TODAY_NEXT, TODAY_LIVE],
              },
            },
            source: 'pitch',
            stale: false,
            fetchedAt: '2026-10-22T09:00:00Z',
          },
        });
    }
    return route.fallback();
  });
  await page.addInitScript(
    ({ teams, players }) => {
      localStorage.setItem(
        'sportsdesk.football.favorites.teams',
        JSON.stringify({ ids: teams.map((team) => team.id) }),
      );
      localStorage.setItem('sportsdesk.football.catalogue', JSON.stringify(teams));
      localStorage.setItem('sportsdesk.football.favorites.players', JSON.stringify(players));
    },
    { teams: FAVORITES, players: PLAYERS },
  );
  return errors;
}

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const quiet = await page
    .waitForFunction(
      () => {
        const visible = (element: Element) => {
          const style = getComputedStyle(element);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            element.getClientRects().length > 0
          );
        };
        return !Array.from(document.querySelectorAll('.ui-skeleton, [aria-busy="true"]')).some(
          visible,
        );
      },
      undefined,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!quiet) console.log('still loading after 15 s');
  await page.waitForTimeout(300);
}

for (const theme of ['light', 'dark'] as const) {
  test(`README screens, ${theme} theme`, async ({ page }) => {
    test.skip(!output, 'Set SPORTSDESK_README_OUTPUT to write the README images.');
    test.setTimeout(180_000);
    await mkdir(output!, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    const errors = await readmeFixture(page, theme);

    const shot = async (
      name: string,
      clip?: { x: number; y: number; width: number; height: number },
    ) => {
      await settled(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: resolve(output!, `${name}-${theme}.png`),
        ...(clip ? { clip } : {}),
      });
    };
    const rail = (name: string) =>
      page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name, exact: true });
    const tab = (name: string) =>
      page.locator('.shell-tabs').getByRole('tab', { name, exact: true });
    const matchTabs = () =>
      page.getByRole('tablist', { name: 'Разделы матча' }).getByRole('tab', { name: 'Обзор' });

    // «Смотреть» с каналами: поддельный вход Kino, без настоящего потока.
    await seedWatchPreferences(page);
    const watch = await mockWatchAccount(page, true);

    await page.goto('/');
    await expect(page.locator('.today-view')).toBeVisible();
    await expect(page.locator('[data-block="live"]')).toContainText("67'");
    await shot('today');

    await rail('Футбол').click();
    await tab('Матчи').click();
    await page.locator('[data-match-id="test-match"] .mt-open').first().click();
    await expect(page.locator('.md-score')).toContainText('2 : 1');
    await matchTabs().click();
    await expect(page.locator('.md-overview')).toContainText('Alex Morgan');
    await shot('match');

    await page.locator('.competition-switcher-trigger').click();
    await page.getByRole('menuitemradio', { name: 'Лига чемпионов' }).click();
    await expect(page.locator('.ucl-view')).toBeVisible();
    await tab('Таблица').click();
    await expect(page.locator('.ucl-view')).toContainText('Arsenal');
    await shot('tournament');

    // Клуб — из «Футбола», чтобы у страницы были вкладки клуба и форма.
    await page.locator('.competition-switcher-trigger').click();
    await page.getByRole('menuitemradio', { name: 'Premier League' }).click();
    await rail('Футбол').click();
    await tab('Клубы').click();
    await page.locator('.team-favorites').getByRole('button', { name: 'Arsenal' }).click();
    await expect(page.getByRole('tablist', { name: 'Разделы клуба' })).toBeVisible();
    // «Личные встречи»: соперник один, поэтому выбран сразу; сводка и две встречи.
    await page
      .getByRole('tablist', { name: 'Разделы клуба' })
      .getByRole('tab', { name: 'Личные встречи', exact: true })
      .click();
    await expect(page.locator('.club-stat-grid')).toBeVisible();
    await expect(page.locator('.club-h2h__list .ui-match-row')).toHaveCount(2);
    await shot('club');

    await rail('Формула 1').click();
    await tab('Обзор').click();
    await expect(page.locator('.f1-root')).toBeVisible();
    // Обрезаем по концу первого ряда карточек, чтобы нижняя карточка не была срезана.
    const overview = await page.locator('.f1-overview-grid').first().boundingBox();
    expect(overview).not.toBeNull();
    await shot('f1', {
      x: 0,
      y: 0,
      width: 1280,
      height: Math.ceil(overview!.y + overview!.height + 16),
    });

    await rail('Смотреть').click();
    await expect(page.locator('.watch-catalog')).toBeVisible();
    // Только колонка каталога: поиск, избранное, недавние и все каналы, без пустого плеера.
    const catalog = await page.locator('.watch-rail').boundingBox();
    expect(catalog).not.toBeNull();
    await shot('watch', {
      x: catalog!.x,
      y: catalog!.y,
      width: catalog!.width,
      height: catalog!.height,
    });

    // «Моё» на «Избранном»: клубы, игроки и Формула 1 из фикстура.
    await rail('Моё').click();
    await expect(page.locator('.my-tile').filter({ hasText: 'Arsenal' })).toBeVisible();
    await shot('my');

    await page.unroute('**/bridge/command', watch);
    expect(errors).toEqual([]);
  });
}
