import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { screenTour } from './screenTour';

// Проверяет контраст каждой видимой строки на всех состояниях экранов в обеих темах.
// Требования раздела 5.2 плана: основной и вторичный текст — не меньше 4.5:1,
// третичный — не меньше 3:1. Крупный текст (24 px или 18.66 px при весе 700)
// тоже довольствуется 3:1. Неактивные элементы исключены, как в WCAG.
const TOKENS = [
  '--color-text',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-disabled',
  '--color-accent',
  '--color-on-accent',
  '--color-live',
  '--color-win',
  '--color-draw',
  '--color-loss',
  '--color-warning',
  '--color-error',
] as const;

type Theme = 'dark' | 'light';

type InventoryEntry = {
  stop: string;
  theme: Theme;
  text: string;
  role: string;
  fontSize: number;
  fontWeight: number;
  color?: string;
};

type ContrastFailure = {
  stop: string;
  theme: Theme;
  text: string;
  location: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
};

type StopResult = {
  theme: Theme;
  stop: string;
  checked: number;
  skipped: string[];
  covered: string[];
  reachedByScroll: number;
  failures: ContrastFailure[];
  entries: InventoryEntry[];
};

async function auditStop(page: Page, theme: Theme, stop: string): Promise<StopResult> {
  return page.evaluate(
    ({ theme, stop, tokens }) => {
      type Rgba = { r: number; g: number; b: number; a: number };
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      function parseRaw(value: string): Rgba | null {
        const text = value.trim().toLowerCase();
        if (!text || text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
        const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/u.exec(text);
        if (hex) {
          const rgb = hex[1]!;
          return {
            r: Number.parseInt(rgb.slice(0, 2), 16),
            g: Number.parseInt(rgb.slice(2, 4), 16),
            b: Number.parseInt(rgb.slice(4, 6), 16),
            a: hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1,
          };
        }
        const short = /^#([0-9a-f]{3})$/u.exec(text);
        if (short) {
          const rgb = short[1]!;
          return {
            r: Number.parseInt(rgb[0]! + rgb[0]!, 16),
            g: Number.parseInt(rgb[1]! + rgb[1]!, 16),
            b: Number.parseInt(rgb[2]! + rgb[2]!, 16),
            a: 1,
          };
        }
        const rgb = /^rgba?\(([^)]+)\)$/u.exec(text);
        if (rgb) {
          const parts = rgb[1]!.split(/[\s,/]+/u).filter(Boolean);
          if (parts.length >= 3) {
            const channel = (part: string) =>
              part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part);
            const alpha = parts[3]
              ? parts[3].endsWith('%')
                ? Number.parseFloat(parts[3]) / 100
                : Number.parseFloat(parts[3])
              : 1;
            return {
              r: channel(parts[0]!),
              g: channel(parts[1]!),
              b: channel(parts[2]!),
              a: Number.isFinite(alpha) ? alpha : 1,
            };
          }
        }
        const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/u.exec(
          text,
        );
        if (srgb) {
          return {
            r: Number.parseFloat(srgb[1]!) * 255,
            g: Number.parseFloat(srgb[2]!) * 255,
            b: Number.parseFloat(srgb[3]!) * 255,
            a: srgb[4] ? Number.parseFloat(srgb[4]) : 1,
          };
        }
        return null;
      }

      function parseColor(value: string): Rgba {
        const direct = parseRaw(value);
        if (direct) return direct;
        if (context) {
          context.fillStyle = '#000000';
          context.fillStyle = value;
          const normalized = parseRaw(context.fillStyle);
          if (normalized) return normalized;
        }
        return { r: 0, g: 0, b: 0, a: 1 };
      }

      const opacityOf = (style: CSSStyleDeclaration): number => {
        const value = Number.parseFloat(style.opacity);
        return Number.isFinite(value) ? value : 1;
      };

      const mix = (top: Rgba, bottom: Rgba): Rgba => {
        const alpha = top.a + bottom.a * (1 - top.a);
        if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
        return {
          r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
          g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
          b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
          a: alpha,
        };
      };

      type ImageKind = 'none' | 'gradient' | 'picture';
      const imageKind = (image: string): ImageKind => {
        if (!image || image === 'none') return 'none';
        const value = image.toLowerCase();
        if (
          value.includes('url(') ||
          value.includes('repeating-linear-gradient(') ||
          value.includes('repeating-radial-gradient(') ||
          value.includes('repeating-conic-gradient(') ||
          value.includes('conic-gradient(')
        )
          return 'picture';
        if (value.includes('linear-gradient(') || value.includes('radial-gradient('))
          return 'gradient';
        return 'picture';
      };
      const gradientStops = (image: string): Rgba[] => {
        const matches =
          image.match(/(?:rgba?|color)\([^()]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/giu) ?? [];
        const stops = matches.map(parseColor);
        return stops.length ? stops : [parseColor('transparent')];
      };

      const rgb = (color: Rgba) =>
        `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;
      const hex = (color: Rgba) =>
        `#${[color.r, color.g, color.b]
          .map((channel) =>
            Math.max(0, Math.min(255, Math.round(channel)))
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`;
      const display = (color: Rgba) =>
        color.a >= 0.999
          ? hex(color)
          : `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Number(color.a.toFixed(3))})`;

      function luminance(color: Rgba): number {
        const linear = (value: number) => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
      }

      function contrast(first: Rgba, second: Rgba): number {
        const one = luminance(first);
        const two = luminance(second);
        return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
      }

      function pageBackground(): Rgba {
        const layers: Rgba[] = [];
        for (const element of [
          document.documentElement,
          document.body,
          document.querySelector('.app-root'),
        ]) {
          if (!element) continue;
          const style = getComputedStyle(element);
          const color = parseColor(style.backgroundColor);
          if (color.a > 0) {
            layers.push({ ...color, a: color.a * opacityOf(style) });
          }
        }
        let result: Rgba = { r: 255, g: 255, b: 255, a: 1 };
        for (const layer of layers) result = mix(layer, result);
        return result.a >= 0.999 ? result : { r: 255, g: 255, b: 255, a: 1 };
      }

      function elementOpacity(element: Element): number {
        let opacity = 1;
        for (let current: Element | null = element; current; current = current.parentElement) {
          const value = Number.parseFloat(getComputedStyle(current).opacity);
          if (Number.isFinite(value)) opacity *= value;
        }
        return opacity;
      }

      function isVisible(element: Element): boolean {
        const style = getComputedStyle(element);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse'
        )
          return false;
        if (!element.getClientRects().length) return false;
        return elementOpacity(element) > 0;
      }

      function textRect(range: Range): DOMRect | null {
        const rects = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        if (!rects.length) return null;
        const first = rects[0]!;
        let left = first.left;
        let top = first.top;
        let right = first.right;
        let bottom = first.bottom;
        for (const rect of rects.slice(1)) {
          left = Math.min(left, rect.left);
          top = Math.min(top, rect.top);
          right = Math.max(right, rect.right);
          bottom = Math.max(bottom, rect.bottom);
        }
        return new DOMRect(left, top, right - left, bottom - top);
      }

      /** Text behind an open modal dialog is not part of the stop, not even the inventory. */
      function behindModal(element: Element): boolean {
        const scrim = document.querySelector('.ui-dialog-scrim');
        if (!scrim) return false;
        const dialog = scrim.querySelector('.ui-dialog');
        return dialog ? !dialog.contains(element) : false;
      }

      /**
       * The point is reachable when it is inside the window and the text layer
       * or one of its ancestors is in the hit-test stack with only transparent
       * elements above it. `stack` starts at that text layer.
       */
      function reachableAt(
        element: Element,
        range: Range,
      ): { stack: Element[]; index: number } | null {
        const rect = textRect(range);
        if (!rect) return null;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
        const stack = document.elementsFromPoint(x, y);
        const index = stack.findIndex((node) => node === element || node.contains(element));
        if (index < 0) return null;
        for (let above = 0; above < index; above += 1) {
          const style = getComputedStyle(stack[above]!);
          if (style.backgroundImage !== 'none') return null;
          if (parseColor(style.backgroundColor).a * opacityOf(style) > 0) return null;
        }
        return { stack, index };
      }

      const sameColor = (first: Rgba, second: Rgba): boolean => {
        return (
          Math.abs(first.r - second.r) <= 1 &&
          Math.abs(first.g - second.g) <= 1 &&
          Math.abs(first.b - second.b) <= 1 &&
          Math.abs(first.a - second.a) <= 0.01
        );
      };
      const uniqueColors = (colors: Rgba[]): Rgba[] => {
        const result: Rgba[] = [];
        for (const color of colors) {
          if (!result.some((known) => sameColor(known, color))) result.push(color);
        }
        return result;
      };

      /**
       * Measures from the text layer downwards. Gradients of token colours are
       * blended stop by stop over the layers beneath them; a repeating or conic
       * gradient, a url image or a media element is still a picture.
       */
      function measureBackground(stack: Element[]): { colors: Rgba[]; overPicture: boolean } {
        const measured: { style: CSSStyleDeclaration; kind: ImageKind }[] = [];
        for (const element of stack) {
          const style = getComputedStyle(element);
          const kind = imageKind(style.backgroundImage);
          if (
            kind === 'picture' ||
            element.tagName === 'IMG' ||
            element.tagName === 'VIDEO' ||
            element.tagName === 'CANVAS'
          ) {
            return { colors: [pageBackground()], overPicture: true };
          }
          const color = parseColor(style.backgroundColor);
          measured.push({ style, kind });
          if (color.a * opacityOf(style) >= 0.999) break;
        }

        let results: Rgba[] = [pageBackground()];
        for (let index = measured.length - 1; index >= 0; index -= 1) {
          const { style, kind } = measured[index]!;
          const opacity = opacityOf(style);
          const color = parseColor(style.backgroundColor);
          const background = { ...color, a: color.a * opacity };
          const next: Rgba[] = [];
          for (const below of results) {
            const under = mix(background, below);
            if (kind === 'gradient') {
              for (const stop of gradientStops(style.backgroundImage))
                next.push(mix({ ...stop, a: stop.a * opacity }, under));
            } else {
              next.push(under);
            }
          }
          results = uniqueColors(next);
        }
        return { colors: results.length ? results : [pageBackground()], overPicture: false };
      }

      // Scroll each stop only when the next text is out of reach, then put the
      // page and every scrolled element back exactly where they were.
      let scrollSaved = false;
      let windowScroll = { x: 0, y: 0 };
      const elementScrolls: Array<{ element: HTMLElement; top: number; left: number }> = [];
      function saveScrolls() {
        if (scrollSaved) return;
        scrollSaved = true;
        windowScroll = { x: window.scrollX, y: window.scrollY };
        for (const element of Array.from(document.querySelectorAll('*'))) {
          if (!(element instanceof HTMLElement)) continue;
          if (
            element.scrollTop ||
            element.scrollLeft ||
            element.scrollHeight > element.clientHeight ||
            element.scrollWidth > element.clientWidth
          )
            elementScrolls.push({
              element,
              top: element.scrollTop,
              left: element.scrollLeft,
            });
        }
      }
      function restoreScrolls() {
        if (!scrollSaved) return;
        for (const saved of elementScrolls) {
          saved.element.scrollTop = saved.top;
          saved.element.scrollLeft = saved.left;
        }
        window.scrollTo({ left: windowScroll.x, top: windowScroll.y, behavior: 'instant' });
      }
      function scrollToText(element: Element): boolean {
        saveScrolls();
        try {
          element.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: 'instant',
          });
          return true;
        } catch {
          return false;
        }
      }

      const failures: {
        stop: string;
        theme: 'dark' | 'light';
        text: string;
        location: string;
        foreground: string;
        background: string;
        ratio: number;
        required: number;
      }[] = [];
      const entries: {
        stop: string;
        theme: 'dark' | 'light';
        text: string;
        role: string;
        fontSize: number;
        fontWeight: number;
        color?: string;
      }[] = [];
      const skipped: string[] = [];
      const covered: string[] = [];
      let reachedByScroll = 0;
      let checked = 0;
      const describe = (element: Element) => {
        const parts: string[] = [];
        for (let current: Element | null = element; current && parts.length < 3;) {
          const classes =
            typeof current.className === 'string'
              ? current.className.split(/\s+/u).filter(Boolean).slice(0, 3).join('.')
              : '';
          parts.push(`${current.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`);
          current = current.parentElement;
        }
        return parts.join(' < ');
      };

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.nodeValue && node.nodeValue.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement;
        if (!element || !isVisible(element)) continue;
        const text = (node.nodeValue ?? '').replace(/\s+/gu, ' ').trim();
        if (!text) continue;
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize);
        if (!Number.isFinite(fontSize) || fontSize <= 0) continue;
        const rawWeight = style.fontWeight;
        const fontWeight =
          rawWeight === 'bold'
            ? 700
            : rawWeight === 'normal'
              ? 400
              : Number.parseInt(rawWeight, 10) || 400;
        const foreground = parseColor(style.color);
        const opacity = elementOpacity(element);
        const alpha = foreground.a * opacity;
        if (alpha <= 0.001) continue;
        if (behindModal(element)) continue;
        const disabled = element.closest(':disabled, [aria-disabled="true"]') !== null;
        const role =
          tokens.find((token) =>
            sameColor(foreground, parseColor(style.getPropertyValue(token))),
          ) ?? 'other';
        entries.push({
          stop,
          theme,
          text: text.slice(0, 120),
          role,
          fontSize,
          fontWeight,
          ...(role === 'other' ? { color: display(foreground) } : {}),
        });

        const range = document.createRange();
        range.selectNodeContents(node);
        let reached = reachableAt(element, range);
        let didScroll = false;
        if (!reached) {
          didScroll = scrollToText(element);
          if (didScroll) reached = reachableAt(element, range);
        }
        if (!reached) {
          covered.push(text.slice(0, 40));
          continue;
        }
        if (didScroll) reachedByScroll += 1;

        const background = measureBackground(reached.stack.slice(reached.index));
        if (background.overPicture) {
          skipped.push(text.slice(0, 40));
          continue;
        }
        if (disabled) continue;

        const tertiary = sameColor(
          foreground,
          parseColor(style.getPropertyValue('--color-text-tertiary')),
        );
        const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        const required = large || tertiary ? 3 : 4.5;
        let worstColor = background.colors[0]!;
        let worstRatio = Number.POSITIVE_INFINITY;
        for (const color of background.colors) {
          const effective = mix({ ...foreground, a: alpha }, color);
          const ratio = contrast(effective, color);
          if (ratio < worstRatio) {
            worstRatio = ratio;
            worstColor = color;
          }
        }
        checked += 1;
        if (worstRatio + 0.005 < required) {
          failures.push({
            stop,
            theme,
            text: text.slice(0, 40),
            location: describe(element),
            foreground: display(foreground),
            background: display(worstColor),
            ratio: Number(worstRatio.toFixed(2)),
            required,
          });
        }
      }

      restoreScrolls();
      return { theme, stop, checked, skipped, covered, reachedByScroll, failures, entries };
    },
    { theme, stop, tokens: TOKENS as unknown as string[] },
  );
}

test('every visible text has enough contrast in both themes', async ({ page }) => {
  test.setTimeout(480000);
  const results: StopResult[] = [];
  for (const theme of ['dark', 'light'] as const) {
    await screenTour(
      page,
      async (stop, options) => {
        results.push(await auditStop(options.on ?? page, theme, stop));
      },
      { scheme: theme },
    );
  }

  const output = process.env.SPORTSDESK_INVENTORY_OUTPUT;
  if (output) {
    const entries = results.flatMap((result) => result.entries);
    await writeFile(output, JSON.stringify({ entries }, null, 2) + '\n');
  }

  for (const result of results) {
    if (result.skipped.length)
      console.log(
        `${result.theme} / ${result.stop}: skipped ${result.skipped.length} over a picture — ${result.skipped.join(' | ')}`,
      );
    if (result.covered.length)
      console.log(
        `${result.theme} / ${result.stop}: covered ${result.covered.length} — ${result.covered.join(' | ')}`,
      );
  }
  for (const theme of ['dark', 'light'] as const) {
    const list = results.filter((result) => result.theme === theme);
    const checked = list.reduce((sum, result) => sum + result.checked, 0);
    const skipped = list.reduce((sum, result) => sum + result.skipped.length, 0);
    const covered = list.reduce((sum, result) => sum + result.covered.length, 0);
    const reachedByScroll = list.reduce((sum, result) => sum + result.reachedByScroll, 0);
    console.log(
      `${theme}: checked ${checked} texts, skipped ${skipped} over pictures, ` +
        `covered ${covered}, reached by scrolling ${reachedByScroll}`,
    );
  }

  const failures = results.flatMap((result) => result.failures);
  expect(
    failures,
    failures
      .map(
        (failure) =>
          `${failure.theme} / ${failure.stop}: "${failure.text}" [${failure.location}] ` +
          `${failure.foreground} on ${failure.background} = ${failure.ratio}:1, ` +
          `needs ${failure.required}:1`,
      )
      .join('\n'),
  ).toEqual([]);
});
