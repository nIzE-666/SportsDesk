import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

// Запускается только явно: $env:SPORTSDESK_TEXT_OUTPUT='...'; npx playwright test e2e/uiTextAudit.pw.ts
// Выгружает пояснительные тексты 29 состояний экранов (без вкладок матча; фиксированные данные, 1440 × 900)
// и считает элементы с шестью словами и больше: итоговая строка файла нужна для цели плана «не больше 80».
const aside = (page: Page, title: string) =>
  page.locator('aside.sidebar').getByTitle(title, { exact: true }).click();
const sportTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

test('count explanatory texts on every screen', async ({ page }) => {
  const output = process.env.SPORTSDESK_TEXT_OUTPUT;
  test.skip(!output, 'Set SPORTSDESK_TEXT_OUTPUT to write the text list.');
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'broadcast', 'dark', true);
  await page.addInitScript(() => {
    const teams = [
      { id: 'arsenal', name: 'Arsenal' },
      { id: 'chelsea', name: 'Chelsea' },
    ];
    localStorage.setItem(
      'sportsdesk.football.favorites.teams',
      JSON.stringify({ ids: teams.map((team) => team.id) }),
    );
    localStorage.setItem('sportsdesk.football.catalogue', JSON.stringify(teams));
  });
  await page.goto('/');
  await expect(page.locator('.football-dashboard')).toBeVisible();
  const out: string[] = [];
  async function dump(name: string) {
    await page.waitForTimeout(900);
    const items = await page.evaluate(() => {
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.getClientRects().length > 0
        );
      };
      const root = document.querySelector('main.content') ?? document.body;
      const seen = new Set<string>();
      const rows: string[] = [];
      for (const el of Array.from(
        root.querySelectorAll(
          'p, small, .muted, .settings-note, .eyebrow, h1, h2, h3, [class*="lede"], [class*="hint"], [class*="note"], summary, label',
        ),
      )) {
        if (!visible(el)) continue;
        const text = (el as HTMLElement).innerText.replace(/\s+/gu, ' ').trim();
        if (!text || seen.has(text)) continue;
        const words = text.split(' ').length;
        const tag = el.tagName.toLowerCase();
        if (/^h[1-3]$/u.test(tag)) {
          seen.add(text);
          rows.push(`  ${tag.toUpperCase()}: ${text}`);
        } else if (words >= 6) {
          seen.add(text);
          rows.push(`  · (${words}) ${text}`);
        }
      }
      return rows;
    });
    out.push(`\n=== ${name} ===`, ...items);
  }

  await dump('Мой обзор');
  const football = ['Матчи', 'Таблицы', 'Счёт и события', 'Игроки', 'Клубы'];
  for (const title of football) {
    await aside(page, title);
    await dump(title);
  }
  await aside(page, 'Arsenal');
  await dump('Клуб: Arsenal');
  await sportTab(page, 'Формула 1');
  for (const title of [
    'Паддок',
    'Календарь',
    'Зачёты',
    'Сравнение пилотов',
    'Темп по кругам',
    'Центр сессии',
  ]) {
    await aside(page, title);
    await dump(`F1: ${title}`);
  }
  await sportTab(page, 'Лига чемпионов');
  for (const title of [
    'Европейский вечер',
    'Общая таблица',
    'Сетка плей-офф',
    'Все матчи',
    'Игроки и статистика',
  ]) {
    await aside(page, title);
    await dump(`ЛЧ: ${title}`);
  }
  await sportTab(page, 'Кубки');
  for (const title of ['Обзор', 'Таблица', 'Сетка плей-офф', 'Все матчи']) {
    await aside(page, title);
    await dump(`Кубки: ${title}`);
  }
  await aside(page, 'Мой спортивный вечер');
  await dump('Планировщик');
  await aside(page, 'Дневник просмотра');
  await dump('Дневник');
  await aside(page, 'Офлайн-сезоны');
  await dump('Офлайн-сезоны');
  await page
    .getByRole('button', { name: 'Игры', exact: true })
    .first()
    .click()
    .catch(() => {});
  await dump('Игры');
  await page.getByRole('button', { name: 'Смотреть', exact: true }).first().click();
  await dump('Смотреть');
  await page.getByRole('button', { name: 'Центр событий', exact: true }).first().click();
  await dump('Центр событий');
  await page.getByRole('button', { name: 'Настройки', exact: true }).first().click();
  await dump('Настройки');
  const explanatory = out.filter((line) => line.startsWith('  · ('));
  const words = explanatory.reduce(
    (sum, line) => sum + Number(/^ {2}· \((\d+)\)/u.exec(line)![1]),
    0,
  );
  out.push(
    `\n### ИТОГО: пояснительных элементов (6 слов и больше) ${explanatory.length}, слов ${words}`,
  );
  await writeFile(output!, out.join('\n') + '\n');
});
