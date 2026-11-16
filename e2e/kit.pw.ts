import { expect, test, type Page } from '@playwright/test';

/* The kit is reviewed in the dev gallery. A row must fit its own container at
   the widest gallery viewport and inside the 360 px narrow panel, even with
   long team names. */
test('kit match rows never overflow their container', async ({ page }) => {
  await stubCrests(page);
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

/* The gallery shows real crests; the test feeds them a tiny local image so the
   spec never depends on the network. */
const CREST_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2l9sAAAAASUVORK5CYII=',
  'base64',
);

async function stubCrests(page: Page) {
  await page.route('https://cdn.pitchapi.dev/images/teams/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: CREST_PIXEL }),
  );
}

/* The «Витрина» layer: the hero, the week track, both card shelves, the
   Formula 1 band and the empty shelf all render from the gallery. */
test('kit showcase renders every element of the new layer', async ({ page }) => {
  await stubCrests(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dev/kit.html?scheme=dark');
  const showcase = page.locator('#kit-showcase');
  await expect(showcase.locator('.showcase')).toBeVisible();

  const hero = showcase.locator('.ui-showcase-hero');
  await expect(hero).toBeVisible();
  await expect(hero.locator('.ui-showcase-hero__kicker')).toHaveText('Главный матч');
  await expect(hero.locator('.ui-showcase-hero__kicker-mark')).toHaveCount(2);
  await expect(hero.locator('.ui-showcase-hero__title')).toHaveText('Arsenal — Chelsea');
  await expect(hero.locator('.ui-showcase-hero__crest')).toHaveCount(2);
  await expect(hero.locator('.ui-showcase-crest__image')).toHaveCount(2);
  await expect(hero.locator('.ui-pitch-track')).toBeVisible();
  await expect(hero.locator('.ui-showcase-hero__title')).toHaveCSS('font-family', /Exo 2 Variable/);
  await expect(hero.locator('.ui-showcase-hero__title')).toHaveCSS('font-style', 'italic');
  await expect(hero.locator('.ui-showcase-hero__tag')).toHaveCount(2);
  await expect(hero.locator('.ui-showcase-hero__actions .ui-button')).toHaveCount(2);
  await expect(hero.locator('.ui-showcase-hero__meta')).toContainText('суббота, 21 ноября, 21:30');

  const board = hero.locator('.ui-countdown--board');
  await expect(board).toBeVisible();
  await expect(board.locator('.ui-countdown__cell')).toHaveCount(4);
  await expect(board.locator('.ui-countdown__unit')).toHaveText(['дн', 'ч', 'мин', 'сек']);
  await expect(board).toHaveAttribute('aria-label', /^через 2 дня · \d{2}:\d{2}$/);
  await expect(board).toHaveCSS('font-family', /Exo 2 Variable/);

  await expect(showcase.locator('.ui-showcase-shelf')).toHaveCount(3);
  const best = showcase.locator('.ui-showcase-shelf').first();
  await expect(best.locator('.ui-showcase-card')).toHaveCount(4);
  await expect(best.locator('.ui-showcase-card[role="button"]')).toHaveCount(4);
  await expect(
    best.locator('.ui-showcase-card').first().locator('.ui-showcase-board__digit'),
  ).toHaveText(['4', '4']);
  await expect(
    best.locator('.ui-showcase-card').nth(1).locator('.ui-showcase-board__digit--dim'),
  ).toHaveCount(1);
  const keyGoal = best.locator('.ui-match-strip__goal--key').first();
  await expect(keyGoal.locator('.ui-match-strip__minute')).toHaveText('90+3′');
  await expect(
    best
      .locator('.ui-match-strip__goal:not(.ui-match-strip__goal--key) .ui-match-strip__minute')
      .first(),
  ).toHaveClass(/ui-showcase-visually-hidden/);

  const wide = showcase.locator('.ui-showcase-shelf--wide');
  await expect(wide.locator('.ui-showcase-upcoming')).toHaveCount(3);
  await expect(wide.locator('.ui-showcase-upcoming__flag')).toHaveCount(1);
  await expect(wide.locator('.ui-showcase-crest')).toHaveCount(4);
  await expect(wide.locator('.ui-showcase-upcoming__when')).toHaveCount(3);

  await expect(showcase.locator('.ui-showcase-shelf__empty')).toHaveText(
    'Матчей избранных клубов пока нет.',
  );

  const band = showcase.locator('.ui-showcase-band');
  await expect(band).toBeVisible();
  await expect(band.locator('.ui-showcase-band__plate')).toHaveText('Формула 1');
  await expect(band.locator('.ui-showcase-band__mark')).toHaveCount(2);
  await expect(band.locator('.ui-showcase-band__item')).toHaveCount(2);
  await expect(band.locator('.ui-showcase-band__sep')).toHaveCount(1);
  await expect(band.locator('.ui-showcase-band__value').first()).toHaveText('Гран-при Лас-Вегаса');
  await expect(band.locator('.ui-countdown--board')).toBeVisible();
  await expect(band.locator('.ui-showcase-band__action .ui-button')).toHaveCount(1);

  const track = showcase.locator('.ui-week-track');
  await expect(track).toBeVisible();
  await expect(track.locator('.ui-week-track__event')).toHaveCount(8);
  await expect(track.locator('.ui-week-track__flag')).toHaveCount(2);
  await expect(track.locator('.ui-week-track__flag').first()).toHaveCSS('width', '22px');
  await expect(track.locator('.ui-week-track__now')).toHaveCount(1);
  await expect(track.locator('.ui-week-track__now-stem')).toBeVisible();
  await expect(track.locator('.ui-week-track__now-dot')).toBeVisible();
  await expect(track.locator('.ui-week-track__now-label')).toHaveText('сейчас · 19:30');
  await expect(track.locator('.ui-week-track__day-label')).toHaveCount(7);
  await expect(track.locator('.ui-week-track__featured')).toHaveText('главный матч');
});

/* The three wide plates fit their row without scrolling, every name stops
   before its time, the band boxes do not touch, and the week events stay on
   the correct side of «сейчас» at both reviewed widths. */
for (const width of [1100, 1440]) {
  test(`kit showcase fits the wide shelf and the band at ${width}`, async ({ page }) => {
    await stubCrests(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/dev/kit.html?scheme=dark');

    const data = await page.evaluate(() => {
      const wide = document.querySelector('#kit-showcase .ui-showcase-shelf--wide')!;
      const row = wide.querySelector<HTMLElement>('.ui-showcase-shelf__row')!;
      const plates = Array.from(wide.querySelectorAll('.ui-showcase-upcoming')).map((plate) => {
        const when = plate.querySelector('.ui-showcase-upcoming__when')!.getBoundingClientRect();
        const names = Array.from(plate.querySelectorAll('.ui-showcase-upcoming__name')).map(
          (name) => {
            const box = name.getBoundingClientRect();
            return { text: name.textContent ?? '', right: box.right };
          },
        );
        return { whenLeft: when.left, names };
      });

      const band = document.querySelector('#kit-showcase .ui-showcase-band')!;
      const items = band.querySelector('.ui-showcase-band__items')!.getBoundingClientRect();
      const action = band.querySelector('.ui-showcase-band__action')!.getBoundingClientRect();
      const boxes = Array.from(
        band.querySelectorAll(
          '.ui-showcase-band__plate, .ui-showcase-band__checks, .ui-showcase-band__item, .ui-showcase-band__sep, .ui-showcase-band__action, .ui-showcase-band__value .ui-countdown__cell',
        ),
      )
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && element.getClientRects().length > 0;
        })
        .map((element) => ({ element, box: element.getBoundingClientRect() }));
      const overlaps: string[] = [];
      for (let first = 0; first < boxes.length; first += 1) {
        for (let second = first + 1; second < boxes.length; second += 1) {
          const a = boxes[first]!;
          const b = boxes[second]!;
          if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
          if (
            a.box.right > b.box.left + 0.5 &&
            b.box.right > a.box.left + 0.5 &&
            a.box.bottom > b.box.top + 0.5 &&
            b.box.bottom > a.box.top + 0.5
          ) {
            overlaps.push(`${a.element.className} / ${b.element.className}`);
          }
        }
      }

      const track = document.querySelector('#kit-showcase .ui-week-track')!;
      const nowBox = track.querySelector('.ui-week-track__now')!.getBoundingClientRect();
      const events = Array.from(track.querySelectorAll('.ui-week-track__slot')).map((slot) => {
        const event = slot.querySelector('.ui-week-track__event')!;
        const box = slot.getBoundingClientRect();
        return {
          center: box.left + box.width / 2,
          past: event.classList.contains('ui-week-track__event--past'),
        };
      });

      return {
        row: { client: row.clientWidth, scroll: row.scrollWidth },
        backDisabled: (wide.querySelector('[aria-label="Назад"]') as HTMLButtonElement).disabled,
        forwardDisabled: (wide.querySelector('[aria-label="Вперёд"]') as HTMLButtonElement)
          .disabled,
        plates,
        band: { itemsRight: items.right, actionLeft: action.left, overlaps },
        nowCenter: nowBox.left + nowBox.width / 2,
        events,
      };
    });

    expect(data.row.scroll).toBeLessThanOrEqual(data.row.client + 1);
    expect(data.backDisabled).toBe(true);
    expect(data.forwardDisabled).toBe(true);
    for (const plate of data.plates) {
      for (const name of plate.names) {
        expect(name.right, name.text).toBeLessThanOrEqual(plate.whenLeft + 0.5);
      }
    }
    expect(data.band.itemsRight).toBeLessThanOrEqual(data.band.actionLeft + 0.5);
    expect(data.band.overlaps).toEqual([]);
    for (const event of data.events) {
      if (event.past) expect(event.center).toBeLessThan(data.nowCenter);
      else expect(event.center).toBeGreaterThan(data.nowCenter);
    }
  });
}

/* At 1100 three cards fit, so the fourth one is one page away: the previous
   arrow is off at the start and the next arrow is off at the end. */
test('kit showcase shelf arrows are disabled at the ends', async ({ page }) => {
  await stubCrests(page);
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

/* The week track is one tab stop per event; the arrows move along the events
   in time order and the tooltip follows the focus. */
test('kit showcase week track moves focus with the arrows', async ({ page }) => {
  await stubCrests(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dev/kit.html?scheme=dark');
  const track = page.locator('#kit-showcase .ui-week-track');
  const events = track.locator('.ui-week-track__event');
  await expect(events).toHaveCount(8);

  await events.first().focus();
  await expect(events.first()).toBeFocused();
  const tip = track.locator('.ui-week-track__tip');
  await expect(tip).toHaveAttribute('role', 'tooltip');
  await expect(tip).toContainText('Atalanta — Bologna');

  await page.keyboard.press('ArrowRight');
  await expect(events.nth(1)).toBeFocused();
  await expect(tip).toContainText('Manchester United — Roma');

  await page.keyboard.press('ArrowLeft');
  await expect(events.first()).toBeFocused();
  await expect(tip).toContainText('Atalanta — Bologna');
});

/* A list is built from separate grids, so the fixed time and competition tracks
   must keep the score in one column even with different names. */
test('kit match row scores line up in a list', async ({ page }) => {
  await stubCrests(page);
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
