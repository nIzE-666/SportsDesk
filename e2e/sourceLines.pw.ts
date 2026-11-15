import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

type Screen = {
  name: string;
  open: (page: Page) => Promise<void>;
  /** Экран без загруженных данных (дневник, офлайн-библиотека, выбор клуба) источника не показывает. */
  noSource?: boolean;
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Разделы' });
const section = (page: Page, name: string) =>
  rail(page).getByRole('button', { name, exact: true }).click();
const tab = (page: Page, name: string) =>
  page.locator('.shell-tabs').getByRole('tab', { name, exact: true }).click();
const competition = async (page: Page, name: string) => {
  await section(page, 'Футбол');
  await page.locator('.competition-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name }).click();
};

const screens: Screen[] = [
  { name: 'Сегодня', open: async (page) => section(page, 'Сегодня') },
  {
    name: 'Матчи',
    open: async (page) => {
      await section(page, 'Футбол');
      await tab(page, 'Матчи');
    },
  },
  {
    name: 'Таблица',
    open: async (page) => {
      await section(page, 'Футбол');
      await tab(page, 'Таблица');
    },
  },
  {
    name: 'Сейчас идут',
    open: async (page) => {
      await section(page, 'Футбол');
      await tab(page, 'Сейчас идут');
    },
  },
  {
    name: 'Игроки',
    open: async (page) => {
      await section(page, 'Футбол');
      await tab(page, 'Игроки');
    },
  },
  {
    name: 'Клубы',
    open: async (page) => {
      await section(page, 'Футбол');
      await tab(page, 'Клубы');
    },
    noSource: true,
  },
  {
    name: 'Обзор Формулы 1',
    open: async (page) => {
      await section(page, 'Формула 1');
      await tab(page, 'Обзор');
    },
  },
  {
    name: 'Календарь F1',
    open: async (page) => {
      await section(page, 'Формула 1');
      await tab(page, 'Календарь');
    },
  },
  {
    name: 'Зачёты',
    open: async (page) => {
      await section(page, 'Формула 1');
      await tab(page, 'Зачёты');
    },
  },
  {
    // В тестовых данных нет результатов гонок: экран показывает пустое состояние без источника.
    name: 'Сравнение пилотов',
    open: async (page) => {
      await section(page, 'Формула 1');
      await tab(page, 'Анализ');
      await page
        .getByRole('tablist', { name: 'Режим анализа' })
        .getByRole('tab', { name: 'Сравнение пилотов', exact: true })
        .click();
    },
    noSource: true,
  },
  {
    name: 'Темп по кругам',
    open: async (page) => {
      await section(page, 'Формула 1');
      await tab(page, 'Анализ');
      await page
        .getByRole('tablist', { name: 'Режим анализа' })
        .getByRole('tab', { name: 'Темп по кругам', exact: true })
        .click();
    },
  },
  {
    name: 'Центр сессии',
    open: async (page) => {
      await section(page, 'Формула 1');
      await tab(page, 'Анализ');
      await page
        .getByRole('tablist', { name: 'Режим анализа' })
        .getByRole('tab', { name: 'Центр сессии', exact: true })
        .click();
    },
  },
  {
    name: 'ЛЧ: европейский вечер',
    open: async (page) => {
      await competition(page, 'Лига чемпионов');
      await tab(page, 'Обзор');
    },
  },
  {
    name: 'ЛЧ: общая таблица',
    open: async (page) => {
      await competition(page, 'Лига чемпионов');
      await tab(page, 'Таблица');
    },
  },
  {
    name: 'ЛЧ: сетка',
    open: async (page) => {
      await competition(page, 'Лига чемпионов');
      await tab(page, 'Сетка');
    },
  },
  {
    name: 'ЛЧ: все матчи',
    open: async (page) => {
      await competition(page, 'Лига чемпионов');
      await tab(page, 'Матчи');
    },
  },
  {
    name: 'ЛЧ: игроки',
    open: async (page) => {
      await competition(page, 'Лига чемпионов');
      await tab(page, 'Игроки');
    },
  },
  {
    name: 'Кубки: обзор',
    open: async (page) => {
      await competition(page, 'Лига Европы');
      await tab(page, 'Обзор');
    },
  },
  {
    name: 'Кубки: таблица',
    open: async (page) => {
      await competition(page, 'Лига Европы');
      await tab(page, 'Таблица');
    },
  },
  {
    name: 'Кубки: сетка',
    open: async (page) => {
      await competition(page, 'Лига Европы');
      await tab(page, 'Сетка');
    },
  },
  {
    name: 'Кубки: все матчи',
    open: async (page) => {
      await competition(page, 'Лига Европы');
      await tab(page, 'Матчи');
    },
  },
  {
    name: 'Планировщик',
    open: async (page) => {
      await section(page, 'Сегодня');
      await tab(page, 'Мой план');
    },
  },
  {
    name: 'Дневник',
    open: async (page) => {
      await section(page, 'Моё');
      await tab(page, 'Дневник');
    },
    noSource: true,
  },
  {
    name: 'Офлайн-сезоны',
    open: async (page) => {
      await section(page, 'Настройки');
      await page
        .getByRole('navigation', { name: 'Категории настроек' })
        .getByRole('button', { name: 'Данные', exact: true })
        .click();
    },
    noSource: true,
  },
];

// Повторный запуск с выводом таблицы: SPORTSDESK_AUDIT_VERBOSE=1 npx playwright test e2e/sourceLines.pw.ts
test('every screen shows at most one data-source line and one refresh button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();

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
  await competition(page, 'Premier League');
  await tab(page, 'Матчи');
  await page.locator('[data-match-id="test-match"] .mt-open').first().click();
  await expect(page.getByRole('tablist', { name: 'Разделы матча' })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Разделы матча' }).getByRole('tab');
  const count = await tabs.count();
  for (let index = 0; index < count; index += 1) {
    const label = (await tabs.nth(index).innerText()).trim();
    await tabs.nth(index).click();
    await audit(`Матч · ${label}`);
  }

  if (process.env.SPORTSDESK_AUDIT_VERBOSE) console.log(report.join('\n'));
  expect(failures, report.join('\n')).toEqual([]);
});
