import { expect, test, type Page } from '@playwright/test';
import { diaryFixture, diaryFootballEntry } from '../src/test/fixtures/diary';
import { schemeFromLineups } from '../src/features/tactics/tacticsModel';
import { tacticLineups, tacticMatch } from '../src/test/fixtures/tactics';
import { setupVisualFixture } from './uiFixture';

const player = {
  id: 'a',
  name: 'Alex Morgan',
  teamId: 'arsenal',
  teamName: 'Arsenal',
  savedAt: '2026-11-09T00:00:00Z',
};
const prediction = {
  matchId: 'next-match',
  leagueId: 'l_4WFCIZ',
  home: 2,
  away: 1,
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  kickoff: '2099-01-01T12:00:00Z',
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  rules: 1,
};
const scheme = {
  ...schemeFromLineups(tacticMatch, tacticLineups, 'fixture-scheme'),
  title: 'Прессинг на фланге',
  updatedAt: '2026-11-09T00:00:00Z',
};
const tactics = { version: 1 as const, schemes: [scheme] };

async function openMy(page: Page, modules?: Record<string, boolean>) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await page.addInitScript(
    ({ player, prediction, tactics, modules, diary }) => {
      localStorage.setItem(
        'sportsdesk.football.favorites.teams',
        JSON.stringify({ ids: ['arsenal'], seededDefault: true }),
      );
      localStorage.setItem(
        'sportsdesk.football.catalogue',
        JSON.stringify([
          { id: 'arsenal', name: 'Arsenal', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
        ]),
      );
      localStorage.setItem('sportsdesk.football.favorites.players', JSON.stringify([player]));
      localStorage.setItem('sportsdesk.f1.favTeams', JSON.stringify(['mercedes']));
      localStorage.setItem('sportsdesk.f1.favDrivers', JSON.stringify(['max_verstappen']));
      localStorage.setItem('sportsdesk.view.diary', JSON.stringify(diary));
      localStorage.setItem(
        'sportsdesk.view.games.predictions',
        JSON.stringify({ version: 1, items: [prediction] }),
      );
      localStorage.setItem('sportsdesk.football.tactics', JSON.stringify(tactics));
      if (modules)
        localStorage.setItem('sportsdesk.modules', JSON.stringify({ version: 1, modules }));
    },
    { player, prediction, tactics, modules, diary: diaryFixture },
  );
  await page.clock.setFixedTime(new Date('2026-11-10T00:00:00Z'));
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: 'Разделы' });
  await rail.getByRole('button', { name: 'Моё', exact: true }).click();
  return page.locator('.shell-tabs');
}

test('shows fixture data in all four «Моё» tabs', async ({ page }) => {
  const tabs = await openMy(page);

  await expect(tabs.getByRole('tab', { name: 'Избранное', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.my-tile').filter({ hasText: 'Arsenal' })).toBeVisible();
  await expect(page.locator('.my-row')).toContainText('Alex Morgan');
  await expect(page.locator('.my-favorite').filter({ hasText: 'Mercedes' })).toBeVisible();
  await expect(page.locator('.my-favorite').filter({ hasText: 'Макс Ферстаппен' })).toBeVisible();

  await tabs.getByRole('tab', { name: 'Дневник', exact: true }).click();
  await expect(page.locator('.diary-view')).toBeVisible();
  await expect(page.locator('.diary-view')).toContainText(diaryFootballEntry.note);

  await tabs.getByRole('tab', { name: 'Игры и прогнозы', exact: true }).click();
  await expect(page.locator('.games-view')).toBeVisible();
  await page.getByRole('tab', { name: 'Угадай счёт', exact: true }).click();
  await expect(page.locator('.prediction-list')).toContainText('Мой прогноз 2 : 1');

  await tabs.getByRole('tab', { name: 'Схемы', exact: true }).click();
  await expect(page.locator('.my-scheme')).toContainText('Прессинг на фланге');
  await expect(page.locator('.my-scheme')).toContainText('Матч · Arsenal — Chelsea');
});

test('opens the page of a favourite club', async ({ page }) => {
  await openMy(page);
  await page.locator('.my-tile').filter({ hasText: 'Arsenal' }).click();
  await expect(page.locator('.team-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Arsenal', exact: true })).toBeVisible();
});

test('hides «Дневник» when the diary module is off', async ({ page }) => {
  const tabs = await openMy(page, { diary: false });
  await expect(tabs.getByRole('tab', { name: 'Избранное', exact: true })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Дневник', exact: true })).toHaveCount(0);
  await expect(page.locator('.my-view')).toBeVisible();
});
