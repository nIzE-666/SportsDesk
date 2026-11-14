import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

// Запускается только явно: $env:SPORTSDESK_METRICS_OUTPUT='...'; npx playwright test e2e/uiMetrics.pw.ts
test('measure twelve screens with deterministic fixtures', async ({ page }) => {
  const output = process.env.SPORTSDESK_METRICS_OUTPUT;
  test.skip(!output, 'Set SPORTSDESK_METRICS_OUTPUT to write the measurements.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'classic', 'dark');
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
  async function sidebar(title: string) {
    await page.locator('aside.sidebar').getByTitle(title, { exact: true }).click();
  }
  await expect(page.locator('.football-dashboard')).toContainText('Arsenal');
  await capture('Футбол: обзор', '.football-dashboard');
  const shell = await page.evaluate(() => ({
    topbarButtons: document.querySelectorAll('.topbar button').length,
    sidebarButtons: document.querySelectorAll('.sidebar button').length,
  }));
  await page.locator('.recent-game').first().click();
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  await capture('Матч', '.match-detail');
  const matchTabs = await page.locator('.md-tabs button').count();
  const matchTabsTop = Math.round((await page.locator('.md-tabs').boundingBox())!.y);
  await sidebar('Матчи');
  await capture('Матчи', '.matches-view');
  await sidebar('Таблицы');
  await capture('Таблица', '.standings-view');
  await sidebar('Счёт и события');
  await capture('Счёт и события', '.live-view');
  await sidebar('Игроки');
  await capture('Игроки', '.players-view');
  await sidebar('Клубы');
  await capture('Клубы', '.team-view');
  await page.getByRole('tab', { name: 'Формула 1' }).click();
  await sidebar('Паддок');
  await capture('Формула 1', '.f1-root');
  await sidebar('Календарь');
  await capture('Календарь F1', '.f1-root');
  await sidebar('Мой спортивный вечер');
  await capture('Планировщик', '.viewing-planner');
  await sidebar('Дневник просмотра');
  await capture('Дневник', '.diary-view');
  await page.getByRole('button', { name: 'Настройки', exact: true }).first().click();
  await page
    .getByRole('navigation', { name: 'Категории настроек' })
    .getByRole('button', { name: 'Основное', exact: true })
    .click();
  await capture('Настройки', '.settings-view');
  await writeFile(
    output!,
    JSON.stringify(
      {
        viewport: '1440x900',
        design: 'classic',
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
