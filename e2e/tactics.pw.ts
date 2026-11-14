import { test, expect, type Page } from '@playwright/test';
import { E2E_ORIGIN } from './origin';
import { tacticLineups, tacticMatch } from '../src/test/fixtures/tactics';

async function setup(page: Page, design: string, scheme: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const state = { sourceAvailable: true };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge/api') {
      const path = url.searchParams.get('path') ?? '';
      let data: unknown = {};
      if (path === 'leagues')
        data = { leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }] };
      else if (path.startsWith('leagues/'))
        data = { league: { id: 'l_4WFCIZ', name: 'Premier League' }, matches: [tacticMatch] };
      else if (path === `matches/${tacticMatch.id}`) data = tacticMatch;
      else if (path.endsWith('/lineups')) {
        if (!state.sourceAvailable)
          return route.fulfill({
            status: 503,
            json: { error: { code: 'Upstream', message: 'Состав временно недоступен.' } },
          });
        data = tacticLineups;
      } else if (path.endsWith('/players')) data = [];
      else if (path.endsWith('/events')) data = { events: [] };
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
    if (url.origin !== E2E_ORIGIN)
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" />',
      });
    return route.continue();
  });
  await page.addInitScript(
    ({ design, scheme, id }) => {
      localStorage.setItem('sportsdesk.design', design);
      localStorage.setItem('sportsdesk.scheme', scheme);
      localStorage.setItem('sportsdesk.sport', 'football');
      localStorage.setItem('sportsdesk.league', 'l_4WFCIZ');
      sessionStorage.setItem(`sportsdesk.view.match.${id}.tab`, JSON.stringify('tactics'));
    },
    { design, scheme, id: tacticMatch.id },
  );
  await page.clock.setFixedTime(new Date('2026-11-09T00:00:00Z'));
  return { errors, state };
}

async function openMatch(page: import('@playwright/test').Page) {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Футбол', exact: true })
    .click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Матчи', exact: true }).click();
  await page.locator(`[data-match-id="${tacticMatch.id}"] .fixture-club`).first().click();
  await page.getByRole('tab', { name: 'Мои схемы', exact: true }).click();
}

for (const design of ['classic', 'broadcast'])
  for (const scheme of ['dark', 'light'])
    for (const width of [1100, 1440]) {
      test(`${design} ${scheme} ${width}: tactical board`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const { errors } = await setup(page, design, scheme);
        await page.goto('/');
        await openMatch(page);
        await page.evaluate(() => document.fonts.ready);
        await page.getByRole('button', { name: 'Создать из состава', exact: true }).click();
        const feature = page.getByRole('region', { name: 'Тактическая доска', exact: true });
        const field = page.getByRole('group', { name: 'Поле тактической доски' });
        await expect(feature.locator('.tactics-player')).toHaveCount(4);
        await expect(feature).toContainText('предварительный состав');
        await page.getByLabel('Название схемы', { exact: true }).fill('Прессинг на фланге');
        await page.getByLabel('Привязка схемы', { exact: true }).selectOption('team:arsenal');
        await page
          .getByLabel('Выбранный игрок', { exact: true })
          .selectOption(JSON.stringify(['arsenal', 'missing']));
        await page.getByRole('button', { name: 'Разместить в центре', exact: true }).click();
        await expect(feature.locator('.tactics-player')).toHaveCount(5);
        await field.scrollIntoViewIfNeeded();
        const player = page.getByRole('button', {
          name: 'Игрок Bukayo Saka, Arsenal',
          exact: true,
        });
        const start = await player.boundingBox(),
          box = await field.boundingBox();
        expect(start).not.toBeNull();
        expect(box).not.toBeNull();
        await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
        await page.mouse.down();
        await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.68, { steps: 8 });
        await page.mouse.up();
        await player.focus();
        await page.keyboard.press('ArrowRight');
        const coordinate = page.getByLabel('Вдоль поля, %', { exact: true });
        expect(Number(await coordinate.inputValue())).toBeCloseTo(72, 0);
        await page.getByRole('button', { name: 'Рисовать стрелки', exact: true }).click();
        await field.click({ position: { x: box!.width * 0.3, y: box!.height * 0.2 } });
        await field.click({ position: { x: box!.width * 0.6, y: box!.height * 0.35 } });
        await expect(feature.locator('.tactics-arrows line')).toHaveCount(1);
        await page.getByRole('button', { name: 'Сохранить схему', exact: true }).click();
        const stored = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('sportsdesk.football.tactics')!),
        );
        expect(stored.schemes).toHaveLength(1);
        const saka = stored.schemes[0].players.find(
          (p: { teamId: string; playerId: string }) =>
            p.teamId === 'arsenal' && p.playerId === 'shared',
        );
        expect(saka.position.x).toBeCloseTo(0.72, 2);
        expect(saka.original.x).toBeCloseTo(0.3668, 3);
        expect(stored.schemes[0].source.homeConfirmed).toBe(false);
        const capture = await page.addStyleTag({
          content:
            '.app-root {height:auto;min-height:100vh;overflow:visible} .shell,.content {overflow:visible}',
        });
        await expect(feature).toHaveScreenshot(`${design}-${scheme}-${width}-tactics.png`);
        await capture.evaluate((el) => el.parentNode?.removeChild(el));
        await page.getByRole('button', { name: 'Сравнить с исходной', exact: true }).click();
        await expect(feature.locator('.tactics-player')).toHaveCount(4);
        await expect(coordinate).toBeDisabled();
        await page.getByRole('button', { name: 'Вернуться к моей схеме', exact: true }).click();
        await expect(feature.locator('.tactics-player')).toHaveCount(5);
        await page.setViewportSize({ width: width === 1100 ? 1440 : 1100, height: 1000 });
        expect(Number(await coordinate.inputValue())).toBeCloseTo(72, 0);
        await page.getByRole('tab', { name: 'Сводка', exact: true }).click();
        await page.getByRole('tab', { name: 'Мои схемы', exact: true }).click();
        await expect(feature.locator('.tactics-player')).toHaveCount(5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
      });
    }

test('saved schemes remain available without the source after a new session', async ({ page }) => {
  const { state } = await setup(page, 'classic', 'dark');
  await page.goto('/');
  await openMatch(page);
  await page.getByRole('button', { name: 'Создать из состава', exact: true }).click();
  await page.getByLabel('Название схемы', { exact: true }).fill('Запасной план');
  await page.getByRole('button', { name: 'Сохранить схему', exact: true }).click();
  await page.evaluate(() => sessionStorage.clear());
  state.sourceAvailable = false;
  await page.reload();
  await openMatch(page);
  await expect(
    page.getByRole('button', { name: 'Создать из состава', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Открыть Запасной план', exact: true }).click();
  await expect(page.locator('.tactics-player')).toHaveCount(4);
  await expect(page.getByLabel('Название схемы', { exact: true })).toHaveValue('Запасной план');
});

test('refreshing match data preserves an unsaved tactics draft', async ({ page }) => {
  await setup(page, 'classic', 'dark');
  await page.goto('/');
  await openMatch(page);
  await page.getByRole('button', { name: 'Создать из состава', exact: true }).click();
  const title = page.getByLabel('Название схемы', { exact: true });
  await title.fill('Незавершённая схема');
  const refresh = page.getByRole('button', { name: 'Обновить данные', exact: true });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(title).toHaveValue('Незавершённая схема');
  await expect(page.getByRole('tab', { name: 'Мои схемы', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
