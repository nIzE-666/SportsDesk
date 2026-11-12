import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { diaryFootballEntry, diaryRaceEntry } from '../src/test/fixtures/diary';
import type { DiaryEntry } from '../src/features/diary/diaryModel';
import { setupVisualFixture } from './uiFixture';

/** Page height follows the content, so one screenshot shows the whole screen. */
async function shoot(page: Page, testInfo: TestInfo, name: string) {
  const style = await page.addStyleTag({
    content:
      '.app-root{height:auto;min-height:100vh;overflow:visible}.shell,.content{overflow:visible}',
  });
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  await style.evaluate((el) => el.parentNode?.removeChild(el));
}
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('empty diary and event center keep useful actions without empty filters', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'broadcast', 'dark');
  await page.route('**/bridge/command', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: body.command === 'event_center_list' ? [] : {} });
  });
  await page.goto('/');
  await page.locator('aside').getByTitle('Дневник просмотра').click();
  await expect(page.getByText('Сохраните первый просмотр')).toBeVisible();
  await expect(page.locator('.diary-filter-panel')).toHaveCount(0);
  await expect(page.locator('.diary-summary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить просмотр вручную' })).toBeVisible();
  await expect(page.locator('.diary-import')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('empty-diary.png') });
  await page.getByRole('button', { name: 'Центр событий' }).click();
  await expect(page.getByText('Пока нет событий')).toBeVisible();
  await expect(page.locator('.event-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обновить', exact: true }).first()).toBeVisible();
});

test('empty planner hides filters while retaining a way to refresh', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'broadcast', 'dark');
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source');
    const path = url.searchParams.get('path') ?? '';
    if (source !== 'pitch' && source !== 'jolpica') return route.fallback();
    const payload =
      source === 'jolpica'
        ? { MRData: { RaceTable: { Races: [] } } }
        : path === 'leagues'
          ? {
              data: {
                leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }],
              },
            }
          : { data: { league: { id: 'l_4WFCIZ', name: 'Premier League' }, matches: [] } };
    await route.fulfill({
      json: { payload, source, stale: false, fetchedAt: '2026-10-25T00:00:00Z' },
    });
  });
  await page.goto('/');
  await page.locator('aside').getByTitle('Мой спортивный вечер').click();
  await expect(
    page.getByText('Когда расписание появится, события будут показаны здесь.'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Период плана' })).toHaveCount(0);
  await expect(page.locator('.planner-insights')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обновить расписание' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('empty-planner.png') });
});

const manualView = (i: number, patch: Partial<DiaryEntry> = {}): DiaryEntry => ({
  ...diaryFootballEntry,
  id: `manual:e2e-${i}`,
  event: { ...diaryFootballEntry.event, title: `Матч ${i}`, reference: null },
  tags: [],
  rating: null,
  ...patch,
});
for (const design of ['classic', 'broadcast'])
  for (const width of [1100, 1440])
    test(`${design} ${width}: diary with saved views keeps only useful tiles and filters`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = await setupVisualFixture(page, design, 'dark');
      await page.goto('/');
      const openDiary = async (entries: DiaryEntry[]) => {
        await page.evaluate(
          (value) =>
            localStorage.setItem(
              'sportsdesk.view.diary',
              JSON.stringify({ version: 1, entries: value }),
            ),
          entries,
        );
        await page.reload();
        await page.locator('aside').getByTitle('Дневник просмотра').click();
        await expect(page.locator('.diary-view')).toBeVisible();
      };
      const diary = page.locator('.diary-view');

      await openDiary([diaryFootballEntry]);
      await expect(diary.locator('.diary-entry')).toHaveCount(1);
      await expect(diary.locator('.diary-summary')).toHaveCount(0);
      await expect(diary.locator('.diary-filter-panel')).toHaveCount(0);
      await expect(diary.locator('.diary-season-stats')).toHaveCount(0);
      await shoot(page, testInfo, `${design}-${width}-diary-one`);

      await openDiary([
        manualView(1, { rating: 7, tags: ['друзья'] }),
        manualView(2, { rating: 8, tags: ['друзья', 'вечер'] }),
        manualView(3, { tags: ['друзья'] }),
      ]);
      await expect(diary.locator('.diary-summary > div')).toHaveCount(2);
      await expect(diary.locator('.diary-summary')).not.toContainText('Формула 1');
      await expect(diary.getByLabel('Фильтр по спорту')).toHaveCount(0);
      await expect(diary.getByLabel('Фильтр по сезону')).toHaveCount(0);
      await expect(diary.getByLabel('Просмотрено с')).toHaveCount(0);
      await expect(diary.getByLabel('Фильтр по тегу')).toBeVisible();
      await expect(diary.getByLabel('Поиск по дневнику')).toBeVisible();
      await expect(diary.locator('.diary-season-stats')).toHaveCount(0);
      await expect(diary.getByRole('button', { name: 'Сбросить фильтры' })).toHaveCount(0);
      await shoot(page, testInfo, `${design}-${width}-diary-one-sport`);

      await openDiary([diaryFootballEntry, diaryRaceEntry]);
      await expect(diary.locator('.diary-summary > div')).toHaveCount(4);
      await expect(diary.locator('.diary-filter-panel label')).toHaveCount(6);
      await expect(diary.locator('.diary-season-stats tbody tr')).toHaveCount(2);
      await shoot(page, testInfo, `${design}-${width}-diary-mixed`);

      await diary.getByLabel('Поиск по дневнику').fill('такого нет нигде');
      await expect(diary.locator('.diary-entry')).toHaveCount(0);
      await expect(diary.locator('.state-block')).toHaveCount(1);
      await expect(diary.locator('.state-block')).toContainText('Таких просмотров нет');
      await expect(diary.locator('.diary-summary')).toHaveCount(0);
      await expect(diary.locator('.diary-season-stats')).toHaveCount(0);
      await expect(diary.getByRole('button', { name: 'Сбросить фильтры' })).toHaveCount(1);
      await shoot(page, testInfo, `${design}-${width}-diary-no-match`);
      await diary.getByRole('button', { name: 'Сбросить фильтры' }).click();
      await expect(diary.locator('.diary-entry')).toHaveCount(2);
      expect(await noOverflow(page)).toBe(true);
      expect(errors).toEqual([]);
    });

const plannerMatch = (id: string, time: string) => ({
  id,
  status: 'scheduled',
  home_team: { id: 'arsenal', name: 'Arsenal' },
  away_team: { id: 'chelsea', name: 'Chelsea' },
  time_utc: time,
  date: time.slice(0, 10),
  score_home: null,
  score_away: null,
});
const plannerRace = (round: number, name: string, date: string) => ({
  season: '2026',
  round: String(round),
  raceName: name,
  date,
  time: '12:30:00Z',
  Circuit: {
    circuitId: `circuit-${round}`,
    circuitName: `Circuit ${round}`,
    Location: { country: 'Mexico', locality: 'Mexico City' },
  },
});
for (const design of ['classic', 'broadcast'])
  for (const width of [1100, 1440])
    test(`${design} ${width}: planner with events today, later this week and beyond it`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = await setupVisualFixture(page, design, 'dark');
      const plan = { matches: [] as unknown[], races: [] as unknown[] };
      await page.route('**/bridge/api**', async (route) => {
        const url = new URL(route.request().url());
        const source = url.searchParams.get('source');
        const path = url.searchParams.get('path') ?? '';
        if (source !== 'pitch' && source !== 'jolpica') return route.fallback();
        const payload =
          source === 'jolpica'
            ? { MRData: { RaceTable: { Races: path.startsWith('2026.json') ? plan.races : [] } } }
            : path === 'leagues'
              ? {
                  data: {
                    leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }],
                  },
                }
              : {
                  data: {
                    league: { id: 'l_4WFCIZ', name: 'Premier League' },
                    matches: plan.matches,
                  },
                };
        await route.fulfill({
          json: { payload, source, stale: false, fetchedAt: '2026-10-25T00:00:00Z' },
        });
      });
      await page.addInitScript(() => {
        localStorage.setItem(
          'sportsdesk.football.favorites.teams',
          JSON.stringify({ ids: ['arsenal'], seeded: ['arsenal'], seededDefault: true }),
        );
        localStorage.setItem(
          'sportsdesk.football.catalogue',
          JSON.stringify([{ id: 'arsenal', name: 'Arsenal' }]),
        );
      });
      await page.goto('/');
      const planner = page.locator('.viewing-planner');
      const openPlanner = async (matches: unknown[], races: unknown[] = []) => {
        plan.matches = matches;
        plan.races = races;
        await page.reload();
        await page.locator('aside').getByTitle('Мой спортивный вечер').click();
        await expect(planner).toBeVisible();
      };
      const period = planner.getByRole('group', { name: 'Период плана' });
      const refresh = planner.getByRole('button', { name: 'Обновить расписание' });

      // Today only: one event, nothing to choose, count or filter.
      await openPlanner([plannerMatch('today', '2026-10-25T12:00:00Z')]);
      await expect(planner.locator('.planner-event')).toHaveCount(1);
      await expect(period).toHaveCount(0);
      await expect(planner.locator('.planner-insights')).toHaveCount(0);
      await expect(planner.locator('.planner-filter')).toHaveCount(0);
      await expect(refresh).toBeEnabled();
      await shoot(page, testInfo, `${design}-${width}-planner-today`);

      // Later this week only: events on two days, so the period can be chosen.
      await openPlanner([
        plannerMatch('wed', '2026-10-28T12:00:00Z'),
        plannerMatch('fri', '2026-10-30T12:00:00Z'),
      ]);
      await expect(planner.locator('.planner-event')).toHaveCount(2);
      await expect(planner).not.toContainText('Ближайшие события —');
      await expect(period).toBeVisible();
      await expect(planner.locator('.planner-insights')).toContainText('2события в периоде');
      await expect(planner.locator('.planner-filter')).toHaveCount(0);
      await shoot(page, testInfo, `${design}-${width}-planner-week`);
      await period.getByRole('button', { name: 'Сегодня', exact: true }).click();
      await expect(planner.locator('.state-block')).toHaveCount(1);
      await expect(planner.locator('.state-block')).toContainText('В этот день событий нет');
      await expect(planner.locator('.planner-insights')).toHaveCount(0);
      await shoot(page, testInfo, `${design}-${width}-planner-day-empty`);
      await planner.getByRole('button', { name: 'Показать ближайшие 7 дней' }).click();
      await expect(planner.locator('.planner-event')).toHaveCount(2);
      await planner
        .getByRole('button', { name: 'Буду смотреть: Arsenal — Chelsea' })
        .first()
        .click();
      await expect(planner.locator('.planner-filter')).toBeVisible();
      await expect(planner.locator('.planner-insights')).toContainText('1выбрано смотреть');
      await shoot(page, testInfo, `${design}-${width}-planner-chosen`);

      // Beyond the week: the next events with their distance instead of "no events".
      await openPlanner([plannerMatch('far', '2026-11-03T12:00:00Z')]);
      await expect(planner.locator('.planner-event')).toHaveCount(1);
      await expect(planner).toContainText('Ближайшие события — через 9 дней');
      await expect(planner).not.toContainText('нет событий');
      await expect(planner.locator('.state-block')).toHaveCount(0);
      await expect(period).toHaveCount(0);
      await expect(planner.locator('.planner-insights')).toHaveCount(0);
      await shoot(page, testInfo, `${design}-${width}-planner-far`);

      // A busy week: today, tomorrow and a race that overlaps a match.
      await openPlanner(
        [plannerMatch('a', '2026-10-25T12:00:00Z'), plannerMatch('b', '2026-10-26T13:00:00Z')],
        [plannerRace(20, 'Mexico City Grand Prix', '2026-10-25')],
      );
      await expect(planner.locator('.planner-event')).toHaveCount(3);
      await expect(planner.locator('.planner-insights > div')).toHaveCount(2);
      await expect(planner.locator('.planner-insights')).toContainText('3события в периоде');
      await expect(planner.locator('.planner-insights')).toContainText('1группа пересечений');
      await shoot(page, testInfo, `${design}-${width}-planner-busy`);
      expect(await noOverflow(page)).toBe(true);
      expect(errors).toEqual([]);
    });
