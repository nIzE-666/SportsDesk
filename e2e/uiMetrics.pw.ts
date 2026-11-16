import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';
import { mockWatchAccount, seedWatchPreferences } from './watchFixture';

// Запускается только явно: $env:SPORTSDESK_METRICS_OUTPUT='...'; npx playwright test e2e/uiMetrics.pw.ts
test('measure the screens with deterministic fixtures', async ({ page }) => {
  const output = process.env.SPORTSDESK_METRICS_OUTPUT;
  test.skip(!output, 'Set SPORTSDESK_METRICS_OUTPUT to write the measurements.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await page.addInitScript(() => {
    const teams = Array.from({ length: 10 }, (_, index) => ({
      id: index === 0 ? 'arsenal' : `team-${index}`,
      name: index === 0 ? 'Arsenal' : `Club ${index}`,
    }));
    localStorage.setItem(
      'sportsdesk.football.favorites.teams',
      JSON.stringify({ ids: teams.map((team) => team.id) }),
    );
    localStorage.setItem('sportsdesk.football.catalogue', JSON.stringify(teams));
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);

  const results: Array<{
    name: string;
    height: number;
    viewport: number;
    buttons: number;
    fields: number;
    words: number;
  }> = [];
  async function capture(name: string, selector: string) {
    const target = page.locator(selector).first();
    await expect(target).toBeVisible();
    await page.waitForTimeout(300);
    results.push(
      await target.evaluate((element, label) => {
        const visible = (el: Element) => {
          const style = getComputedStyle(el);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            el.getClientRects().length > 0
          );
        };
        const text = (element as HTMLElement).innerText.trim();
        const content = document.querySelector<HTMLElement>('main.content');
        return {
          name: label,
          height: Math.round(element.scrollHeight),
          viewport: Math.round(content?.clientHeight ?? window.innerHeight),
          buttons: Array.from(element.querySelectorAll('button')).filter(visible).length,
          fields: Array.from(element.querySelectorAll('input, select, textarea')).filter(visible)
            .length,
          words: text ? text.split(/\s+/u).length : 0,
        };
      }, name),
    );
  }
  const section = (name: string) =>
    page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name, exact: true })
      .click();
  const tab = (name: string) =>
    page.locator('.shell-tabs').getByRole('tab', { name, exact: true }).click();
  await expect(page.locator('.today-view')).toContainText('Arsenal');
  await capture('Сегодня', '.today-view');
  const shell = await page.evaluate(() => ({
    railButtons: document.querySelectorAll('.nav-rail button').length,
    headerButtons: document.querySelectorAll('.shell-header button').length,
  }));
  await section('Футбол');
  await tab('Матчи');
  await page.locator('[data-match-id="test-match"] .mt-open').first().click();
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  await capture('Матч', '.match-detail');
  const matchTabs = await page
    .getByRole('tablist', { name: 'Разделы матча' })
    .getByRole('tab')
    .count();
  const matchTabsTop = Math.round(
    (await page.getByRole('tablist', { name: 'Разделы матча' }).boundingBox())!.y,
  );
  await page.locator('.shell-header-bar').getByRole('button', { name: 'Назад' }).click();
  await capture('Матчи', '.matches-view');
  await tab('Таблица');
  await capture('Таблица', '.standings-view');
  await tab('Матчи');
  await page
    .getByRole('radiogroup', { name: 'Фильтр матчей' })
    .getByRole('radio', { name: 'Сейчас идут', exact: true })
    .click();
  await capture('Матчи: сейчас идут', '.live-panel');
  await capture('Матчи: сейчас идут: страница', '.matches-view');
  await tab('Игроки');
  await capture('Игроки', '.players-view');
  await tab('Клубы');
  await capture('Клубы', '.team-view');
  await section('Формула 1');
  await tab('Обзор');
  await capture('Формула 1', '.f1-root');
  await tab('Календарь');
  await capture('Календарь F1', '.f1-root');
  await section('Сегодня');
  await tab('Мой план');
  await capture('Планировщик', '.viewing-planner');
  await section('Моё');
  await tab('Дневник');
  await capture('Дневник', '.diary-view');
  await section('Настройки');
  await page
    .getByRole('navigation', { name: 'Категории настроек' })
    .getByRole('button', { name: 'Основное', exact: true })
    .click();
  await capture('Настройки', '.settings-view');

  // «Игроки» после U4: избранные, сравнение, состав и профиль.
  await section('Футбол');
  await tab('Игроки');
  await page.evaluate(() => {
    localStorage.setItem(
      'sportsdesk.football.favorites.players',
      JSON.stringify([
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
      ]),
    );
    window.dispatchEvent(new Event('sportsdesk-storage-changed'));
  });
  await expect(page.locator('.players-favorites__row').first()).toBeVisible();
  await capture('Игроки: избранные', '.players-view');
  const compare = page.locator('.players-compare-picker');
  await compare.getByLabel('Первый игрок для сравнения').fill('Alex');
  await compare.getByRole('option', { name: 'Alex Morgan' }).click();
  await compare.getByLabel('Второй игрок для сравнения').fill('Jamie');
  await compare.getByRole('option', { name: 'Jamie Wilson' }).click();
  await capture('Игроки: сравнение', '.players-view');
  const directory = page.locator('.players-directory');
  await directory.getByLabel('Клуб или игрок').fill('Arsenal');
  await directory.getByRole('option', { name: 'Arsenal', exact: true }).click();
  await expect(page.locator('.players-squad__row').first()).toBeVisible();
  await capture('Игроки: состав', '.players-view');
  await page.locator('.players-squad__open').first().click();
  await expect(page.locator('.players-profile').first()).toBeVisible();
  await capture('Игроки: профиль', '.players-view');

  // Клуб после U4: четыре вкладки.
  await section('Футбол');
  await tab('Клубы');
  await page.locator('.team-favorites').getByRole('button', { name: 'Arsenal' }).click();
  const clubTabs = page.getByRole('tablist', { name: 'Разделы клуба' });
  for (const title of ['Обзор', 'Матчи', 'Состав', 'Личные встречи']) {
    await clubTabs.getByRole('tab', { name: title, exact: true }).click();
    await capture(`Клуб: ${title}`, '.team-view');
  }

  // Турнир после U4: пять вкладок Лиги чемпионов.
  await page.locator('.competition-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name: 'Лига чемпионов' }).click();
  for (const title of ['Матчи', 'Таблица', 'Сетка', 'Клубы', 'Игроки']) {
    await tab(title);
    await capture(`Турнир: ${title}`, '.ucl-view');
  }

  // «Смотреть» после U4: без входа, каталог, список и плеер.
  const signedOut = await mockWatchAccount(page, false);
  await section('Смотреть');
  await expect(page.locator('.watch-root-signed-out')).toBeVisible();
  await capture('Смотреть', '.watch-root');
  await page.unroute('**/bridge/command', signedOut);
  const signedIn = await mockWatchAccount(page, true);
  await seedWatchPreferences(page);
  await page.reload();
  await expect(page.locator('.today-view')).toBeVisible();
  await section('Смотреть');
  await expect(page.locator('.watch-catalog')).toBeVisible();
  await capture('Смотреть: каталог', '.watch-root');
  await page.getByRole('button', { name: 'Список каналов', exact: true }).click();
  await expect(page.locator('.watch-catalog--list')).toBeVisible();
  await capture('Смотреть: каталог списком', '.watch-root');
  await page
    .locator('.watch-catalog--list')
    .getByRole('button', { name: 'OKKO Football', exact: true })
    .click();
  await expect(page.locator('.watch-player-shell')).toBeVisible();
  await capture('Смотреть: плеер', '.watch-root');
  await page.unroute('**/bridge/command', signedIn);

  // Настройки после U4: девять категорий.
  await section('Настройки');
  const settingsNav = page.getByRole('navigation', { name: 'Категории настроек' });
  for (const category of [
    'Основное',
    'Избранное',
    'Уведомления',
    'Внешний вид',
    'Модули',
    'Просмотр',
    'Данные',
    'Источники',
    'О программе',
  ]) {
    await settingsNav.getByRole('button', { name: category, exact: true }).click();
    await capture(`Настройки: ${category}`, '.settings-view');
  }
  await writeFile(
    output!,
    JSON.stringify(
      {
        viewport: '1440x900',
        scheme: 'dark',
        fixture: 'e2e/uiFixture.ts',
        screens: results,
        shell: { ...shell, matchTabs, matchTabsTop },
      },
      null,
      2,
    ) + '\n',
  );
});
