import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';
import { mockWatchAccount, seedWatchPreferences } from './watchFixture';

/**
 * Accessibility guard of the five-section frame (U3.5).
 *
 * axe is not installed on purpose: the checks below use page.evaluate and
 * Playwright locators. Every failure names the screen and the element, so a
 * later step can find what it broke.
 */

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

type Inspection = {
  headings: { level: number; text: string }[];
  rail: { found: boolean; label: string; current: number; tabs: number };
  unnamed: string[];
  weakNames: string[];
  images: string[];
  positiveTabindex: string[];
  duplicateIds: string[];
  tabStrips: string[];
};

type AuditOptions = {
  /** Focus must stay inside this selector while it is open. */
  trap?: string;
};

async function inspect(page: Page): Promise<Inspection> {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
      if (element.closest('[hidden], [aria-hidden="true"]')) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
        return false;
      return element.getClientRects().length > 0;
    };
    const text = (element: Element) =>
      ((element as HTMLElement).innerText ?? element.textContent ?? '')
        .replace(/\s+/gu, ' ')
        .trim();
    const describe = (element: Element) => {
      const classes = (element.getAttribute('class') ?? '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
        .slice(0, 2)
        .map((name) => `.${name}`)
        .join('');
      const id = element.id ? `#${element.id}` : '';
      const label = text(element).slice(0, 70);
      return `<${element.tagName.toLowerCase()}${id}${classes}>${label ? ` «${label}»` : ''}`;
    };

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(visible)
      .map((heading) => ({
        level: Number(heading.tagName.slice(1)),
        text: text(heading).slice(0, 70),
      }));

    const rails = Array.from(document.querySelectorAll('.nav-rail nav'));
    const railElement = rails[0];
    const railInfo = {
      found: !!railElement,
      label: railElement?.getAttribute('aria-label')?.trim() ?? '',
      current: railElement ? railElement.querySelectorAll('[aria-current="page"]').length : 0,
      tabs: railElement ? railElement.querySelectorAll('[role="tab"]').length : 0,
    };

    const interactiveSelector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="option"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="combobox"]',
    ].join(',');
    const nameOf = (element: Element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const named = labelledBy
          .split(/\s+/u)
          .map((id) => text(document.getElementById(id) ?? element))
          .join(' ')
          .trim();
        if (named) return { name: named, weak: false };
      }
      const aria = element.getAttribute('aria-label')?.trim();
      if (aria) return { name: aria, weak: false };
      if (element instanceof HTMLInputElement) {
        if (['submit', 'button', 'reset'].includes(element.type))
          return { name: element.value.trim(), weak: false };
        if (element.type === 'image') return { name: element.alt.trim(), weak: false };
      }
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        const labelled = Array.from(element.labels ?? [])
          .map(text)
          .join(' ')
          .trim();
        if (labelled) return { name: labelled, weak: false };
      }
      if (element instanceof HTMLImageElement && element.alt.trim())
        return { name: element.alt.trim(), weak: false };
      const content = text(element);
      if (content) return { name: content, weak: false };
      const title = element.getAttribute('title')?.trim();
      if (title) return { name: title, weak: true };
      return { name: '', weak: false };
    };

    const unnamed: string[] = [];
    const weakNames: string[] = [];
    for (const element of Array.from(document.querySelectorAll(interactiveSelector))) {
      if (!visible(element) || element.closest('[aria-hidden="true"]')) continue;
      const { name, weak } = nameOf(element);
      if (!name) unnamed.push(describe(element));
      else if (weak) weakNames.push(describe(element));
    }

    const images = Array.from(document.querySelectorAll('img'))
      .filter((image) => !image.hasAttribute('alt'))
      .map(describe);

    const positiveTabindex = Array.from(document.querySelectorAll('[tabindex]'))
      .filter((element) => Number(element.getAttribute('tabindex')) > 0)
      .map(describe);

    const ids = new Map<string, number>();
    for (const element of Array.from(document.querySelectorAll('[id]')))
      ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    const duplicateIds = Array.from(ids)
      .filter(([, count]) => count > 1)
      .map(([id, count]) => `#${id} × ${count}`);

    // The header strips are real tabs: one selected tab, a controlled panel and one tab stop.
    const tabStrips: string[] = [];
    for (const strip of Array.from(document.querySelectorAll('.shell-tabs [role="tablist"]'))) {
      const list = strip as HTMLElement;
      const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
      const selected = tabs.filter((element) => element.getAttribute('aria-selected') === 'true');
      if (selected.length !== 1)
        tabStrips.push(`a header tab strip has ${selected.length} selected tabs`);
      if (tabs.filter((element) => element.getAttribute('tabindex') === '0').length !== 1)
        tabStrips.push('a header tab strip does not have exactly one tab stop');
      for (const element of tabs) {
        const controls = element.getAttribute('aria-controls');
        if (!controls || !document.getElementById(controls))
          tabStrips.push(`the tab «${text(element)}» does not control an existing panel`);
      }
    }

    return {
      headings,
      rail: railInfo,
      unnamed: Array.from(new Set(unnamed)),
      weakNames: Array.from(new Set(weakNames)),
      images: Array.from(new Set(images)),
      positiveTabindex,
      duplicateIds,
      tabStrips: Array.from(new Set(tabStrips)),
    };
  });
}

async function focusWalk(
  page: Page,
  screen: string,
  failures: string[],
  trap?: string,
): Promise<void> {
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press('Tab');
    const step = await page.evaluate((trapSelector) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body)
        return { missing: true, ring: false, inside: false, element: 'document.body' };
      const classes = (active.getAttribute('class') ?? '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
        .slice(0, 2)
        .map((name) => `.${name}`)
        .join('');
      const element = `<${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}${classes}>`;
      const style = getComputedStyle(active);
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 1.5;
      const shadow = style.boxShadow !== 'none';
      const inside = trapSelector ? !!active.closest(trapSelector) : true;
      return { missing: false, ring: outline || shadow, inside, element };
    }, trap);
    if (step.missing) {
      if (trap)
        failures.push(
          `${screen}: Tab ${index + 1} leaves the open dialog (focused element missing)`,
        );
      return;
    }
    if (!step.ring) failures.push(`${screen}: no focus ring on ${step.element} (Tab ${index + 1})`);
    if (!step.inside)
      failures.push(
        `${screen}: focus leaves the open dialog on ${step.element} (Tab ${index + 1})`,
      );
  }
}

async function audit(
  page: Page,
  screen: string,
  failures: string[],
  options: AuditOptions = {},
): Promise<void> {
  const result = await inspect(page);
  const h1 = result.headings.filter((heading) => heading.level === 1);
  if (h1.length !== 1)
    failures.push(
      `${screen}: ${h1.length} h1 (${h1.map((heading) => `«${heading.text}»`).join(', ') || 'none'})`,
    );
  let previous = 0;
  for (const heading of result.headings) {
    if (previous && heading.level > previous + 1)
      failures.push(
        `${screen}: heading level jumps from h${previous} to h${heading.level} at «${heading.text}»`,
      );
    previous = heading.level;
  }
  if (!result.rail.found) failures.push(`${screen}: no nav inside the rail`);
  else {
    if (!/[А-Яа-яЁё]/u.test(result.rail.label))
      failures.push(`${screen}: the rail nav has no Russian aria-label («${result.rail.label}»)`);
    if (result.rail.current !== 1)
      failures.push(`${screen}: the rail has ${result.rail.current} aria-current="page" items`);
    if (result.rail.tabs !== 0)
      failures.push(`${screen}: the rail still uses ${result.rail.tabs} role="tab" items`);
  }
  for (const element of result.unnamed)
    failures.push(`${screen}: no accessible name for ${element}`);
  for (const element of result.weakNames)
    failures.push(`${screen}: only a title names ${element}; add aria-label or visible text`);
  for (const element of result.images) failures.push(`${screen}: img without alt: ${element}`);
  for (const element of result.positiveTabindex)
    failures.push(`${screen}: positive tabindex on ${element}`);
  for (const id of result.duplicateIds) failures.push(`${screen}: duplicate id ${id}`);
  for (const strip of result.tabStrips) failures.push(`${screen}: ${strip}`);
  await focusWalk(page, screen, failures, options.trap);
}

async function settle(page: Page, selector?: string): Promise<void> {
  if (selector) await page.locator(selector).first().waitFor({ state: 'visible' });
  await page.waitForTimeout(450);
}

async function mouseFocus(page: Page, screen: string, failures: string[]): Promise<void> {
  await section(page, 'Формула 1');
  await settle(page);
  const button = rail(page).getByRole('button', { name: 'Сегодня', exact: true });
  await button.click();
  const result = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return { focusVisible: false, outline: 'none' };
    return {
      focusVisible: active.matches(':focus-visible'),
      outline: getComputedStyle(active).outlineStyle,
    };
  });
  if (result.focusVisible || result.outline !== 'none')
    failures.push(`${screen}: a mouse click shows a keyboard focus ring on «Сегодня»`);
}

test('key screens have one h1, a named rail, named controls and a focus ring', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await settle(page, '.today-view');
  const failures: string[] = [];

  const screen = async (name: string, selector?: string, options?: AuditOptions) => {
    await settle(page, selector);
    await audit(page, name, failures, options);
  };

  // «Сегодня», each mode.
  await screen('Сегодня · сегодня', '.today-view');
  await tab(page, 'Неделя');
  await screen('Сегодня · неделя', '.today-view');
  await tab(page, 'Мой план');
  await screen('Сегодня · мой план', '.planner-hero');

  // A league: each header tab, then the club page opened from the picker.
  await section(page, 'Футбол');
  await tab(page, 'Матчи');
  await screen('Футбол · матчи', '.matches-view');
  const matchFilter = page.getByRole('radiogroup', { name: 'Фильтр матчей' });
  await matchFilter.getByRole('radio', { name: 'Мои', exact: true }).click();
  await screen('Футбол · матчи · мои', '.matches-view');
  await matchFilter.getByRole('radio', { name: 'Сейчас идут', exact: true }).click();
  await screen('Футбол · матчи · сейчас идут', '.live-panel');
  const liveFilter = page.getByRole('radiogroup', { name: 'Фильтр ленты' });
  await liveFilter.getByRole('radio', { name: /^Live/ }).click();
  await screen('Футбол · матчи · сейчас идут · Live', '.live-panel');
  await liveFilter.getByRole('radio', { name: /^Все/ }).click();
  await matchFilter.getByRole('radio', { name: 'Все', exact: true }).click();
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await screen('Футбол · матчи · меню', '.ui-dialog', { trap: '.ui-dialog' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Матчи' })).toHaveCount(0);
  await tab(page, 'Таблица');
  await screen('Футбол · таблица', '.standings-view');
  await tab(page, 'Игроки');
  await screen('Футбол · игроки', '.players-view');
  await tab(page, 'Клубы');
  await screen('Футбол · клубы', '.team-view');
  const club = page.getByRole('combobox', { name: 'Клуб', exact: true });
  if (await club.count()) {
    await club.click();
    await club.fill('Arsenal');
    const option = page.getByRole('option', { name: 'Arsenal', exact: true });
    if (await option.count()) await option.first().click();
  }
  await screen('Клуб', '.team-view');
  for (const name of ['Обзор', 'Матчи', 'Состав', 'Личные встречи']) {
    await page
      .getByRole('tablist', { name: 'Разделы клуба' })
      .getByRole('tab', { name, exact: true })
      .click();
    await screen(`Клуб · ${name}`, '.team-view');
  }

  // Champions League and a cup: each tab.
  await competition(page, 'Лига чемпионов');
  for (const name of ['Матчи', 'Таблица', 'Сетка', 'Клубы', 'Игроки']) {
    await tab(page, name);
    await screen(`Лига чемпионов · ${name}`, '.ucl-view');
  }
  await competition(page, 'Лига Европы');
  for (const name of ['Матчи', 'Таблица', 'Сетка']) {
    await tab(page, name);
    await screen(`Лига Европы · ${name}`, '.ucl-view');
  }
  // A cup without a table has no «Таблица» tab.
  await competition(page, 'Чемпионат мира');
  await screen('Чемпионат мира · Матчи', '.ucl-view');

  // Formula 1: each header tab and each analysis mode.
  await section(page, 'Формула 1');
  for (const name of ['Обзор', 'Календарь', 'Зачёты']) {
    await tab(page, name);
    await screen(`Формула 1 · ${name}`, '.f1-root');
  }
  await tab(page, 'Анализ');
  await screen('Формула 1 · анализ', '.f1-analysis');
  for (const name of ['Сравнение пилотов', 'Темп по кругам', 'Центр сессии']) {
    await page.getByRole('tablist', { name: 'Режим анализа' }).getByRole('tab', { name }).click();
    await screen(`Формула 1 · анализ · ${name}`, '.f1-analysis');
  }

  const watchSignedOut = await mockWatchAccount(page, false);
  await section(page, 'Смотреть');
  await screen('Смотреть', '.watch-root');
  await page.getByRole('button', { name: 'Подключить устройство' }).click();
  await screen('Смотреть · подключение', '.ui-dialog', { trap: '.ui-dialog' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute('**/bridge/command', watchSignedOut);

  await section(page, 'Моё');
  for (const [name, selector] of [
    ['Избранное', '.my-view'],
    ['Дневник', '.diary-view'],
    ['Игры и прогнозы', '.games-view'],
    ['Схемы', '.my-schemes, .my-view'],
  ] as const) {
    await tab(page, name);
    await screen(`Моё · ${name}`, selector);
  }

  // Every settings category.
  await section(page, 'Настройки');
  const categories = page.getByRole('navigation', { name: 'Категории настроек' });
  const categoryNames = await categories.locator('button').allInnerTexts();
  for (const name of categoryNames.map((value) => value.trim()).filter(Boolean)) {
    await categories.getByRole('button', { name, exact: true }).click();
    await screen(`Настройки · ${name}`, '.settings-view');
  }

  await mouseFocus(page, 'Мышь', failures);
  expect(failures, failures.join('\n')).toEqual([]);
});

test('a match page passes on every tab', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await settle(page, '.today-view');
  const failures: string[] = [];
  await section(page, 'Футбол');
  await tab(page, 'Матчи');
  await page.locator('[data-match-id="test-match"] .mt-open').first().click();
  await expect(page.getByRole('tablist', { name: 'Разделы матча' })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Разделы матча' }).getByRole('tab');
  const count = await tabs.count();
  for (let index = 0; index < count; index += 1) {
    const label = (await tabs.nth(index).innerText()).trim();
    await tabs.nth(index).click();
    await settle(page);
    await audit(page, `Матч · ${label}`, failures);
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

test('the setup wizard dialog keeps focus inside and names its kit controls', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await settle(page, '.today-view');
  const failures: string[] = [];

  await page.evaluate(() => window.dispatchEvent(new Event('sportsdesk-open-onboarding')));
  const wizard = page.locator('[role="dialog"].onboarding-card');
  await expect(wizard).toBeVisible();
  await settle(page);
  await audit(page, 'Мастер настройки · шаг 1', failures, { trap: '.onboarding-card' });

  await wizard.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(wizard.locator('.eyebrow')).toContainText('ШАГ 2 ИЗ 8');
  await settle(page);
  await audit(page, 'Мастер настройки · шаг 2', failures, { trap: '.onboarding-card' });

  await page.keyboard.press('Escape');
  await expect(wizard).toHaveCount(0);
  expect(failures, failures.join('\n')).toEqual([]);
});

test('the events drawer and the search dialog keep focus, close on Escape and return it', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await settle(page, '.today-view');
  const failures: string[] = [];

  // Ctrl+K opens the search; Escape closes it.
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Поиск' });
  await expect(search).toBeVisible();
  await settle(page);
  await audit(page, 'Поиск', failures, { trap: '.command-dialog' });
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
  failures.push(
    ...(await page.evaluate(() =>
      document.querySelector('[aria-modal="true"]')
        ? ['Поиск: Escape did not close the dialog']
        : [],
    )),
  );

  // Opening by click returns focus to the search button.
  const searchButton = page.getByRole('button', { name: 'Поиск · Ctrl+K' });
  await searchButton.click();
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(searchButton).toBeFocused();

  // The events drawer traps focus, closes on Escape and returns it to the bell.
  const bell = rail(page).getByRole('button', { name: 'События', exact: true });
  await bell.click();
  const drawer = page.getByRole('dialog', { name: 'События' });
  await expect(drawer).toBeVisible();
  await settle(page);
  await audit(page, 'События', failures, { trap: '.events-drawer' });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(bell).toBeFocused();

  // Header tabs behave as tabs: the arrow key moves selection and focus.
  await section(page, 'Сегодня');
  await tab(page, 'Сегодня');
  const todayTab = page.locator('.shell-tabs').getByRole('tab', { name: 'Сегодня', exact: true });
  await todayTab.focus();
  await page.keyboard.press('ArrowRight');
  const weekTab = page.locator('.shell-tabs').getByRole('tab', { name: 'Неделя', exact: true });
  await expect(weekTab).toHaveAttribute('aria-selected', 'true');
  await expect(weekTab).toBeFocused();
  await expect(weekTab).toHaveAttribute('aria-controls', 'shell-page-panel');

  // Alt+← and Alt+→ move through history.
  await section(page, 'Футбол');
  await section(page, 'Формула 1');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('heading', { name: 'Premier League', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByRole('heading', { name: 'Формула 1', exact: true })).toBeVisible();

  expect(failures, failures.join('\n')).toEqual([]);
});

test('the signed-in watch catalog, player and logout dialog pass', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await seedWatchPreferences(page);
  const watch = await mockWatchAccount(page, true);
  await page.goto('/');
  await settle(page, '.today-view');
  const failures: string[] = [];
  const screen = async (name: string, selector?: string, options?: AuditOptions) => {
    await settle(page, selector);
    await audit(page, name, failures, options);
  };

  await section(page, 'Смотреть');
  await screen('Смотреть · каталог', '.watch-root');
  await page.getByRole('button', { name: 'Список каналов', exact: true }).click();
  await screen('Смотреть · каталог списком', '.watch-root');
  await page
    .locator('.watch-catalog--list')
    .getByRole('button', { name: 'OKKO Football', exact: true })
    .click();
  await screen('Смотреть · плеер', '.watch-player-shell');
  await page.locator('.watch-topbar').getByRole('button', { name: 'Выйти', exact: true }).click();
  await screen('Смотреть · выход', '.ui-dialog', { trap: '.ui-dialog' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute('**/bridge/command', watch);

  expect(failures, failures.join('\n')).toEqual([]);
});
