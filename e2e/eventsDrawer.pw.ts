import { expect, test, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

interface DrawerEvent {
  id: string;
  sport: 'football' | 'f1';
  kind: string;
  title: string;
  body: string;
  occurredAt: number;
  read: boolean;
  matchId?: string;
  leagueId?: string;
  season?: string;
  round?: string;
}

const eventAt = (id: string, read: boolean, hoursAgo: number): DrawerEvent => ({
  id,
  sport: 'football',
  kind: 'goal',
  title: read ? 'Матч завершён' : 'Изменение счёта',
  body: 'Arsenal — Chelsea · 2 : 1',
  occurredAt: Date.parse('2026-10-24T18:00:00Z') - hoursAgo * 3_600_000,
  read,
  matchId: 'test-match',
  leagueId: 'l_4WFCIZ',
});

async function openShell(page: Page) {
  await page.setViewportSize({ width: 1100, height: 720 });
  const errors = await setupVisualFixture(page, 'dark', true);
  const state = { events: [eventAt('drawer-unread', false, 2), eventAt('drawer-read', true, 20)] };
  await page.route('**/bridge/command', async (route) => {
    const { command, args = {} } = route.request().postDataJSON();
    if (command === 'event_center_list') return route.fulfill({ json: state.events });
    if (command === 'event_center_mark_read') {
      const ids: string[] = args.ids ?? [];
      state.events = state.events.map((event) =>
        ids.includes(event.id) ? { ...event, read: true } : event,
      );
      return route.fulfill({ json: {} });
    }
    return route.fallback();
  });
  await page.goto('/');
  return { rail: page.getByRole('navigation', { name: 'Разделы' }), errors };
}

test(`the bell opens the events drawer, keeps focus inside and closes on Escape`, async ({
  page,
}) => {
  const { rail, errors } = await openShell(page);
  await expect(page.locator('.nav-rail-badge')).toHaveText('1');

  await rail.getByRole('button', { name: 'События', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'События' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'События', exact: true })).toBeVisible();
  await expect(dialog.locator('article')).toHaveCount(2);
  await expect(dialog.getByText('Изменение счёта')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Закрыть события' })).toBeFocused();
  expect(
    await page
      .locator('.events-drawer')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');

  await page.keyboard.press('Shift+Tab');
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(rail.getByRole('button', { name: 'События', exact: true })).toBeFocused();
  await expect(page.locator('.nav-rail-badge')).toHaveText('1');
  expect(errors).toEqual([]);
});

test(`a click outside closes the drawer and keeps the page underneath`, async ({ page }) => {
  const { rail, errors } = await openShell(page);
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await rail.getByRole('button', { name: 'События', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'События' });
  await expect(dialog).toBeVisible();

  await page.locator('.events-drawer-backdrop').click({ position: { x: 20, y: 20 } });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'События', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test(`opening an event closes the drawer, navigates and clears the badge`, async ({ page }) => {
  const { rail, errors } = await openShell(page);
  await rail.getByRole('button', { name: 'События', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'События' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Открыть матч' }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Premier League · Матч', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.nav-rail-badge')).toHaveCount(0);
  await expect(rail.getByRole('button', { name: 'События', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
