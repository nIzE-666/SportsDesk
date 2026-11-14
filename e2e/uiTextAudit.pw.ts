import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addMatchDetails, enabled, upcoming } from './matchDetails';
import { setupVisualFixture } from './uiFixture';

// Запускается только явно: $env:SPORTSDESK_TEXT_OUTPUT='...'; npx playwright test e2e/uiTextAudit.pw.ts
// Выгружает пояснительные тексты состояний экранов (фиксированные данные, 1440 × 900) и считает элементы
// с шестью словами и больше: итоговая строка файла нужна для цели плана «не больше 80».
// Области: 29 состояний экранов; вкладки матча (завершённый матч без подробностей, с подробностями и ещё не
// начавшийся); мастер первого запуска; мини-окно. Последняя строка файла — общий итог по всем областям.
const aside = (page: Page, title: string) =>
  page.locator('aside.sidebar').getByTitle(title, { exact: true }).click();
const sportTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

type Row = { tag: string; text: string; words: number };
type Section = { group: string; name: string; count: number; words: number };

async function collect(page: Page, root: string, extra: string): Promise<Row[]> {
  return page.evaluate(
    ({ root, extra }) => {
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.getClientRects().length > 0
        );
      };
      const scope = document.querySelector(root) ?? document.body;
      const seen = new Set<string>();
      const rows: { tag: string; text: string; words: number }[] = [];
      const selector =
        'p, small, .muted, .settings-note, .eyebrow, h1, h2, h3, [class*="lede"], [class*="hint"], [class*="note"], summary, label' +
        (extra ? `, ${extra}` : '');
      for (const el of Array.from(scope.querySelectorAll(selector))) {
        if (!visible(el)) continue;
        const text = (el as HTMLElement).innerText.replace(/\s+/gu, ' ').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        rows.push({ tag: el.tagName.toLowerCase(), text, words: text.split(' ').length });
      }
      return rows;
    },
    { root, extra },
  );
}

test('count explanatory texts on every screen', async ({ page, context }) => {
  const output = process.env.SPORTSDESK_TEXT_OUTPUT;
  test.skip(!output, 'Set SPORTSDESK_TEXT_OUTPUT to write the text list.');
  test.setTimeout(480000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'broadcast', 'dark', true);
  await addMatchDetails(page);
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
  await expect(page.locator('main.content')).toBeVisible();
  const out: string[] = [];
  const sections: Section[] = [];
  /** Тексты, уже показанные в группе (шапка и действия матча повторяются на каждой вкладке). */
  const shared = new Map<string, Set<string>>();
  async function dump(
    name: string,
    options: { group?: string; on?: Page; root?: string; extra?: string; dedupe?: boolean } = {},
  ) {
    const target = options.on ?? page;
    const group = options.group ?? 'Экраны';
    await target.waitForTimeout(900);
    const rows = await collect(target, options.root ?? 'main.content', options.extra ?? '');
    const known = shared.get(group) ?? new Set<string>();
    shared.set(group, known);
    const lines: string[] = [];
    let count = 0;
    let words = 0;
    for (const row of rows) {
      if (options.dedupe && known.has(row.text)) continue;
      known.add(row.text);
      if (/^h[1-3]$/u.test(row.tag)) lines.push(`  ${row.tag.toUpperCase()}: ${row.text}`);
      else if (row.words >= 6) {
        lines.push(`  · (${row.words}) ${row.text}`);
        count += 1;
        words += row.words;
      }
    }
    sections.push({ group, name, count, words });
    out.push(`\n=== ${group}: ${name} ===`, ...lines);
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
    await dump(`Настройки: ${category}`);
  }

  // Вкладки матча. Завершённый матч: сначала с тем, что отдаёт базовый ответ (составы и статистика без игроков),
  // потом с подробностями (оценки, сравнение игроков, события, удары с xG), потом матч, который ещё не начался.
  async function matchTabs(group: string) {
    const tabs = page.locator('.md-tabs button');
    const count = await tabs.count();
    for (let index = 0; index < count; index += 1) {
      const label = (await tabs.nth(index).innerText()).trim();
      await tabs.nth(index).click();
      await dump(label, { group, dedupe: true });
    }
  }
  async function openFinishedMatch() {
    await page.addInitScript(() =>
      sessionStorage.setItem(
        'sportsdesk.view.navigation.football',
        JSON.stringify({ kind: 'football-match', matchId: 'test-match' }),
      ),
    );
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/');
    await expect(page.locator('.md-score')).toContainText('2 : 1');
  }
  await openFinishedMatch();
  await matchTabs('Матч (ответ без подробностей)');

  // С подробностями: игроки с оценками, события, удары с xG.
  enabled.finished = true;
  await openFinishedMatch();
  await page.getByRole('tab', { name: 'Игроки', exact: true }).click();
  await expect(page.locator('.player-card').first()).toBeVisible();
  await page.locator('.player-card').first().click();
  await dump('Игроки: профиль игрока', { group: 'Матч (с подробностями)', dedupe: true });
  await page.getByRole('button', { name: 'К игрокам' }).click();
  const compare = page.locator('.compare-selects');
  await compare.getByLabel('Первый игрок').fill('Alex');
  await compare.getByRole('option', { name: /Alex Morgan/ }).click();
  await compare.getByLabel('Второй игрок').fill('Jamie');
  await compare.getByRole('option', { name: /Jamie Wilson/ }).click();
  await dump('Сравнение двух игроков', { group: 'Матч (с подробностями)', dedupe: true });
  await matchTabs('Матч (с подробностями)');
  await page.getByRole('tab', { name: 'Мои схемы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать из состава' }).click();
  await dump('Мои схемы: редактор схемы', { group: 'Матч (с подробностями)', dedupe: true });
  await page.getByRole('tab', { name: 'Сводка', exact: true }).click();
  await page.getByRole('button', { name: 'Отметить просмотр' }).click();
  await dump('Форма записи о просмотре', { group: 'Матч (с подробностями)', dedupe: true });

  enabled.upcoming = true;
  await page.addInitScript(
    ({ matchId }) =>
      sessionStorage.setItem(
        'sportsdesk.view.navigation.football',
        JSON.stringify({ kind: 'football-match', matchId }),
      ),
    { matchId: upcoming.id },
  );
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await expect(page.locator('.md-score')).toBeVisible();
  const prediction = page.getByRole('button', { name: /Мой прогноз/u });
  if (await prediction.count()) await prediction.click();
  await matchTabs('Матч (ещё не начался)');

  // Мастер первого запуска открывается вручную, как из настроек.
  await page.goto('/');
  await expect(page.locator('.md-score')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('sportsdesk-open-onboarding')));
  const wizard = '[role="dialog"][aria-label="Настройка SportsDesk"]';
  for (let step = 1; step <= 8; step += 1) {
    await expect(page.locator(wizard).locator('.eyebrow')).toContainText(`ШАГ ${step} ИЗ 8`);
    await dump(`Шаг ${step}`, { group: 'Мастер первого запуска', root: wizard });
    if (step < 8)
      await page
        .locator(wizard)
        .getByRole('button', { name: step === 1 ? 'Начать' : 'Далее', exact: true })
        .click();
  }

  // Мини-окно: отдельная страница #mini; тестовые данные дают пустое состояние без матчей.
  const mini = await context.newPage();
  await mini.setViewportSize({ width: 360, height: 520 });
  await setupVisualFixture(mini, 'broadcast', 'dark', true);
  await mini.goto('/#mini');
  await expect(mini.locator('.mini-root')).toBeVisible();
  await dump('Мини-окно без матчей', {
    group: 'Мини-окно',
    on: mini,
    root: '.mini-root',
    extra: '.mini-empty span',
  });
  await mini.close();

  const groups = [...new Set(sections.map((section) => section.group))];
  const summary: string[] = ['\n### ПО ОБЛАСТЯМ'];
  let totalCount = 0;
  let totalWords = 0;
  for (const group of groups) {
    const list = sections.filter((section) => section.group === group);
    const count = list.reduce((sum, section) => sum + section.count, 0);
    const words = list.reduce((sum, section) => sum + section.words, 0);
    totalCount += count;
    totalWords += words;
    summary.push(`### ${group}: элементов ${count}, слов ${words}`);
    for (const section of list)
      if (section.count) summary.push(`    ${section.name}: ${section.count} / ${section.words}`);
  }
  out.push(...summary);
  out.push(
    `\n### ИТОГО: пояснительных элементов (6 слов и больше) ${totalCount}, слов ${totalWords}`,
  );
  await writeFile(output!, out.join('\n') + '\n');
});
