import { test, expect, type Page } from '@playwright/test';
import { E2E_ORIGIN } from './origin';
import { readFile } from 'node:fs/promises';
import {
  diaryFixture,
  diaryFootballEntry,
  diaryMatch,
  diaryRace,
  diaryRaceEntry,
} from '../src/test/fixtures/diary';
import { tacticLineups } from '../src/test/fixtures/tactics';
import { parseDiaryText } from '../src/features/diary/diaryModel';

async function setup(page: Page, design: string, scheme: string, seed = true) {
  const errors: string[] = [],
    state = { offline: false };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge/api') {
      if (state.offline)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'Upstream', message: 'Нет связи с источником.' } },
        });
      const source = url.searchParams.get('source'),
        path = url.searchParams.get('path') ?? '';
      let payload: unknown = {};
      if (source === 'pitch') {
        let data: unknown = {};
        if (path === 'leagues')
          data = { leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }] };
        else if (path.startsWith('leagues/'))
          data = { league: { id: 'l_4WFCIZ', name: 'Premier League' }, matches: [diaryMatch] };
        else if (path === `matches/${diaryMatch.id}`) data = diaryMatch;
        else if (path.endsWith('/lineups')) data = tacticLineups;
        else if (path.endsWith('/players')) data = [];
        else if (path.endsWith('/events')) data = { events: [] };
        else if (path.endsWith('/stats') || path.endsWith('/shots')) data = { periods: [] };
        else if (path.endsWith('/momentum')) data = { points: [] };
        payload = { data };
      } else if (source === 'jolpica')
        payload = {
          MRData: {
            total: '1',
            RaceTable: { season: '2026', Races: path.startsWith('2026.json') ? [diaryRace] : [] },
          },
        };
      else payload = [];
      return route.fulfill({
        json: { payload, source: 'fixture', stale: false, fetchedAt: '2026-11-09T00:00:00Z' },
      });
    }
    if (url.pathname.startsWith('/bridge/')) return route.fulfill({ json: {} });
    if (url.origin !== E2E_ORIGIN)
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" />',
      });
    return route.continue();
  });
  await page.addInitScript(
    ({ design, scheme, seed, diary }) => {
      localStorage.setItem('sportsdesk.design', design);
      localStorage.setItem('sportsdesk.scheme', scheme);
      localStorage.setItem('sportsdesk.sport', 'football');
      localStorage.setItem('sportsdesk.league', 'l_4WFCIZ');
      if (seed && localStorage.getItem('sportsdesk.view.diary') === null)
        localStorage.setItem('sportsdesk.view.diary', JSON.stringify(diary));
    },
    { design, scheme, seed, diary: diaryFixture },
  );
  await page.clock.setFixedTime(new Date('2026-11-09T00:00:00Z'));
  return { errors, state };
}
const openDiary = async (page: Page) => {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Моё', exact: true })
    .click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Дневник', exact: true }).click();
};
const openMatch = async (page: Page) => {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Матчи', exact: true }).click();
  await page.locator(`[data-match-id="${diaryMatch.id}"] .fixture-club`).first().click();
};
for (const design of ['classic', 'broadcast'])
  for (const scheme of ['dark', 'light'])
    for (const width of [1100, 1440]) {
      test(`${design} ${scheme} ${width}: viewing diary`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const { errors } = await setup(page, design, scheme);
        await page.goto('/');
        await openDiary(page);
        await page.evaluate(() => document.fonts.ready);
        const feature = page.getByRole('region', { name: 'Дневник просмотра', exact: true });
        await expect(feature.locator('.diary-entry')).toHaveCount(2);
        await expect(
          feature.getByRole('heading', { name: 'Дневник просмотра', exact: true }),
        ).toBeVisible();
        await expect(feature.locator('.diary-summary')).toContainText('8,5');
        const capture = await page.addStyleTag({
          content:
            '.app-root{height:auto;min-height:100vh;overflow:visible}.shell,.content{overflow:visible}',
        });
        await expect(feature).toHaveScreenshot(`${design}-${scheme}-${width}-diary.png`);
        await capture.evaluate((el) => el.parentNode?.removeChild(el));
        await page.getByLabel('Фильтр по спорту', { exact: true }).selectOption('f1');
        await expect(feature.locator('.diary-entry')).toHaveCount(1);
        await page.getByLabel('Просмотрено по', { exact: true }).fill('2026-11-08');
        await expect(feature.locator('.diary-entry')).toHaveCount(0);
        await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
        const football = feature.getByRole('article').filter({
          has: page.getByRole('heading', { name: diaryFootballEntry.event.title, exact: true }),
        });
        await football.getByRole('button', { name: 'Открыть событие', exact: true }).click();
        await expect(page.locator('.md-score')).toContainText('1 : 1');
        await expect(
          page.getByRole('button', { name: 'Изменить запись о просмотре', exact: true }),
        ).toBeVisible();
        await openDiary(page);
        const race = feature.getByRole('article').filter({
          has: page.getByRole('heading', { name: diaryRaceEntry.event.title, exact: true }),
        });
        await race.getByRole('button', { name: 'Открыть событие', exact: true }).click();
        await expect(page.locator('.race-weekend')).toContainText('Suzuka Circuit');
        expect(
          await page.evaluate(
            () => JSON.parse(localStorage.getItem('sportsdesk.view.diary')!).entries.length,
          ),
        ).toBe(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
      });
    }

test('explicit marks, export, conflict-aware import and offline records', async ({
  page,
}, info) => {
  const { state } = await setup(page, 'classic', 'dark', false);
  await page.goto('/');
  await openMatch(page);
  await expect(page.locator('.md-score')).toContainText('1 : 1');
  expect(await page.evaluate(() => localStorage.getItem('sportsdesk.view.diary'))).toBeNull();
  await page.getByRole('button', { name: 'Отметить просмотр', exact: true }).click();
  await page
    .getByLabel('Заметка о просмотре', { exact: true })
    .fill('Смотрели вместе, интересная концовка.');
  await page.getByLabel('Теги записи', { exact: true }).fill('друзья, вечер');
  await page.getByLabel('Личная оценка', { exact: true }).selectOption('8');
  await page.getByRole('button', { name: 'Сохранить отметку', exact: true }).click();
  await openDiary(page);
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспортировать дневник', exact: true }).click();
  const download = await pendingDownload,
    path = info.outputPath('viewing-diary.json');
  await download.saveAs(path);
  const text = await readFile(path, 'utf8'),
    exported = parseDiaryText(text)!;
  expect(exported.entries).toHaveLength(1);
  await page.getByRole('button', { name: 'Удалить запись', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить удаление записи', exact: true }).click();
  const upload = (value: string) =>
    page.getByLabel('Импорт дневника', { exact: true }).setInputFiles({
      name: 'diary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(value),
    });
  await upload(text);
  await page.getByRole('button', { name: 'Подтвердить импорт дневника', exact: true }).click();
  await expect(page.locator('.diary-note')).toContainText('Смотрели вместе');
  const changed = JSON.stringify({
    ...exported,
    entries: [{ ...exported.entries[0], note: 'Заметка из другого компьютера' }],
  });
  await upload(changed);
  await page.getByRole('button', { name: 'Подтвердить импорт дневника', exact: true }).click();
  await expect(page.locator('.diary-note')).toContainText('Смотрели вместе');
  await upload(changed);
  await page.getByLabel('Заменить совпадающие записи данными из файла', { exact: true }).check();
  await page.getByRole('button', { name: 'Подтвердить импорт дневника', exact: true }).click();
  await expect(page.locator('.diary-note')).toContainText('Заметка из другого компьютера');
  state.offline = true;
  await page.reload();
  await openDiary(page);
  await expect(page.locator('.diary-note')).toContainText('Заметка из другого компьютера');
  await page.getByRole('button', { name: 'Добавить просмотр вручную', exact: true }).click();
  await page.getByLabel('Название события', { exact: true }).fill('Архивная гонка');
  await page.getByLabel('Вид спорта записи', { exact: true }).selectOption('f1');
  await page.getByLabel('Сезон записи', { exact: true }).fill('2008');
  await page.getByRole('button', { name: 'Сохранить отметку', exact: true }).click();
  await expect(page.locator('.diary-entry')).toHaveCount(2);
  await expect(page.getByText('Без привязки к источнику', { exact: true })).toBeVisible();
});
