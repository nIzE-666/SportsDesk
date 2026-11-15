import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { diaryFootballEntry, diaryRaceEntry } from '../src/test/fixtures/diary';
import { completeOfflineSeason, offlineSeason } from '../src/test/fixtures/offline';
import type { DiaryEntry } from '../src/features/diary/diaryModel';
import { summarizeSeason, type OfflineSeason } from '../src/features/offline/offlineModel';
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
const rail = (page: Page) => page.getByRole('navigation', { name: 'Разделы' });
const section = (page: Page, name: string) =>
  rail(page).getByRole('button', { name, exact: true }).click();
const headerTab = (page: Page, name: string) =>
  page.locator('.shell-tabs').getByRole('tab', { name, exact: true }).click();
const openDiaryPage = async (page: Page) => {
  await section(page, 'Моё');
  await headerTab(page, 'Дневник');
  await expect(page.locator('.diary-view')).toBeVisible();
};
const openPlannerPage = async (page: Page) => {
  await section(page, 'Сегодня');
  await headerTab(page, 'Мой план');
};
const openSettingsData = async (page: Page) => {
  await section(page, 'Настройки');
  await page
    .getByRole('navigation', { name: 'Категории настроек' })
    .getByRole('button', { name: 'Данные', exact: true })
    .click();
};

test('empty diary and event center keep useful actions without empty filters', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark');
  await page.route('**/bridge/command', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: body.command === 'event_center_list' ? [] : {} });
  });
  await page.goto('/');
  await openDiaryPage(page);
  await expect(page.getByText('Сохраните первый просмотр')).toBeVisible();
  await expect(page.locator('.diary-filter-panel')).toHaveCount(0);
  await expect(page.locator('.diary-summary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить просмотр вручную' })).toBeVisible();
  await expect(page.locator('.diary-import')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('empty-diary.png') });
  await rail(page).getByRole('button', { name: 'События', exact: true }).click();
  await expect(page.getByText('Пока нет событий')).toBeVisible();
  await expect(page.locator('.event-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обновить', exact: true }).first()).toBeVisible();
});

test('empty planner hides filters while retaining a way to refresh', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark');
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
  await openPlannerPage(page);
  await expect(
    page.getByText('Когда расписание появится, события будут показаны здесь.'),
  ).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Период плана' })).toHaveCount(0);
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
for (const width of [1100, 1440])
  test(`${width}: diary with saved views keeps only useful tiles and filters`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await setupVisualFixture(page, 'dark');
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
      await openDiaryPage(page);
    };
    const diary = page.locator('.diary-view');

    await openDiary([diaryFootballEntry]);
    await expect(diary.locator('.diary-entry')).toHaveCount(1);
    await expect(diary.locator('.diary-summary')).toHaveCount(0);
    await expect(diary.locator('.diary-filter-panel')).toHaveCount(0);
    await expect(diary.locator('.diary-season-stats')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-diary-one`);

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
    await shoot(page, testInfo, `broadcast-${width}-diary-one-sport`);

    await openDiary([diaryFootballEntry, diaryRaceEntry]);
    await expect(diary.locator('.diary-summary > div')).toHaveCount(4);
    await expect(diary.locator('.diary-filter-panel label')).toHaveCount(6);
    await expect(diary.locator('.diary-season-stats tbody tr')).toHaveCount(2);
    await shoot(page, testInfo, `broadcast-${width}-diary-mixed`);

    await diary.getByLabel('Поиск по дневнику').fill('такого нет нигде');
    await expect(diary.locator('.diary-entry')).toHaveCount(0);
    await expect(diary.locator('.state-block')).toHaveCount(1);
    await expect(diary.locator('.state-block')).toContainText('Таких просмотров нет');
    await expect(diary.locator('.diary-summary')).toHaveCount(0);
    await expect(diary.locator('.diary-season-stats')).toHaveCount(0);
    await expect(diary.getByRole('button', { name: 'Сбросить фильтры' })).toHaveCount(1);
    await shoot(page, testInfo, `broadcast-${width}-diary-no-match`);
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
for (const width of [1100, 1440])
  test(`${width}: planner with events today, later this week and beyond it`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await setupVisualFixture(page, 'dark');
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
      await openPlannerPage(page);
      await expect(planner).toBeVisible();
    };
    const period = planner.getByRole('radiogroup', { name: 'Период плана' });
    const refresh = planner.getByRole('button', { name: 'Обновить расписание' });

    // Today only: one event, nothing to choose, count or filter.
    await openPlanner([plannerMatch('today', '2026-10-25T12:00:00Z')]);
    await expect(planner.locator('.planner-event')).toHaveCount(1);
    await expect(period).toHaveCount(0);
    await expect(planner.locator('.planner-insights')).toHaveCount(0);
    await expect(planner.locator('.planner-filter')).toHaveCount(0);
    await expect(refresh).toBeEnabled();
    await shoot(page, testInfo, `broadcast-${width}-planner-today`);

    // Later this week only: events on two days, so the period can be chosen.
    await openPlanner([
      plannerMatch('wed', '2026-10-28T12:00:00Z'),
      plannerMatch('fri', '2026-10-30T12:00:00Z'),
    ]);
    await expect(planner.locator('.planner-event')).toHaveCount(2);
    await expect(planner).not.toContainText('Ближайшие события —');
    await expect(period).toBeVisible();
    await expect(planner.locator('.planner-insights')).toContainText('события в периоде2');
    await expect(planner.locator('.planner-filter')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-planner-week`);
    await period.getByRole('radio', { name: 'Сегодня', exact: true }).click();
    await expect(planner.locator('.state-block')).toHaveCount(1);
    await expect(planner.locator('.state-block')).toContainText('В этот день событий нет');
    await expect(planner.locator('.planner-insights')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-planner-day-empty`);
    await planner.getByRole('button', { name: 'Показать ближайшие 7 дней' }).click();
    await expect(planner.locator('.planner-event')).toHaveCount(2);
    await planner.getByRole('button', { name: 'Буду смотреть: Arsenal — Chelsea' }).first().click();
    await expect(planner.locator('.planner-filter')).toBeVisible();
    await expect(planner.locator('.planner-insights')).toContainText('выбрано смотреть1');
    await shoot(page, testInfo, `broadcast-${width}-planner-chosen`);

    // Beyond the week: the next events with their distance instead of "no events".
    await openPlanner([plannerMatch('far', '2026-11-03T12:00:00Z')]);
    await expect(planner.locator('.planner-event')).toHaveCount(1);
    await expect(planner).toContainText('Ближайшие события — через 9 дней');
    await expect(planner).not.toContainText('нет событий');
    await expect(planner.locator('.state-block')).toHaveCount(0);
    await expect(period).toHaveCount(0);
    await expect(planner.locator('.planner-insights')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-planner-far`);

    // A busy week: today, tomorrow and a race that overlaps a match.
    await openPlanner(
      [plannerMatch('a', '2026-10-25T12:00:00Z'), plannerMatch('b', '2026-10-26T13:00:00Z')],
      [plannerRace(20, 'Mexico City Grand Prix', '2026-10-25')],
    );
    await expect(planner.locator('.planner-event')).toHaveCount(3);
    await expect(planner.locator('.planner-insights > div')).toHaveCount(2);
    await expect(planner.locator('.planner-insights')).toContainText('события в периоде3');
    await expect(planner.locator('.planner-insights')).toContainText('группа пересечений1');
    await shoot(page, testInfo, `broadcast-${width}-planner-busy`);
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

const centerEvent = (id: string, sport: 'football' | 'f1', read: boolean, hoursAgo: number) => ({
  id,
  sport,
  kind: sport === 'f1' ? 'reminder' : 'goal',
  title: sport === 'f1' ? 'Скоро гонка' : 'Изменение счёта',
  body: sport === 'f1' ? 'Гран-при Мехико · Гонка' : 'Arsenal — Chelsea · 2 : 1',
  occurredAt: Date.parse('2026-10-25T00:00:00Z') - hoursAgo * 3_600_000,
  read,
  ...(sport === 'f1' ? { season: '2026', round: '20' } : { matchId: id, leagueId: 'l_4WFCIZ' }),
});
for (const width of [1100, 1440])
  test(`${width}: event center with read and unread events of one or two sports`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await setupVisualFixture(page, 'dark');
    const state = { events: [] as ReturnType<typeof centerEvent>[], catchUp: false };
    await page.route('**/bridge/command', async (route) => {
      const body = route.request().postDataJSON();
      if (body.command === 'event_center_list') return route.fulfill({ json: state.events });
      if (body.command === 'event_center_mark_read') {
        const ids: string[] = body.args?.ids ?? [];
        state.events = state.events.map((e) => (ids.includes(e.id) ? { ...e, read: true } : e));
        return route.fulfill({ json: {} });
      }
      if (body.command === 'catchup_summary' && state.catchUp)
        return route.fulfill({
          json: {
            from: Date.parse('2026-10-23T00:00:00Z'),
            to: Date.parse('2026-10-25T00:00:00Z'),
            truncated: false,
            footballIncomplete: false,
            f1Incomplete: false,
            items: [{ ...centerEvent('missed-1', 'football', false, 20), title: 'Матч завершён' }],
          },
        });
      return route.fulfill({ json: {} });
    });
    await page.goto('/');
    const center = page.locator('.event-center');
    const openCenter = async (events: ReturnType<typeof centerEvent>[], catchUp = false) => {
      state.events = events;
      state.catchUp = catchUp;
      await page.reload();
      await rail(page).getByRole('button', { name: 'События', exact: true }).click();
      await expect(center).toBeVisible();
    };
    const filters = center.getByRole('radiogroup', { name: 'Фильтр событий' });

    // One sport, all unread: nothing to filter, one action.
    await openCenter([
      centerEvent('a', 'football', false, 3),
      centerEvent('b', 'football', false, 5),
    ]);
    await expect(center.locator('article')).toHaveCount(2);
    await expect(filters).toHaveCount(0);
    await expect(center.getByRole('button', { name: 'Прочитать все' })).toBeEnabled();
    await shoot(page, testInfo, `broadcast-${width}-events-one-sport`);

    // Both sports, some read, with the missed-results card.
    await openCenter(
      [
        centerEvent('a', 'football', false, 3),
        centerEvent('b', 'f1', false, 6),
        centerEvent('c', 'football', true, 30),
      ],
      true,
    );
    await expect(center.locator('.catchup-panel')).toBeVisible();
    await expect(center.locator('article')).toHaveCount(3);
    await expect(filters.getByRole('radio')).toHaveText([
      'Все',
      'Непрочитанные · 2',
      'Футбол',
      'Формула 1',
    ]);
    await shoot(page, testInfo, `broadcast-${width}-events-mixed`);

    // The unread filter runs out: one phrase, one way back.
    await filters.getByRole('radio', { name: 'Непрочитанные · 2' }).click();
    await expect(center.locator('article')).toHaveCount(2);
    await center.getByRole('button', { name: 'Прочитать все' }).click();
    await expect(center.locator('.state-block')).toHaveCount(1);
    await expect(center.locator('.state-block')).toContainText('Всё прочитано');
    await expect(center.getByRole('button', { name: 'Прочитать все' })).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-events-all-read`);
    await center.getByRole('button', { name: 'Показать все события' }).click();
    await expect(center.locator('article')).toHaveCount(3);
    // Everything is read: only the sport filters are left, no unread count, no "read all".
    await expect(filters.getByRole('radio')).toHaveText(['Все', 'Футбол', 'Формула 1']);
    await expect(center.getByRole('button', { name: 'Прочитать все' })).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

const clubs = [
  'Aurora City',
  'Birchwood United',
  'Cobalt Rovers',
  'Dunmore Athletic',
  'Eastvale',
  'Fenwick Town',
  'Granite Hill',
  'Harbor Albion',
  'Ironbridge',
  'Juniper Park',
  'Kestrel Wanderers',
  'Lakeside',
].map((name, i) => ({ id: `club-${i + 1}`, name }));
const clubMatches = clubs.map((club, i) => {
  const date = `2026-10-${String(10 + i).padStart(2, '0')}`;
  return {
    id: `club-match-${i + 1}`,
    status: 'finished',
    home_team: club,
    away_team: clubs[(i + 1) % clubs.length]!,
    time_utc: `${date}T15:00:00Z`,
    date,
    score_home: 2,
    score_away: 1,
  };
});
const surnames = [
  'Ambrose',
  'Baxter',
  'Calloway',
  'Dalton',
  'Everett',
  'Fletcher',
  'Garrick',
  'Hollis',
  'Ingram',
  'Jarrett',
  'Kemp',
  'Lowell',
  'Marlow',
  'Nash',
  'Osgood',
  'Prescott',
  'Quill',
  'Rowan',
];
const squadOf = (club: { id: string; name: string }) => {
  const players = surnames.map((surname, k) => ({
    player_id: `${club.id}-p${k + 1}`,
    name: `${club.name.split(' ')[0]} ${surname}`,
    shirt_number: String(k + 1),
  }));
  return {
    formation: '4-3-3',
    confirmed: true,
    starters: players.slice(0, 11),
    subs: players.slice(11),
  };
};
const favoritePlayers = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const club = clubs[i % clubs.length]!;
    return {
      id: `${club.id}-p1`,
      name: `${club.name.split(' ')[0]} ${surnames[0]}`,
      teamId: club.id,
      teamName: club.name,
      matchId: `club-match-${(i % clubs.length) + 1}`,
      matchLabel: `${club.name} — ${clubs[(i + 1) % clubs.length]!.name}`,
      savedAt: '2026-10-20T10:00:00Z',
    };
  });
async function clubFixture(page: Page, extra: unknown[] = [], state = { upcoming: true }) {
  const errors = await setupVisualFixture(page, 'dark');
  await page.route('**/bridge/command', async (route) => {
    const body = route.request().postDataJSON();
    if (String(body.command).startsWith('history_')) return route.fulfill({ json: [] });
    return route.fallback();
  });
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source');
    const path = url.searchParams.get('path') ?? '';
    if (source !== 'pitch') return route.fallback();
    let data: unknown = {};
    const squadPath = /^matches\/([^/]+)\/(lineups|players)$/.exec(path);
    if (path === 'leagues')
      data = { leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }] };
    else if (path.startsWith('leagues/'))
      data = {
        league: { id: 'l_4WFCIZ', name: 'Premier League' },
        matches: state.upcoming ? [...clubMatches, ...extra] : clubMatches,
      };
    else if (squadPath?.[2] === 'lineups') {
      const match = clubMatches.find((m) => m.id === decodeURIComponent(squadPath[1]!));
      data = match && {
        match_id: match.id,
        home_team: match.home_team,
        away_team: match.away_team,
        home: squadOf(match.home_team),
        away: squadOf(match.away_team),
      };
    } else if (squadPath?.[2] === 'players') {
      // Figures exist for the first player of the home club only.
      const match = clubMatches.find((m) => m.id === decodeURIComponent(squadPath[1]!));
      data = match
        ? [
            {
              player: {
                id: `${match.home_team.id}-p1`,
                name: `${match.home_team.name.split(' ')[0]} ${surnames[0]}`,
              },
              team_id: match.home_team.id,
              stats: [
                {
                  key: 'summary',
                  title: 'Summary',
                  stats: { Goals: { key: 'goals', stat: { type: 'number', value: 1 } } },
                },
              ],
            },
          ]
        : [];
    }
    await route.fulfill({
      json: {
        payload: { data },
        source: 'fixture',
        stale: false,
        fetchedAt: '2026-10-25T00:00:00Z',
      },
    });
  });
  return errors;
}
const seedFavorites = (page: Page, teamIds: string[], players: unknown[]) =>
  page.evaluate(
    ([ids, saved]) => {
      localStorage.setItem(
        'sportsdesk.football.favorites.teams',
        JSON.stringify({ ids, seeded: [], seededDefault: true }),
      );
      localStorage.setItem('sportsdesk.football.favorites.players', JSON.stringify(saved));
    },
    [teamIds, players] as const,
  );
for (const width of [1100, 1440])
  test(`${width}: players with none, one and ten favourites, a club and a search without matches`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await clubFixture(page);
    await page.goto('/');
    const players = page.locator('.players-view');
    const openPlayers = async (saved: unknown[]) => {
      await seedFavorites(page, [], saved);
      await page.reload();
      await section(page, 'Футбол');
      await headerTab(page, 'Игроки');
      await expect(players).toBeVisible();
    };

    await openPlayers([]);
    await expect(players.getByRole('heading', { name: /Избранные игроки/ })).toHaveCount(0);
    await expect(players.locator('.state-block')).toHaveCount(1);
    await expect(players.locator('.state-block')).toContainText('Избранных игроков пока нет');
    await expect(players.locator('.pc-picker')).toHaveCount(0);
    await expect(players.locator('.player-directory')).toBeVisible();
    await shoot(page, testInfo, `broadcast-${width}-players-none`);

    await openPlayers(favoritePlayers(1));
    await expect(players.getByRole('heading', { name: 'Избранные игроки · 1' })).toBeVisible();
    await expect(players.locator('.pc-card')).toHaveCount(1);
    await expect(players.locator('.pc-picker')).toHaveCount(0);
    await expect(players.getByRole('button', { name: /^Сравнить:/ })).toHaveCount(0);
    await expect(players.locator('.pc-card .pc-scope')).toContainText(
      'Сводка по 1 матчу с данными',
    );
    await expect(players.locator('.pc-card .pc-metrics')).toContainText('Голы');
    await shoot(page, testInfo, `broadcast-${width}-players-one`);

    await openPlayers(favoritePlayers(10));
    await expect(players.getByRole('heading', { name: 'Избранные игроки · 10' })).toBeVisible();
    await expect(players.locator('.pc-card')).toHaveCount(10);
    await expect(players.locator('.pc-picker select')).toHaveCount(2);
    await shoot(page, testInfo, `broadcast-${width}-players-ten`);

    await openPlayers(favoritePlayers(2));
    const directory = players.locator('.player-directory');
    await directory.getByLabel('Клуб для выбора игроков').fill('Cobalt');
    await directory.getByRole('option', { name: 'Cobalt Rovers' }).click();
    const squad = players.locator('.club-players');
    await expect(squad.locator('.squad-player')).toHaveCount(18);
    await expect(squad.locator('.section-title .muted')).toHaveText('18 игроков');
    await squad.getByLabel('Поиск игрока в составе').fill('нет такого игрока');
    await expect(squad.locator('.squad-player')).toHaveCount(0);
    await expect(squad.locator('.state-block')).toHaveCount(1);
    await expect(squad.locator('.state-block')).toContainText('Таких игроков в составе нет');
    await squad.scrollIntoViewIfNeeded();
    await shoot(page, testInfo, `broadcast-${width}-players-no-match`);
    await squad.getByRole('button', { name: 'Очистить поиск' }).click();
    await expect(squad.locator('.squad-player')).toHaveCount(18);
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

for (const width of [1100, 1440])
  test(`${width}: clubs with none, one and ten favourites and a club chosen`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await clubFixture(page);
    await page.goto('/');
    const view = page.locator('.team-view');
    const openClubs = async (ids: string[]) => {
      await seedFavorites(page, ids, []);
      await page.reload();
      await section(page, 'Футбол');
      await headerTab(page, 'Клубы');
      await expect(view.locator('h2.screen-title')).toHaveText('Клубы');
    };
    const picker = view.locator('#team-picker-select');

    await openClubs([]);
    await expect(view.locator('.team-favorites')).toHaveCount(0);
    await expect(view.locator('.state-block')).toHaveCount(1);
    await expect(view.locator('.state-block')).toContainText('Пока нет доступных избранных клубов');
    await expect(picker).toBeVisible();
    await shoot(page, testInfo, `broadcast-${width}-clubs-none`);

    await openClubs(['club-2']);
    await expect(view.locator('.team-favorites button')).toHaveCount(1);
    await expect(view.locator('.state-block')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-clubs-one`);

    await openClubs(clubs.slice(0, 10).map((club) => club.id));
    await expect(view.locator('.team-favorites button')).toHaveCount(10);
    await expect(view.locator('.state-block')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-clubs-ten`);

    await view.locator('.team-favorites').getByRole('button', { name: 'Cobalt Rovers' }).click();
    await expect(view.locator('h2.screen-title')).toHaveText('Cobalt Rovers');
    await expect(picker).toHaveValue('club-3');
    await expect(view.locator('.team-favorites')).toHaveCount(0);
    await expect(view.locator('.club-players .squad-player')).toHaveCount(18);
    await shoot(page, testInfo, `broadcast-${width}-clubs-chosen`);
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

const defaultClubNames: string[] = JSON.parse(
  readFileSync('src/shared/sportsContracts.json', 'utf8'),
).teams.map((team: { name: string }) => team.name);
const nextMatches = [2, 3].map((i) => ({
  id: `club-next-${i}`,
  status: 'scheduled',
  home_team: clubs[i - 1]!,
  away_team: clubs[i]!,
  time_utc: `2026-10-${26 + i}T15:00:00Z`,
  date: `2026-10-${26 + i}`,
  score_home: null,
  score_away: null,
}));
for (const width of [1100, 1440])
  test(`${width}: home shows only tiles and blocks that have something to say`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = { upcoming: false };
    const errors = await clubFixture(page, nextMatches, state);
    await page.route('**/bridge/api**', async (route) => {
      const url = new URL(route.request().url());
      const source = url.searchParams.get('source');
      if (source === 'livescore')
        return route.fulfill({
          json: {
            payload: { Stages: [] },
            source,
            stale: false,
            fetchedAt: '2026-10-25T00:00:00Z',
          },
        });
      if (source === 'jolpica')
        return route.fulfill({
          json: {
            payload: { MRData: { RaceTable: { Races: [] } } },
            source,
            stale: false,
            fetchedAt: '2026-10-25T00:00:00Z',
          },
        });
      return route.fallback();
    });
    await page.goto('/');
    const home = page.locator('.today-view');
    const openHome = async (teamIds: string[], upcomingToo: boolean) => {
      state.upcoming = upcomingToo;
      await page.evaluate(
        ([ids, dismissed]) => {
          localStorage.setItem(
            'sportsdesk.football.favorites.teams',
            JSON.stringify({ ids, seeded: [], seededDefault: true, dismissed }),
          );
          localStorage.setItem('sportsdesk.f1.favTeams', '[]');
          localStorage.setItem('sportsdesk.f1.favDrivers', '[]');
        },
        [teamIds, defaultClubNames] as const,
      );
      await page.reload();
      await expect(home).toBeVisible();
    };

    // Nothing ahead and no tracked club: empty blocks are not rendered at all.
    await openHome([], false);
    await expect(home.locator('[data-block]')).toHaveCount(0);
    await expect(home.locator('.state-block')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-home-nothing`);

    // A tracked club and matches ahead: the blocks with values, one club tile.
    await openHome(['club-2'], true);
    const withClub = home.locator('[data-block]');
    await expect(withClub).toHaveCount(2);
    await expect(home.locator('[data-block="teams"] .today-team-tile')).toHaveCount(1);
    await expect(home.locator('[data-block="teams"]')).toContainText('Birchwood United');
    await expect(home.locator('[data-block="upcoming"]')).toContainText(
      'Birchwood United — Cobalt Rovers',
    );
    await expect(home.locator('.state-block')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-home-tracked`);

    // Matches ahead but no tracked club: no empty schedule block either.
    await openHome([], true);
    await expect(home.locator('[data-block]')).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-home-schedule-only`);

    await openHome(
      clubs.slice(0, 10).map((club) => club.id),
      true,
    );
    await expect(home.locator('[data-block="teams"] .today-team-tile')).toHaveCount(10);
    await expect(home.locator('[data-block]')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    await expect(home.getByRole('heading', { name: 'Мои команды', exact: true })).toBeVisible();
    await expect(home.getByRole('heading', { name: 'Ближайшее', exact: true })).toBeVisible();
    await expect(page.locator('.mode-hero')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /баннер/ })).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-home-ten`);
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

for (const width of [1100, 1440])
  test(`${width}: offline seasons with no packages, a queue and a package to read`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await setupVisualFixture(page, 'dark');
    const complete = completeOfflineSeason();
    complete.season = '2025/2026';
    const unverified = {
      ...offlineSeason,
      leagueId: 'l_0eg6C9',
      leagueName: 'MLS',
      season: '2026',
      pinned: false,
    };
    const saved = { packages: [] as OfflineSeason[] };
    await page.route('**/bridge/command', async (route) => {
      const { command, args = {} } = route.request().postDataJSON();
      if (command === 'offline_list')
        return route.fulfill({ json: saved.packages.map(summarizeSeason) });
      if (command === 'offline_get')
        return route.fulfill({
          json: saved.packages.find(
            (p) => p.leagueId === args.leagueId && p.season === args.season,
          ),
        });
      if (command === 'history_seasons') return route.fulfill({ json: [] });
      return route.fallback();
    });
    await page.goto('/');
    const view = page.locator('.offline-view');
    const openOffline = async (packages: OfflineSeason[], jobs: unknown[] = []) => {
      saved.packages = packages;
      await page.evaluate(
        (queue) => localStorage.setItem('sportsdesk.view.offline', JSON.stringify(queue)),
        { version: 1, paused: false, jobs },
      );
      await page.reload();
      await openSettingsData(page);
      await expect(view).toBeVisible();
      await expect(page.locator('.settings-offline')).toContainText('Офлайн-сезоны');
    };
    const queue = view.getByRole('region', { name: 'Очередь загрузки' });

    // Nothing saved and nothing queued: one phrase, no queue, no zero count, no idle reload.
    await openOffline([]);
    await expect(view).toContainText('Пока нет офлайн-пакетов');
    await expect(queue).toHaveCount(0);
    await expect(view).not.toContainText('из 60 пакетов');
    await expect(view.getByRole('button', { name: 'Перечитать библиотеку' })).toHaveCount(0);
    await shoot(page, testInfo, `broadcast-${width}-offline-empty`);

    // Packages with a queued season: facts without zeros, the queue with its control.
    await openOffline(
      [complete, unverified],
      [
        {
          leagueId: 'l_4WFCIZ',
          leagueName: 'Premier League',
          season: '2027/2028',
          attempt: 'attempt-1',
          pin: true,
          state: 'queued',
          error: null,
          addedAt: '2026-10-24T00:00:00Z',
        },
      ],
    );
    await expect(view).toContainText('2 из 60 пакетов');
    // After a launch the queue waits for «Продолжить».
    await expect(queue).toContainText('На паузе · ожидают: 1');
    await expect(queue.getByRole('button', { name: 'Продолжить' })).toBeVisible();
    const full = view.locator('.offline-package').filter({ hasText: 'Полный календарь' });
    await expect(full).toContainText('380 из 380 матчей');
    await expect(full.locator('dt')).toHaveText([
      'Обновлён',
      'Размер данных',
      'Завершено по снимку',
    ]);
    const unknown = view.locator('.offline-package').filter({ hasText: 'Полнота не проверена' });
    await expect(unknown).toContainText('Полнота не проверена · 2 матча');
    await expect(unknown.locator('dt')).toContainText(['Время уточняется']);
    await shoot(page, testInfo, `broadcast-${width}-offline-packages`);

    // Reading a package whose matches are all finished: no filter on "finished", a pager.
    await full.getByRole('button', { name: 'Открыть без сети' }).click();
    const reader = page.getByRole('region', { name: 'Офлайн-календарь' });
    await expect(reader.getByLabel('Поиск команды')).toBeVisible();
    await expect(reader.locator('select')).toHaveCount(0);
    await expect(reader).toContainText('380 матчей · страница 1 из 16');
    await reader.getByLabel('Поиск команды').fill('Неизвестная команда');
    await expect(reader).toContainText('Матчи по этим условиям не найдены');
    await expect(reader.getByRole('button', { name: 'Сбросить поиск и фильтр' })).toHaveCount(1);
    await reader.scrollIntoViewIfNeeded();
    await shoot(page, testInfo, `broadcast-${width}-offline-reader`);
    await reader.getByRole('button', { name: 'Сбросить поиск и фильтр' }).click();
    await expect(reader.locator('tbody tr')).toHaveCount(25);
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

const uclMatch = (i: number, finished: boolean) => ({
  id: `ucl-${i}`,
  status: finished ? 'finished' : 'scheduled',
  home_team: clubs[i % clubs.length]!,
  away_team: clubs[(i + 3) % clubs.length]!,
  time_utc: `2026-${finished ? '10-2' + (i % 5) : '11-0' + (1 + (i % 5))}T19:00:00Z`,
  date: `2026-${finished ? '10-2' + (i % 5) : '11-0' + (1 + (i % 5))}`,
  score_home: finished ? 2 : null,
  score_away: finished ? 1 : null,
});
for (const width of [1100, 1440])
  test(`${width}: champions league tiles before the first match and with results`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await clubFixture(page);
    const season = { matches: [] as unknown[] };
    await page.route('**/bridge/api**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.searchParams.get('path') ?? '';
      if (url.searchParams.get('source') !== 'pitch') return route.fallback();
      let data: unknown;
      if (path === 'leagues')
        data = {
          leagues: [
            { id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] },
            { id: 'l_0bfbkO', name: 'Champions League', seasons: ['2026/2027'] },
          ],
        };
      else if (path.startsWith('leagues/l_0bfbkO'))
        data = { league: { id: 'l_0bfbkO', name: 'Champions League' }, matches: season.matches };
      else return route.fallback();
      await route.fulfill({
        json: {
          payload: { data },
          source: 'fixture',
          stale: false,
          fetchedAt: '2026-10-25T00:00:00Z',
        },
      });
    });
    await page.goto('/');
    const openChampions = async (matches: unknown[]) => {
      season.matches = matches;
      await page.reload();
      await section(page, 'Футбол');
      await page.locator('.competition-switcher-trigger').click();
      await page.getByRole('menuitemradio', { name: 'Лига чемпионов' }).click();
      await headerTab(page, 'Матчи');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    };
    const tiles = page.locator('.ucl-insights > div');

    // Draw made, nothing played: only the teams.
    await openChampions([uclMatch(1, false), uclMatch(2, false)]);
    await expect(tiles).toHaveCount(1);
    await expect(page.locator('.ucl-insights')).toContainText('4команды в розыгрыше');
    await expect(page.locator('.ucl-insights')).not.toContainText('сыгранных');
    await shoot(page, testInfo, `broadcast-${width}-ucl-before`);

    // Two matches played: teams, matches and goals.
    await openChampions([uclMatch(1, true), uclMatch(2, true), uclMatch(3, false)]);
    await expect(tiles).toHaveCount(3);
    await expect(page.locator('.ucl-insights')).toContainText('2сыгранных матча');
    await expect(page.locator('.ucl-insights')).toContainText('6голов в завершённых матчах');
    await shoot(page, testInfo, `broadcast-${width}-ucl-played`);

    // Nothing published at all: no tile row.
    await openChampions([]);
    await expect(page.locator('.ucl-insights')).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });
