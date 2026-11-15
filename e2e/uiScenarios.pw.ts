import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

test('measure user journeys from launch', async ({ page }) => {
  const output = process.env.SPORTSDESK_SCENARIOS_OUTPUT;
  test.skip(!output, 'Set SPORTSDESK_SCENARIOS_OUTPUT to write the measurements.');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupVisualFixture(page, 'dark', true);
  await page.addInitScript(() => {
    localStorage.setItem(
      'sportsdesk.football.favorites.teams',
      JSON.stringify({ ids: ['arsenal'] }),
    );
    localStorage.setItem(
      'sportsdesk.football.catalogue',
      JSON.stringify([{ id: 'arsenal', name: 'Arsenal' }]),
    );
  });
  await page.goto('/');
  const results: Array<{ scenario: string; clicks: number | null; note: string }> = [];
  let clicks = 0;
  const click = async (locator: Locator) => {
    await locator.click();
    clicks += 1;
  };
  const rail = (name: string) =>
    page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name, exact: true });
  const tab = (name: string) => page.locator('.shell-tabs').getByRole('tab', { name, exact: true });
  const openFootballMatches = async () => {
    await click(rail('Футбол'));
    await click(tab('Матчи'));
  };
  const openMatch = async () => {
    await openFootballMatches();
    await click(page.locator('[data-match-id="test-match"] .mt-open').first());
  };
  async function start() {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await expect(page.locator('.today-view')).toBeVisible();
    clicks = 0;
  }
  const save = (scenario: string, note: string) => results.push({ scenario, clicks, note });
  await start();
  await expect(page.locator('.today-team-tile').first()).toContainText('2:1');
  save('Вчерашний счёт любимого клуба', 'Счёт 2 : 1 показан на главной.');

  await start();
  await expect(page.locator('[data-block="upcoming"]')).toContainText('Arsenal');
  await click(rail('Формула 1'));
  await click(tab('Календарь'));
  await expect(page.locator('.calendar-board')).toContainText('Circuit 2');
  save('Следующие матч клуба и гонка', 'Матч на главной, ближайшая гонка в календаре F1.');

  await start();
  await openMatch();
  await click(page.getByRole('tab', { name: 'Статистика' }));
  await expect(page.locator('.match-statistics')).toContainText('62');
  save('Статистика матча', 'Открыты показатели конкретного матча.');

  await start();
  await click(rail('Футбол'));
  await click(tab('Таблица'));
  await expect(page.locator('.standings-view')).toContainText('Arsenal');
  save('Таблица лиги', 'Проверена строка клуба в таблице.');

  await start();
  await click(rail('Формула 1'));
  await click(tab('Зачёты'));
  await expect(page.locator('.f1-root')).toContainText('Norris');
  save('Зачёт пилотов', 'Проверена строка пилота.');

  await start();
  await openMatch();
  await click(page.locator('.match-detail').getByRole('button', { name: 'Смотреть', exact: true }));
  await expect(page.getByRole('region', { name: 'Просмотр события' })).toContainText('Arsenal');
  await expect(page.locator('.watch-root-signed-out')).toBeVisible();
  results.push({
    scenario: 'Включить трансляцию',
    clicks: null,
    note: `Переход к просмотру завершённого тестового матча — ${clicks} нажатия; сценарий прямого эфира не измерен без входа Kino и проверяемой трансляции.`,
  });

  await start();
  await page.evaluate(() => localStorage.setItem('sportsdesk.notifications.enabled', '1'));
  await page.reload();
  await expect(page.locator('.today-view')).toBeVisible();
  await click(rail('Настройки'));
  await click(
    page
      .getByRole('navigation', { name: 'Категории настроек' })
      .getByRole('button', { name: 'Уведомления', exact: true }),
  );
  await click(page.locator('.notification-preferences .ui-disclosure__trigger'));
  const team = page.locator('.notification-teams .settings-team').filter({ hasText: 'Arsenal' });
  await click(team.getByLabel('Уведомления команды'));
  await expect(team.getByLabel('Уведомления команды')).not.toBeChecked();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('sportsdesk.notifications.policy')))
    .toContain('arsenal');
  save(
    'Изменить уведомления клуба',
    'Уведомления включены заранее; отключены уведомления Arsenal и проверено сохранение.',
  );

  await start();
  await openMatch();
  await click(page.getByRole('button', { name: 'Просмотрено', exact: true }));
  await click(page.getByRole('button', { name: 'Сохранить отметку', exact: true }));
  await expect(page.locator('.diary-mark')).toContainText('Просмотр сохранён');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('sportsdesk.view.diary')))
    .toContain('test-match');
  save('Отметить матч просмотренным', 'Запись сохранена в дневник.');
  await writeFile(
    output!,
    JSON.stringify(
      { viewport: '1440x900', fixture: 'e2e/uiFixture.ts scenarioData', results },
      null,
      2,
    ) + '\n',
  );
});
