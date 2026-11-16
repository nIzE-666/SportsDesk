import { expect, test } from '@playwright/test';

/* The kit is reviewed in the dev gallery. A row must fit its own container at
   the widest gallery viewport and inside the 360 px narrow panel, even with
   long team names. */
test('kit match rows never overflow their container', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/dev/kit.html?scheme=dark');
  await expect(page.locator('#kit-matches .ui-match-row').first()).toBeVisible();

  const pageMetrics = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('#kit-matches .ui-match-row'));
    return {
      pageWidth: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      rows: rows.map((row) => ({
        text: row.textContent?.trim().slice(0, 60) ?? '',
        width: row.clientWidth,
        scrollWidth: row.scrollWidth,
      })),
    };
  });
  expect(pageMetrics.pageScrollWidth).toBeLessThanOrEqual(pageMetrics.pageWidth);
  for (const row of pageMetrics.rows) {
    expect(row.scrollWidth, row.text).toBeLessThanOrEqual(row.width);
  }

  const narrow = await page.locator('.kit-gallery-narrow').evaluate((container) => {
    const panel = container.querySelector<HTMLElement>('.ui-panel')!;
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.ui-match-row'));
    const names = Array.from(container.querySelectorAll<HTMLElement>('.ui-match-row__team-name'));
    return {
      panelWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      rows: rows.map((row) => ({
        width: row.clientWidth,
        scrollWidth: row.scrollWidth,
      })),
      names: names.map((name) => ({
        text: name.textContent ?? '',
        width: name.clientWidth,
        scrollWidth: name.scrollWidth,
      })),
    };
  });
  expect(narrow.panelWidth).toBeLessThanOrEqual(360);
  expect(narrow.panelScrollWidth).toBeLessThanOrEqual(narrow.panelWidth);
  for (const row of narrow.rows) {
    expect(row.scrollWidth).toBeLessThanOrEqual(row.width);
    expect(row.width).toBeLessThanOrEqual(narrow.panelWidth);
  }
  for (const name of narrow.names) {
    // The long name is clipped with an ellipsis rather than collapsed to zero.
    expect(name.width, name.text).toBeGreaterThan(0);
    expect(name.scrollWidth, name.text).toBeGreaterThan(name.width);
  }
});

/* The «Витрина» layer: the hero, both shelves, the week track, the interest
   meter, the match strip and the countdown all render from the gallery. */
test('kit showcase renders every element of the new layer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dev/kit.html?scheme=dark');
  const showcase = page.locator('#kit-showcase');
  await expect(showcase.locator('.showcase')).toBeVisible();

  const hero = showcase.locator('.ui-showcase-hero');
  await expect(hero).toBeVisible();
  await expect(hero.locator('.ui-showcase-hero__kicker')).toHaveText('Главный матч');
  await expect(hero.locator('.ui-showcase-hero__kicker-mark')).toHaveCount(2);
  await expect(hero.locator('.ui-showcase-hero__title')).toHaveText('Арсенал — Челси');
  await expect(hero.locator('.ui-showcase-hero__crest')).toHaveCount(2);
  await expect(hero.locator('.ui-pitch-track')).toBeVisible();
  await expect(hero.locator('.ui-showcase-hero__title')).toHaveCSS('font-family', /Exo 2 Variable/);
  await expect(hero.locator('.ui-showcase-hero__title')).toHaveCSS('font-style', 'italic');

  await expect(showcase.locator('.ui-showcase-shelf')).toHaveCount(2);
  await expect(showcase.locator('.ui-showcase-shelf__row').first().locator('li')).toHaveCount(4);
  await expect(showcase.locator('.kit-showcase-card')).toHaveCount(4);
  await expect(showcase.locator('.ui-interest')).toHaveCount(4);
  await expect(showcase.locator('.ui-match-strip')).toHaveCount(4);
  await expect(showcase.locator('.ui-showcase-score').first()).toHaveCSS(
    'font-family',
    /Exo 2 Variable/,
  );
  await expect(showcase.locator('.ui-showcase-shelf__empty')).toHaveText(
    'Ближайших матчей пока нет.',
  );

  await expect(showcase.locator('.ui-week-track')).toBeVisible();
  await expect(showcase.locator('.ui-week-track__event')).toHaveCount(8);
  await expect(showcase.locator('.ui-week-track__flag')).toHaveCount(2);
  await expect(showcase.locator('.ui-week-track__flag').first()).toHaveCSS('width', '24px');
  await expect(showcase.locator('.ui-week-track__now')).toHaveCount(1);
  await expect(showcase.locator('.ui-week-track__now-stem')).toBeVisible();
  await expect(showcase.locator('.ui-week-track__now-dot')).toBeVisible();
  await expect(showcase.locator('.ui-week-track__now-label')).toHaveText('сейчас');
  await expect(showcase.locator('.ui-week-track__day-label')).toHaveCount(7);

  const countdown = showcase.locator('.ui-countdown');
  await expect(countdown).toBeVisible();
  await expect(countdown).toHaveCSS('font-family', /Exo 2 Variable/);
  await expect(countdown.locator('.ui-countdown__digits')).toHaveText(
    /^через 2 дня · \d{2}:\d{2}:\d{2}$/,
  );
  await expect(countdown).toHaveAttribute('aria-label', /^через 2 дня · \d{2}:\d{2}$/);
});

/* At 1100 three cards fit, so the fourth one is one page away: the previous
   arrow is off at the start and the next arrow is off at the end. */
test('kit showcase shelf arrows are disabled at the ends', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto('/dev/kit.html?scheme=dark');
  const shelf = page.locator('#kit-showcase .ui-showcase-shelf').first();
  const back = shelf.getByRole('button', { name: 'Назад' });
  const forward = shelf.getByRole('button', { name: 'Вперёд' });
  await expect(back).toBeDisabled();
  await expect(forward).toBeEnabled();

  await forward.click();
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  await back.click();
  await expect(back).toBeDisabled();
  await expect(forward).toBeEnabled();
});

/* The score plate stays on the centre line of its card when the shelf gives
   the cards a lot of width at 1920. */
test('kit showcase score plates stay centred in wide cards', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto('/dev/kit.html?scheme=dark');
  const cards = page.locator('#kit-showcase .kit-showcase-card');
  await expect(cards).toHaveCount(4);
  const offsets = await cards.evaluateAll((list) =>
    list.map((card) => {
      const cardBox = card.getBoundingClientRect();
      const score = card.querySelector('.ui-showcase-score')!.getBoundingClientRect();
      return Math.abs(score.left + score.width / 2 - (cardBox.left + cardBox.width / 2));
    }),
  );
  for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1);
});

/* The week track is one tab stop per event; the arrows move along the events
   in time order and the preview follows the focus. */
test('kit showcase week track moves focus with the arrows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dev/kit.html?scheme=dark');
  const track = page.locator('#kit-showcase .ui-week-track');
  const events = track.locator('.ui-week-track__event');
  await expect(events).toHaveCount(8);

  await events.first().focus();
  await expect(events.first()).toBeFocused();
  await expect(track.locator('.ui-week-track__preview')).toContainText('Тоттенхэм — Ньюкасл');

  await page.keyboard.press('ArrowRight');
  await expect(events.nth(1)).toBeFocused();
  await expect(track.locator('.ui-week-track__preview')).toContainText('Барселона — Реал Мадрид');

  await page.keyboard.press('ArrowLeft');
  await expect(events.first()).toBeFocused();
});

/* A list is built from separate grids, so the fixed time and competition tracks
   must keep the score in one column even with different names. */
test('kit match row scores line up in a list', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/dev/kit.html?scheme=dark');
  const list = page.locator('#kit-score-list');
  await expect(list.locator('.ui-match-row')).toHaveCount(3);
  const centers = await list.evaluate((container) => {
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.ui-match-row'));
    return rows.map((row) => {
      const score = row.querySelector<HTMLElement>('.ui-match-row__score')!;
      const box = score.getBoundingClientRect();
      return box.left + box.width / 2;
    });
  });
  const spread = Math.max(...centers) - Math.min(...centers);
  expect(spread).toBeLessThanOrEqual(1);
});
