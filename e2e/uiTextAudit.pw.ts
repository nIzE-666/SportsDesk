import { writeFile } from 'node:fs/promises';
import { test, type Page } from '@playwright/test';
import { screenTour } from './screenTour';

// Запускается только явно: $env:SPORTSDESK_TEXT_OUTPUT='...'; npx playwright test e2e/uiTextAudit.pw.ts
// Выгружает пояснительные тексты состояний экранов (фиксированные данные, 1440 × 900) и считает элементы
// с шестью словами и больше: итоговая строка файла нужна для цели плана «не больше 80».
// Области: 29 состояний экранов; вкладки матча (завершённый матч без подробностей, с подробностями и ещё не
// начавшийся); мастер первого запуска; мини-окно. Последняя строка файла — общий итог по всем областям.

type Row = { tag: string; text: string; words: number };
type Section = { group: string; name: string; count: number; words: number };

async function collect(page: Page, root: string, extra: string): Promise<Row[]> {
  return page.evaluate(
    ({ root, extra }) => {
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.getClientRects().length > 0
        );
      };
      const scope = document.querySelector(root) ?? document.body;
      const seen = new Set<string>();
      const rows: { tag: string; text: string; words: number }[] = [];
      const selector =
        'p, small, .muted, .settings-note, .eyebrow, h1, h2, h3, [class*="lede"], [class*="hint"], [class*="note"], summary, label' +
        (extra ? `, ${extra}` : '');
      for (const el of Array.from(scope.querySelectorAll(selector))) {
        if (!visible(el)) continue;
        const text = (el as HTMLElement).innerText.replace(/\s+/gu, ' ').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        rows.push({ tag: el.tagName.toLowerCase(), text, words: text.split(' ').length });
      }
      return rows;
    },
    { root, extra },
  );
}

test('count explanatory texts on every screen', async ({ page }) => {
  const output = process.env.SPORTSDESK_TEXT_OUTPUT;
  test.skip(!output, 'Set SPORTSDESK_TEXT_OUTPUT to write the text list.');
  test.setTimeout(480000);
  const out: string[] = [];
  const sections: Section[] = [];
  /** Тексты, уже показанные в группе (шапка и действия матча повторяются на каждой вкладке). */
  const shared = new Map<string, Set<string>>();
  async function dump(
    name: string,
    options: { group?: string; on?: Page; root?: string; extra?: string; dedupe?: boolean } = {},
  ) {
    const target = options.on ?? page;
    const group = options.group ?? 'Экраны';
    const rows = await collect(target, options.root ?? 'main.content', options.extra ?? '');
    const known = shared.get(group) ?? new Set<string>();
    shared.set(group, known);
    const lines: string[] = [];
    let count = 0;
    let words = 0;
    for (const row of rows) {
      if (options.dedupe && known.has(row.text)) continue;
      known.add(row.text);
      if (/^h[1-3]$/u.test(row.tag)) lines.push(`  ${row.tag.toUpperCase()}: ${row.text}`);
      else if (row.words >= 6) {
        lines.push(`  · (${row.words}) ${row.text}`);
        count += 1;
        words += row.words;
      }
    }
    sections.push({ group, name, count, words });
    out.push(`\n=== ${group}: ${name} ===`, ...lines);
  }

  await screenTour(page, dump, { scheme: 'dark' });

  const groups = [...new Set(sections.map((section) => section.group))];
  const summary: string[] = ['\n### ПО ОБЛАСТЯМ'];
  let totalCount = 0;
  let totalWords = 0;
  for (const group of groups) {
    const list = sections.filter((section) => section.group === group);
    const count = list.reduce((sum, section) => sum + section.count, 0);
    const words = list.reduce((sum, section) => sum + section.words, 0);
    totalCount += count;
    totalWords += words;
    summary.push(`### ${group}: элементов ${count}, слов ${words}`);
    for (const section of list)
      if (section.count) summary.push(`    ${section.name}: ${section.count} / ${section.words}`);
  }
  out.push(...summary);
  out.push(
    `\n### ИТОГО: пояснительных элементов (6 слов и больше) ${totalCount}, слов ${totalWords}`,
  );
  await writeFile(output!, out.join('\n') + '\n');
});
