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
