import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';
import {
  mockWatchAccount,
  seedWatchPreferences,
  WATCH_CHANNELS,
  WATCH_FAILING_CHANNEL,
  WATCH_FAVORITES,
  WATCH_RECENT,
} from './watchFixture';

const section = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name, exact: true });

async function openWatch(page: Page): Promise<void> {
  await section(page, 'Смотреть').click();
  await expect(page.locator('.watch-root')).toBeVisible();
}

async function pageBox(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main.content')!;
    return {
      clientHeight: main.clientHeight,
      scrollHeight: main.scrollHeight,
      clientWidth: main.clientWidth,
      scrollWidth: main.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      windowWidth: window.innerWidth,
    };
  });
}

async function openSignedIn(
  page: Page,
  width: number,
  height: number,
  channels: readonly { id: number; title: string; logo?: string; url?: string }[] = WATCH_CHANNELS,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await setupVisualFixture(page, 'dark', true);
  await seedWatchPreferences(page);
  await mockWatchAccount(page, true, channels);
  await page.goto('/');
  await openWatch(page);
  await expect(page.locator('.watch-catalog')).toBeVisible();
}

test('signed out: one empty state and one sign-in dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await mockWatchAccount(page, false);
  await page.goto('/');
  await openWatch(page);

  const root = page.locator('.watch-root');
  await expect(page.locator('.watch-root-signed-out')).toBeVisible();
  await expect(root.getByText('Kino', { exact: true })).toBeVisible();
  await expect(root.getByText('Подключите аккаунт по коду устройства, без пароля.')).toBeVisible();
  await expect(root.locator('.ui-button--primary')).toHaveCount(1);
  await expect(root.getByRole('button', { name: 'OKKO Football' })).toBeVisible();

  await root.getByRole('button', { name: 'Подключить устройство' }).click();
  const dialog = page.getByRole('dialog', { name: 'Подключение Kino' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('E2E-CODE')).toBeVisible();
  await expect(dialog.locator('.ui-button--primary')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.watch-root-signed-out')).toBeVisible();

  const box = await pageBox(page);
  expect(box.scrollHeight).toBeLessThanOrEqual(1800);
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
  expect(box.documentWidth).toBeLessThanOrEqual(box.windowWidth);
});

for (const width of [1100, 1440]) {
  test(`catalog at ${width}: groups, one filter, one item shape`, async ({ page }) => {
    await openSignedIn(page, width, width === 1100 ? 720 : 900);

    const group = (name: string) =>
      page.locator('.watch-group').filter({
        has: page.getByRole('heading', { name, exact: true }),
      });
    await expect(group('Избранное').locator('.watch-channel')).toHaveCount(2);
    await expect(group('Недавние').locator('.watch-channel')).toHaveCount(2);
    await expect(group('Все каналы').locator('.watch-channel')).toHaveCount(2);
    await expect(page.locator('.watch-channel')).toHaveCount(WATCH_CHANNELS.length);
    await expect(
      group('Избранное').getByRole('button', {
        name: `Убрать из избранного: ${WATCH_CHANNELS[0]!.title}`,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    // A tile that is not a favourite shows its star without a hover.
    await expect(
      page
        .locator('.watch-channel--tile')
        .filter({ hasText: 'Football 1' })
        .getByRole('button', { name: 'В избранное: Football 1' }),
    ).toBeVisible();

    const filter = page.getByRole('radiogroup', { name: 'Фильтр каналов' });
    await expect(filter.getByRole('radio')).toHaveCount(3);
    await filter.getByRole('radio', { name: 'Избранное', exact: true }).click();
    await expect(page.locator('.watch-channel')).toHaveCount(WATCH_FAVORITES.length);
    await expect(group('Недавние')).toHaveCount(0);

    await filter.getByRole('radio', { name: 'Спорт', exact: true }).click();
    await expect(page.locator('.watch-channel')).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Дом кино', exact: true })).toHaveCount(0);

    await filter.getByRole('radio', { name: 'Все', exact: true }).click();
    await expect(page.locator('.watch-channel')).toHaveCount(WATCH_CHANNELS.length);

    const search = page.getByRole('searchbox', { name: 'Поиск канала' });
    await search.fill('F1');
    await expect(page.locator('.watch-channel')).toHaveCount(1);
    await expect(group('Недавние')).toContainText(WATCH_CHANNELS[2]!.title);
    await page.getByRole('button', { name: 'Очистить поиск' }).click();
    await expect(page.locator('.watch-channel')).toHaveCount(WATCH_CHANNELS.length);

    await page.getByRole('button', { name: 'В избранное: Football 1' }).click();
    await expect(
      page.getByRole('button', { name: 'Убрать из избранного: Football 1' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Убрать из избранного: Football 1' }).click();

    await page.getByRole('button', { name: 'Список каналов' }).click();
    await expect(page.locator('.watch-catalog--list')).toBeVisible();
    await expect(page.locator('.watch-channel--row')).toHaveCount(WATCH_CHANNELS.length);
    await page.getByRole('button', { name: 'Сетка каналов' }).click();
    await expect(page.locator('.watch-catalog--grid')).toBeVisible();
    await expect(page.locator('.watch-channel--tile')).toHaveCount(WATCH_CHANNELS.length);

    // Taking both favourites away removes the empty «Избранное» filter option.
    for (const channel of WATCH_CHANNELS.filter((item) => WATCH_FAVORITES.includes(item.id))) {
      await page.getByRole('button', { name: `Убрать из избранного: ${channel.title}` }).click();
    }
    await expect(filter.getByRole('radio', { name: 'Избранное', exact: true })).toHaveCount(0);
    await expect(page.locator('.watch-channel')).toHaveCount(WATCH_CHANNELS.length);

    await expect(page.locator('.watch-root .ui-button--primary')).toHaveCount(0);
    const box = await pageBox(page);
    expect(box.scrollHeight).toBeLessThanOrEqual(1800);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    expect(box.documentWidth).toBeLessThanOrEqual(box.windowWidth);
  });
}

test('the player keeps M and F and claims LIVE only for a ready stream', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = function requestFullscreen() {
      (window as unknown as { __fullscreenRequested?: boolean }).__fullscreenRequested = true;
      return Promise.resolve();
    };
  });
  await openSignedIn(page, 1440, 900);
  await page
    .locator('.watch-catalog--grid')
    .getByRole('button', { name: WATCH_CHANNELS[0]!.title, exact: true })
    .click();

  await expect(page.locator('.watch-player-shell')).toBeVisible();
  await expect(page.getByText('Для этого канала нет потока.')).toBeVisible();
  await expect(page.locator('.watch-player-controls')).toBeVisible();
  await expect(page.locator('.watch-player-title')).toContainText(WATCH_CHANNELS[0]!.title);
  await expect(page.locator('.ui-badge--live')).toHaveCount(0);
  await expect(page.locator('.watch-root .ui-button--primary')).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Включить звук (M)' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Выключить звук (M)' })).toBeVisible();

  await page.keyboard.press('f');
  expect(
    await page.evaluate(
      () => (window as unknown as { __fullscreenRequested?: boolean }).__fullscreenRequested,
    ),
  ).toBe(true);

  const box = await pageBox(page);
  expect(box.scrollHeight).toBeLessThanOrEqual(1800);
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
});

test('a failed stream shows the player error and keeps the site link', async ({ page }) => {
  await openSignedIn(page, 1440, 900, [...WATCH_CHANNELS, WATCH_FAILING_CHANNEL]);
  await page
    .locator('.watch-catalog--grid')
    .getByRole('button', { name: WATCH_FAILING_CHANNEL.title, exact: true })
    .click();

  const error = page.locator('.watch-player-error');
  await expect(error).toBeVisible({ timeout: 20_000 });
  await expect(error.getByText('Не удалось воспроизвести поток')).toBeVisible();
  await expect(error.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await expect(page.locator('.watch-player-error-actions')).toHaveCount(0);
  await expect(
    page
      .locator('.watch-player-foot')
      .getByRole('button', { name: 'Открыть канал на сайте', exact: true }),
  ).toBeVisible();
});

test('logout asks once and returns to the signed-out state', async ({ page }) => {
  await openSignedIn(page, 1440, 900);
  await page.locator('.watch-topbar').getByRole('button', { name: 'Выйти', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Выйти из Kino в SportsDesk?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.ui-button--primary')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.locator('.watch-topbar').getByRole('button', { name: 'Выйти', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Выйти из Kino в SportsDesk?' });
  await dialog.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.locator('.watch-root-signed-out')).toBeVisible();
  await expect(page.locator('.watch-topbar')).toHaveCount(0);
});

test('the watch module off hides the section and the match button', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await setupVisualFixture(page, 'dark', true);
  await page.addInitScript(() => {
    localStorage.setItem(
      'sportsdesk.modules',
      JSON.stringify({ version: 1, modules: { watch: false } }),
    );
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible();
  await expect(section(page, 'Смотреть')).toHaveCount(0);

  await section(page, 'Футбол').click();
  await page.locator('.shell-tabs').getByRole('tab', { name: 'Матчи', exact: true }).click();
  await page.locator('[data-match-id="test-match"] .mt-open').first().click();
  await expect(page.locator('.md-score')).toContainText('2 : 1');
  await expect(
    page.locator('.md-actions').getByRole('button', { name: 'Смотреть', exact: true }),
  ).toHaveCount(0);
});

test('an empty catalog hides the search and the channel filter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await mockWatchAccount(page, true, []);
  await page.goto('/');
  await openWatch(page);

  await expect(page.getByText('В каталоге нет каналов.')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Поиск канала' })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Фильтр каналов' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Повторить' })).toHaveCount(0);
  await expect(page.locator('.watch-root .ui-button--primary')).toHaveCount(0);
});
