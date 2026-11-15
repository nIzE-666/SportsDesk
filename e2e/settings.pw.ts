import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

const CATEGORIES = [
  ['general', 'Основное'],
  ['favorites', 'Избранное'],
  ['notifications', 'Уведомления'],
  ['appearance', 'Внешний вид'],
  ['modules', 'Модули'],
  ['watch', 'Просмотр'],
  ['data', 'Данные'],
  ['sources', 'Источники'],
  ['about', 'О программе'],
] as const;

const rail = (page: Page) => page.getByRole('navigation', { name: 'Разделы' });
const settingsNav = (page: Page) => page.getByRole('navigation', { name: 'Категории настроек' });
const category = (page: Page, label: string) =>
  settingsNav(page).getByRole('button', { name: label, exact: true });

async function seedFavorites(page: Page) {
  await page.addInitScript(() => {
    const teams = [
      { id: 'arsenal', name: 'Arsenal', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
      { id: 'chelsea', name: 'Chelsea', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
    ];
    localStorage.setItem(
      'sportsdesk.football.favorites.teams',
      JSON.stringify({ ids: teams.map((team) => team.id) }),
    );
    localStorage.setItem('sportsdesk.football.catalogue', JSON.stringify(teams));
  });
}

async function openSettings(page: Page) {
  await setupVisualFixture(page, 'dark', true);
  await seedFavorites(page);
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();
  await rail(page).getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.locator('.settings-view')).toBeVisible();
}

async function openWizard(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('sportsdesk-open-onboarding')));
  const wizard = page.locator('[role="dialog"].onboarding-card');
  await expect(wizard).toBeVisible();
  return wizard;
}

test('no settings category is longer than one and a half screens and each has one main action', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSettings(page);

  const heights: Record<string, { content: number; category: number; oneAndHalf: number }> = {};
  for (const [id, label] of CATEGORIES) {
    await category(page, label).click();
    await page.waitForTimeout(250);
    const measured = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('main.content')!;
      const panel = document.querySelector<HTMLElement>('.settings-category')!;
      const nav = document.querySelector<HTMLElement>('.settings-categories')!;
      const navBox = nav.getBoundingClientRect();
      const contentBox = content.getBoundingClientRect();
      return {
        content: content.scrollHeight,
        category: panel.scrollHeight,
        oneAndHalf: content.clientHeight * 1.5,
        primaryButtons: content.querySelectorAll('.ui-button--primary').length,
        overflow: content.scrollWidth > content.clientWidth + 1,
        navVisible: navBox.top >= contentBox.top - 1 && navBox.bottom <= contentBox.bottom + 1,
      };
    });
    expect(measured.overflow, `${label}: horizontal overflow`).toBe(false);
    expect(measured.navVisible, `${label}: category list is not visible without scrolling`).toBe(
      true,
    );
    expect(measured.primaryButtons, `${label}: more than one primary button`).toBeLessThanOrEqual(
      1,
    );
    expect(measured.category, `${label}: longer than one and a half screens`).toBeLessThanOrEqual(
      measured.oneAndHalf + 1,
    );
    expect(measured.content, `${label}: page is longer than two screens`).toBeLessThanOrEqual(1800);
    // Picks the pattern for every control: a field or a switch, never a bare box.
    const bareControls = await page.evaluate(() => {
      const allowed = (element: Element) =>
        !!element.closest('.ui-field__control') ||
        !!element.closest('.ui-switch') ||
        !!element.closest('.ui-disclosure');
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          '.settings-category input:not([type="hidden"]), .settings-category select, .settings-category textarea',
        ),
      )
        .filter(
          (element) =>
            element.getClientRects().length > 0 &&
            !(element instanceof HTMLInputElement && element.type === 'file'),
        )
        .filter((element) => !allowed(element))
        .map((element) => `${element.tagName.toLowerCase()}#${element.id || '—'}`);
    });
    expect(bareControls, `${label}: a bare control`).toEqual([]);
    heights[id] = {
      content: measured.content,
      category: measured.category,
      oneAndHalf: measured.oneAndHalf,
    };
  }

  // A disabled primary action is neutral and does not look like a real one.
  await category(page, 'Просмотр').click();
  const login = page.getByRole('button', { name: 'Войти по коду устройства', exact: true });
  await expect(login).toBeDisabled();
  const disabledColors = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.app-root')!;
    const probe = document.createElement('span');
    root.append(probe);
    probe.style.background = 'var(--color-surface-2)';
    const surface2 = getComputedStyle(probe).backgroundColor;
    probe.style.background = '';
    probe.style.color = 'var(--color-text-tertiary)';
    const tertiary = getComputedStyle(probe).color;
    probe.remove();
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent?.trim() === 'Войти по коду устройства',
    )!;
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      color: style.color,
      opacity: style.opacity,
      surface2,
      tertiary,
    };
  });
  expect(disabledColors.background).toBe(disabledColors.surface2);
  expect(disabledColors.color).toBe(disabledColors.tertiary);
  expect(disabledColors.opacity).toBe('1');

  // The source picker says that one source means no fallback, and the note stays in view.
  await category(page, 'Источники').click();
  await expect(page.getByRole('radio', { name: 'Только LiveScore', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Только ESPN', exact: true })).toBeVisible();
  await expect(page.locator('.settings-category')).toContainText('Авто: LiveScore, при сбое ESPN.');
  await expect(page.locator('.settings-category')).toContainText(
    'неофициальные бесплатные источники',
  );

  // The long parts stay folded until asked for, and open in place.
  await category(page, 'Уведомления').click();
  const clubs = page.locator('.notification-preferences .ui-disclosure__trigger');
  await expect(clubs).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.settings-team')).toHaveCount(0);
  await clubs.click();
  await expect(clubs).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.settings-team')).toHaveCount(2);

  await category(page, 'Данные').click();
  const offline = page.locator('.settings-offline .ui-disclosure__trigger');
  await expect(offline).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.offline-view')).toHaveCount(0);
  await offline.click();
  await expect(offline).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.offline-view')).toBeVisible();

  // Keep the measured numbers in the Playwright output for the report.
  console.log('settings heights', JSON.stringify(heights));
});

test('the setup wizard is one kit dialog with kit controls on every step', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();
  const wizard = await openWizard(page);
  await expect(wizard).toHaveClass(/ui-dialog/);

  for (let step = 1; step <= 8; step += 1) {
    await expect(wizard.locator('.eyebrow')).toContainText(`ШАГ ${step} ИЗ 8`);
    await expect(wizard.locator('.ui-button--primary')).toHaveCount(1);
    const bareControls = await wizard.evaluate((dialog) =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea'),
      )
        .filter((element) => element.getClientRects().length > 0)
        .filter(
          (element) => !element.closest('.ui-field__control') && !element.closest('.ui-switch'),
        )
        .map((element) => `${element.tagName.toLowerCase()}#${element.id || '—'}`),
    );
    expect(bareControls, `step ${step}`).toEqual([]);
    if (step < 8)
      await wizard
        .getByRole('button', { name: step === 1 ? 'Начать' : 'Далее', exact: true })
        .click();
  }

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the source picker fits at 1100 × 720 and keeps the fallback note in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();
  await rail(page).getByRole('button', { name: 'Настройки', exact: true }).click();
  await category(page, 'Источники').click();
  const sources = page.getByRole('radiogroup', { name: 'Источник живых матчей' });
  await expect(sources.getByRole('radio', { name: 'Только LiveScore', exact: true })).toBeVisible();
  await expect(sources.getByRole('radio', { name: 'Только ESPN', exact: true })).toBeVisible();
  expect(await sources.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  expect(
    await page
      .locator('main.content')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await expect(page.locator('.settings-category')).toContainText('Авто: LiveScore, при сбое ESPN.');
  await expect(page.locator('.settings-category')).toContainText(
    'неофициальные бесплатные источники',
  );
});

test('dependent notification switches look off while the master is off and keep their values', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSettings(page);

  const switchInput = (text: string) =>
    page.locator('.ui-switch').filter({ hasText: text }).first().locator('input');
  const visitNotifications = async () => {
    await rail(page).getByRole('button', { name: 'Настройки', exact: true }).click();
    await category(page, 'Уведомления').click();
    await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toBeVisible();
  };

  await visitNotifications();
  await expect(switchInput('Уведомления')).not.toBeChecked();
  await expect(switchInput('Напоминать о сессиях Формулы-1')).toBeChecked();
  await expect(switchInput('Напоминать о сессиях Формулы-1')).toBeDisabled();
  for (const event of ['Голы и изменения счёта', 'Начало матча', 'Итог матча', 'Напоминания'])
    await expect(switchInput(event)).toBeDisabled();

  // The saved values are still there when the master comes back on.
  await page.evaluate(() => localStorage.setItem('sportsdesk.notifications.enabled', '1'));
  await page.reload();
  await visitNotifications();
  await expect(switchInput('Уведомления')).toBeChecked();
  await expect(switchInput('Напоминать о сессиях Формулы-1')).toBeChecked();
  await expect(switchInput('Напоминать о сессиях Формулы-1')).toBeEnabled();
  for (const event of ['Голы и изменения счёта', 'Начало матча', 'Итог матча', 'Напоминания']) {
    await expect(switchInput(event)).toBeChecked();
    await expect(switchInput(event)).toBeEnabled();
  }

  // The setup wizard has the same dependent switch.
  await page.evaluate(() => localStorage.setItem('sportsdesk.notifications.enabled', '0'));
  await page.reload();
  let wizard = await openWizard(page);
  await wizard.getByRole('button', { name: 'Начать', exact: true }).click();
  for (let i = 0; i < 4; i += 1)
    await wizard.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(wizard.locator('.eyebrow')).toContainText('ШАГ 6 ИЗ 8');
  const wizardF1 = wizard
    .locator('.ui-switch')
    .filter({ hasText: 'Напоминания о сессиях Формулы 1' })
    .locator('input');
  await expect(wizardF1).toBeChecked();
  await expect(wizardF1).toBeDisabled();
  await expect(wizard.getByText('Работают, когда уведомления включены.')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('sportsdesk.notifications.enabled', '1'));
  await page.reload();
  wizard = await openWizard(page);
  await wizard.getByRole('button', { name: 'Начать', exact: true }).click();
  for (let i = 0; i < 4; i += 1)
    await wizard.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(wizard.locator('.eyebrow')).toContainText('ШАГ 6 ИЗ 8');
  await expect(wizardF1).toBeChecked();
  await expect(wizardF1).toBeEnabled();
});

test('wizard step 2 scrolls its club list inside the dialog at 1100 × 720', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await page.goto('/');
  await expect(page.locator('.today-view')).toBeVisible();
  const wizard = await openWizard(page);
  await wizard.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(wizard.locator('.eyebrow')).toContainText('ШАГ 2 ИЗ 8');

  const next = wizard.getByRole('button', { name: 'Далее', exact: true });
  await expect(next).toBeInViewport({ ratio: 1 });
  await expect(wizard.getByRole('heading', { name: 'Футбол', exact: true })).toBeVisible();

  const body = wizard.locator('.ui-dialog__body');
  const field = wizard.getByLabel('Добавить клуб');
  const before = await body.evaluate((element) => element.scrollTop);
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(
    true,
  );
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeInViewport({ ratio: 1 });
  const after = await body.evaluate((element) => element.scrollTop);
  expect(after).toBeGreaterThan(before);
  await expect(next).toBeInViewport({ ratio: 1 });
});

test('the live mini window stays compact and uses the kit empty and error states', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const mini = await browser.newPage({ viewport: { width: 360, height: 520 } });
  await setupVisualFixture(mini, 'dark', true);
  await mini.addInitScript(() => {
    const teams = [
      { id: 'arsenal', name: 'Arsenal', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
      { id: 'chelsea', name: 'Chelsea', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
    ];
    localStorage.setItem(
      'sportsdesk.football.favorites.teams',
      JSON.stringify({ ids: teams.map((team) => team.id) }),
    );
    localStorage.setItem('sportsdesk.football.catalogue', JSON.stringify(teams));
  });
  await mini.goto('/#mini');
  await expect(mini.locator('.mini-root')).toBeVisible();
  await expect(mini.locator('.ui-match-row--compact').first()).toBeVisible();
  expect(
    await mini.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  const clipped = await mini.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '.ui-match-row__time, .ui-match-row__state, .ui-match-row__team-name',
      ),
    )
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.textContent?.trim() ?? ''),
  );
  expect(clipped).toEqual([]);
  await mini.close();

  const empty = await browser.newPage({ viewport: { width: 360, height: 520 } });
  await setupVisualFixture(empty, 'dark', true);
  await empty.goto('/#mini');
  await expect(empty.locator('.mini-root')).toBeVisible();
  await expect(empty.locator('.ui-empty')).toContainText('Сейчас нет матчей избранных клубов.');
  await expect(empty.locator('.ui-match-row')).toHaveCount(0);
  await empty.close();

  const error = await browser.newPage({ viewport: { width: 360, height: 520 } });
  await setupVisualFixture(error, 'dark', true);
  await error.route('**/bridge/api?*', (route) => route.fulfill({ status: 500, body: '{}' }));
  await error.goto('/#mini');
  await expect(error.locator('.mini-root')).toBeVisible();
  await expect(error.locator('.ui-empty--error[role="alert"]')).toBeVisible();
  await expect(
    error.locator('.ui-empty--error').getByRole('button', { name: 'Повторить' }),
  ).toBeVisible();
  await error.close();
});
