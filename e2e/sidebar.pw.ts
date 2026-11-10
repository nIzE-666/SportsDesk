import { expect, test } from '@playwright/test';

for (const design of ['classic', 'broadcast']) {
  test(`${design}: pinned actions and saved groups with ten favorite teams`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.addInitScript((selectedDesign) => {
      localStorage.setItem('sportsdesk.design', selectedDesign);
      localStorage.setItem('sportsdesk.sport', 'football');
      localStorage.setItem('sportsdesk.onboarding', JSON.stringify({ status: 'completed' }));
      localStorage.setItem('sportsdesk.whatsnew.seen', '1.7.0');
      const teams = Array.from({ length: 10 }, (_, i) => ({ id: `team-${i}`, name: `Клуб ${i}` }));
      localStorage.setItem(
        'sportsdesk.football.favorites.teams',
        JSON.stringify({ ids: teams.map((t) => t.id) }),
      );
      localStorage.setItem('sportsdesk.football.catalogue', JSON.stringify(teams));
    }, design);
    await page.route('**/bridge/**', (route) =>
      route.fulfill({ json: { payload: { data: {} }, source: 'fixture', stale: false } }),
    );
    await page.goto('/');
    const sidebar = page.locator('aside.sidebar');
    const settings = sidebar.getByTitle('Настройки');
    await expect(settings).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Смотреть', exact: true })).toBeInViewport();
    const teams = sidebar.getByRole('button', { name: 'Мои команды' });
    const competitions = sidebar.getByRole('button', { name: 'Соревнования' });
    await teams.scrollIntoViewIfNeeded();
    await expect(sidebar.getByTitle('Клуб 9')).toHaveCount(1);
    await teams.click();
    await competitions.click();
    await expect(settings).toBeInViewport();
    await page.reload();
    await expect(teams).toHaveAttribute('aria-expanded', 'false');
    await expect(competitions).toHaveAttribute('aria-expanded', 'false');
    await expect(settings).toBeInViewport();
  });
}
