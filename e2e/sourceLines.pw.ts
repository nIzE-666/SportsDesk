import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

type Screen = {
  name: string;
  open: (page: Page) => Promise<void>;
  /** Экран без загруженных данных (дневник, офлайн-библиотека, выбор клуба) источника не показывает. */
  noSource?: boolean;
};

const aside = (page: Page, title: string) =>
  page.locator('aside.sidebar').getByTitle(title, { exact: true }).click();
const sportTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

const screens: Screen[] = [
  { name: 'Мой обзор', open: async () => {} },
  { name: 'Матчи', open: (page) => aside(page, 'Матчи') },
  { name: 'Таблицы', open: (page) => aside(page, 'Таблицы') },
  { name: 'Счёт и события', open: (page) => aside(page, 'Счёт и события') },
  { name: 'Игроки', open: (page) => aside(page, 'Игроки') },
  { name: 'Клубы', open: (page) => aside(page, 'Клубы'), noSource: true },
  {
    name: 'Паддок',
    open: async (page) => {
      await sportTab(page, 'Формула 1');
      await aside(page, 'Паддок');
    },
  },
  { name: 'Календарь F1', open: (page) => aside(page, 'Календарь') },
  { name: 'Зачёты', open: (page) => aside(page, 'Зачёты') },
  {
    // В тестовых данных нет результатов гонок: экран показывает пустое состояние без источника.
    name: 'Сравнение пилотов',
    open: (page) => aside(page, 'Сравнение пилотов'),
    noSource: true,
  },
  { name: 'Темп по кругам', open: (page) => aside(page, 'Темп по кругам') },
  { name: 'Центр сессии', open: (page) => aside(page, 'Центр сессии') },
  {
    name: 'ЛЧ: европейский вечер',
    open: async (page) => {
      await sportTab(page, 'Лига чемпионов');
      await aside(page, 'Европейский вечер');
    },
  },
  { name: 'ЛЧ: общая таблица', open: (page) => aside(page, 'Общая таблица') },
  { name: 'ЛЧ: сетка', open: (page) => aside(page, 'Сетка плей-офф') },
  { name: 'ЛЧ: все матчи', open: (page) => aside(page, 'Все матчи') },
  { name: 'ЛЧ: игроки', open: (page) => aside(page, 'Игроки и статистика') },
  {
    name: 'Кубки: обзор',
    open: async (page) => {
      await sportTab(page, 'Кубки');
      await aside(page, 'Обзор');
    },
  },
  { name: 'Кубки: таблица', open: (page) => aside(page, 'Таблица') },
  { name: 'Кубки: сетка', open: (page) => aside(page, 'Сетка плей-офф') },
  { name: 'Кубки: все матчи', open: (page) => aside(page, 'Все матчи') },
  { name: 'Планировщик', open: (page) => aside(page, 'Мой спортивный вечер') },
  { name: 'Дневник', open: (page) => aside(page, 'Дневник просмотра'), noSource: true },
  { name: 'Офлайн-сезоны', open: (page) => aside(page, 'Офлайн-сезоны'), noSource: true },
];

// Повторный запуск с выводом таблицы: SPORTSDESK_AUDIT_VERBOSE=1 npx playwright test e2e/sourceLines.pw.ts
test('every screen shows at most one data-source line and one refresh button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = await setupVisualFixture(page, 'broadcast', 'dark', true);
  await page.goto('/');
  await expect(page.locator('.football-dashboard')).toBeVisible();

  const report: string[] = [];
  const failures: string[] = [];
  async function sample() {
    return page.evaluate(() => {
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.getClientRects().length > 0
        );
      };
      const text = (el: Element) => (el as HTMLElement).innerText.replace(/\s+/gu, ' ').trim();
      const root = document.querySelector('main.content') ?? document.body;
      const lines = Array.from(root.querySelectorAll('.source-foot, .f1-sourcebar')).filter(
        visible,
      );
      const refresh = Array.from(root.querySelectorAll('button')).filter(
        (button) => visible(button) && /^Обнов/u.test(text(button)),
      );
      return { lines: lines.map(text), refresh: refresh.map(text) };
    });
  }
  // Ленивые экраны и ответы приходят не мгновенно: ждём, пока вид перестанет меняться.
  async function settled(needsSource: boolean) {
    let previous = JSON.stringify(await sample());
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await page.waitForTimeout(250);
      const current = JSON.stringify(await sample());
      const waitingForSource = needsSource && JSON.parse(current).lines.length === 0;
      if (current === previous && !waitingForSource)
        return JSON.parse(current) as Awaited<ReturnType<typeof sample>>;
      previous = current;
    }
    return JSON.parse(previous) as Awaited<ReturnType<typeof sample>>;
  }
  async function audit(name: string, noSource = false) {
    const result = await settled(!noSource);
    report.push(`${name}: источников ${result.lines.length}, обновить ${result.refresh.length}`);
    if (process.env.SPORTSDESK_AUDIT_VERBOSE)
      report.push(`   ${JSON.stringify(result.lines)} ${JSON.stringify(result.refresh)}`);
    if (result.lines.length > 1)
      failures.push(`${name}: строк об источнике ${result.lines.length}`);
    if (!noSource && result.lines.length === 0) failures.push(`${name}: нет строки об источнике`);
    for (const line of result.lines)
      if (!/^Данные: (PitchAPI|Powered by SportScore|LiveScore|ESPN|Jolpica|OpenF1)/u.test(line))
        failures.push(`${name}: строка источника в другом виде: «${line}»`);
    if (result.refresh.length > 1)
      failures.push(`${name}: кнопок обновления ${result.refresh.length} (${result.refresh})`);
  }

  for (const screen of screens) {
    await screen.open(page);
    await audit(screen.name, screen.noSource);
  }

  // Матч: каждая вкладка отдельно.
  await sportTab(page, 'Футбол');
  await aside(page, 'Мой обзор');
  await page.locator('.recent-game').first().click();
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  const tabs = page.locator('.md-tabs button');
  const count = await tabs.count();
  for (let index = 0; index < count; index += 1) {
    const label = (await tabs.nth(index).innerText()).trim();
    await tabs.nth(index).click();
    await audit(`Матч · ${label}`);
  }

  if (process.env.SPORTSDESK_AUDIT_VERBOSE) console.log(report.join('\n'));
  expect(failures, report.join('\n')).toEqual([]);
});
