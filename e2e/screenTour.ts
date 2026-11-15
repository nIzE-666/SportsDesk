import { expect, type Page } from '@playwright/test';
import { addMatchDetails, enabled, upcoming } from './matchDetails';
import { setupVisualFixture } from './uiFixture';

/** Where a tour stop lives: the page itself, another page, and the part of it to inspect. */
export type ScreenTourStop = {
  group?: string;
  on?: Page;
  root?: string;
  extra?: string;
  dedupe?: boolean;
};

export type ScreenTourOptions = { scheme: 'dark' | 'light' };

/**
 * Walks every screen state the text audit and the contrast check know about.
 * The callback runs at each stop after the page has settled and receives the
 * stop name and the same options the old text audit passed to its dump.
 */
export async function screenTour(
  page: Page,
  visit: (name: string, stop: ScreenTourStop) => void | Promise<void>,
  options: ScreenTourOptions,
): Promise<void> {
  const rail = (target: Page) => target.getByRole('navigation', { name: 'Разделы' });
  const section = (target: Page, name: string) =>
    rail(target).getByRole('button', { name, exact: true }).click();
  const tab = (target: Page, name: string) =>
    target.locator('.shell-tabs').getByRole('tab', { name, exact: true }).click();
  const competition = async (target: Page, name: string) => {
    await section(target, 'Футбол');
    await target.locator('.competition-switcher-trigger').click();
    await target.getByRole('menuitemradio', { name }).click();
  };
  const openMatch = async (target: Page, id: string) => {
    await section(target, 'Футбол');
    await tab(target, 'Матчи');
    await target.locator(`[data-match-id="${id}"] .mt-open`).first().click();
    await expect(target.locator('.md-score')).toBeVisible();
  };
  const stop = async (name: string, stopOptions: ScreenTourStop = {}) => {
    const target = stopOptions.on ?? page;
    await target.waitForTimeout(900);
    const quiet = await target
      .waitForFunction(
        () => {
          const visible = (element: Element) => {
            const style = getComputedStyle(element);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              element.getClientRects().length > 0
            );
          };
          return !Array.from(document.querySelectorAll('.ui-skeleton, [aria-busy="true"]')).some(
            visible,
          );
        },
        undefined,
        { timeout: 10000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!quiet) console.log(`${name}: still loading after 10 s`);
    await visit(name, stopOptions);
  };

  // The tour visits both themes, so every run starts from the base fixture
  // without the optional match details and with its own theme.
  enabled.finished = false;
  enabled.upcoming = false;
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, options.scheme, true);
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
  await expect(page.locator('.today-view')).toBeVisible();

  await stop('Сегодня');
  const football = ['Матчи', 'Таблица', 'Игроки', 'Клубы'];
  for (const title of football) {
    await section(page, 'Футбол');
    await tab(page, title);
    await stop(title);
  }
  await section(page, 'Футбол');
  await tab(page, 'Матчи');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Матчи' })).toBeVisible();
  await stop('Матчи: меню', { root: '.ui-dialog' });
  await page.keyboard.press('Escape');
  const matchFilter = page.getByRole('radiogroup', { name: 'Фильтр матчей' });
  await matchFilter.getByRole('radio', { name: 'Мои', exact: true }).click();
  await stop('Матчи: мои');
  await matchFilter.getByRole('radio', { name: 'Сейчас идут', exact: true }).click();
  await stop('Матчи: сейчас идут');
  await matchFilter.getByRole('radio', { name: 'Все', exact: true }).click();
  await section(page, 'Футбол');
  await tab(page, 'Клубы');
  await page.locator('.team-favorites').getByRole('button', { name: 'Arsenal' }).click();
  await stop('Клуб: Arsenal');
  await section(page, 'Формула 1');
  for (const title of ['Обзор', 'Календарь', 'Зачёты']) {
    await tab(page, title);
    await stop(`F1: ${title}`);
  }
  await tab(page, 'Анализ');
  const modes = page.getByRole('tablist', { name: 'Режим анализа' });
  for (const title of ['Сравнение пилотов', 'Темп по кругам', 'Центр сессии']) {
    await modes.getByRole('tab', { name: title, exact: true }).click();
    await stop(`F1: ${title}`);
  }
  await competition(page, 'Лига чемпионов');
  for (const title of ['Обзор', 'Таблица', 'Сетка', 'Матчи', 'Игроки']) {
    await tab(page, title);
    await stop(`ЛЧ: ${title}`);
  }
  await competition(page, 'Лига Европы');
  for (const title of ['Обзор', 'Таблица', 'Сетка', 'Матчи']) {
    await tab(page, title);
    await stop(`Кубки: ${title}`);
  }
  await section(page, 'Сегодня');
  await tab(page, 'Мой план');
  await stop('Планировщик');
  await section(page, 'Моё');
  await tab(page, 'Дневник');
  await stop('Дневник');
  await section(page, 'Настройки');
  await page
    .getByRole('navigation', { name: 'Категории настроек' })
    .getByRole('button', { name: 'Данные', exact: true })
    .click();
  await stop('Офлайн-сезоны');
  await section(page, 'Моё');
  await tab(page, 'Игры и прогнозы');
  await stop('Игры');
  await section(page, 'Смотреть');
  await stop('Смотреть');
  await rail(page).getByRole('button', { name: 'События', exact: true }).click();
  await stop('Центр событий', { root: '.events-drawer' });
  await rail(page).getByRole('button', { name: 'Настройки', exact: true }).click();
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
    await stop(`Настройки: ${category}`);
  }

  // Вкладки матча. Завершённый матч: сначала с тем, что отдаёт базовый ответ (составы и статистика без игроков),
  // потом с подробностями (оценки, сравнение игроков, события, удары с xG), потом матч, который ещё не начался.
  async function matchTabs(group: string) {
    const tabs = page.getByRole('tablist', { name: 'Разделы матча' }).getByRole('tab');
    const count = await tabs.count();
    for (let index = 0; index < count; index += 1) {
      const label = (await tabs.nth(index).innerText()).trim();
      await tabs.nth(index).click();
      await stop(label, { group, dedupe: true });
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
    await expect(page.locator('.today-view')).toBeVisible();
    await openMatch(page, 'test-match');
    await expect(page.locator('.md-score')).toContainText('2 : 1');
  }
  await openFinishedMatch();
  await matchTabs('Матч (ответ без подробностей)');

  // С подробностями: игроки с оценками, события, удары с xG.
  enabled.finished = true;
  await openFinishedMatch();
  await page.getByRole('tab', { name: 'Составы', exact: true }).click();
  await expect(page.locator('.player-card').first()).toBeVisible();
  await page.locator('.player-card').first().click();
  await stop('Составы: профиль игрока', { group: 'Матч (с подробностями)', dedupe: true });
  await page.getByRole('button', { name: 'К игрокам' }).click();
  const compare = page.locator('.compare-selects');
  await compare.getByLabel('Первый игрок').fill('Alex');
  await compare.getByRole('option', { name: /Alex Morgan/ }).click();
  await compare.getByLabel('Второй игрок').fill('Jamie');
  await compare.getByRole('option', { name: /Jamie Wilson/ }).click();
  await stop('Сравнение двух игроков', { group: 'Матч (с подробностями)', dedupe: true });
  await matchTabs('Матч (с подробностями)');
  await page.getByRole('tab', { name: 'Составы', exact: true }).click();
  await page.getByRole('button', { name: 'На доску' }).click();
  await page.getByRole('button', { name: 'Создать из состава' }).click();
  await stop('Мои схемы: редактор схемы', { group: 'Матч (с подробностями)', dedupe: true });
  await page.getByRole('tab', { name: 'Обзор', exact: true }).click();
  await page.getByRole('button', { name: 'Просмотрено' }).click();
  await stop('Форма записи о просмотре', { group: 'Матч (с подробностями)', dedupe: true });

  enabled.upcoming = true;
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await openMatch(page, upcoming.id);
  await expect(page.locator('.md-score')).toBeVisible();
  const prediction = page.getByRole('button', { name: /Мой прогноз/u });
  if (await prediction.count()) await prediction.click();
  await matchTabs('Матч (ещё не начался)');

  // Мастер первого запуска открывается вручную, как из настроек.
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('sportsdesk-open-onboarding')));
  const wizard = '[role="dialog"].onboarding-card';
  for (let step = 1; step <= 8; step += 1) {
    await expect(page.locator(wizard).locator('.eyebrow')).toContainText(`ШАГ ${step} ИЗ 8`);
    await stop(`Шаг ${step}`, { group: 'Мастер первого запуска', root: wizard });
    if (step < 8)
      await page
        .locator(wizard)
        .getByRole('button', { name: step === 1 ? 'Начать' : 'Далее', exact: true })
        .click();
  }

  // Мини-окно: отдельная страница #mini; тестовые данные дают пустое состояние без матчей.
  const mini = await page.context().newPage();
  await mini.setViewportSize({ width: 360, height: 520 });
  await setupVisualFixture(mini, options.scheme, true);
  await mini.goto('/#mini');
  await expect(mini.locator('.mini-root')).toBeVisible();
  await stop('Мини-окно без матчей', {
    group: 'Мини-окно',
    on: mini,
    root: '.mini-root',
    extra: '.mini-empty span',
  });
  await mini.close();
}
