import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

// Запускается только явно: $env:SPORTSDESK_METRICS_OUTPUT='...'; npx playwright test e2e/uiMetrics.pw.ts
test('measure twelve screens with deterministic fixtures', async ({ page }) => {
  const output = process.env.SPORTSDESK_METRICS_OUTPUT;
  test.skip(!output, 'Set SPORTSDESK_METRICS_OUTPUT to write the measurements.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'classic', 'dark', true);
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
  await page.locator('[data-match-id="test-match"] .fixture-club').first().click();
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  await capture('Матч', '.match-detail');
  const matchTabs = await page.locator('.md-tabs button').count();
  const matchTabsTop = Math.round((await page.locator('.md-tabs').boundingBox())!.y);
  await page.locator('.shell-header-bar').getByRole('button', { name: 'Назад' }).click();
  await capture('Матчи', '.matches-view');
  await tab('Таблица');
  await capture('Таблица', '.standings-view');
  await tab('Сейчас идут');
  await capture('Сейчас идут', '.live-view');
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
