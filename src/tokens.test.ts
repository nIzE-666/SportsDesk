import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEAGUES } from './lib/navigationMetadata';

/* The contract of src/tokens.css: every color token is a plain hex or rgb()
   value, the dark scheme is the default, and every text, accent and meaning
   color keeps the contrast from section 5.2 of the UI plan. */

const source = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

interface Block {
  selector: string;
  declarations: Record<string, string>;
}

function parseBlocks(css: string): Block[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: Block[] = [];
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of withoutComments.matchAll(blockPattern)) {
    const selector = match[1]!.trim();
    const declarations: Record<string, string> = {};
    for (const entry of match[2]!.split(';')) {
      const colon = entry.indexOf(':');
      if (colon === -1) continue;
      const name = entry.slice(0, colon).trim();
      if (!name.startsWith('--')) continue;
      declarations[name] = entry.slice(colon + 1).trim();
    }
    blocks.push({ selector, declarations });
  }
  return blocks;
}

const blocks = parseBlocks(source);

function declarationsOf(selector: string): Record<string, string> {
  const block = blocks.find((candidate) => candidate.selector === selector);
  if (!block) throw new Error(`src/tokens.css has no rule for ${selector}`);
  return block.declarations;
}

const THEMES = [...new Set([...LEAGUES.map((league) => league.theme), 'f1', 'ucl'])].sort();
const darkThemeSelector = (theme: string) => `.app-root[data-theme='${theme}']`;
const lightThemeSelector = (theme: string) =>
  `.app-root[data-scheme='light'][data-theme='${theme}']`;

const base = declarationsOf('.app-root');
const light = declarationsOf(".app-root[data-scheme='light']");

const SURFACES = ['--color-bg', '--color-surface-1', '--color-surface-2', '--color-surface-3'];
const BORDERS = ['--color-border', '--color-border-strong'];
const TEXT = [
  '--color-text',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-disabled',
];
const ACCENT = ['--color-accent', '--color-accent-soft', '--color-on-accent'];
const MEANING = [
  '--color-live',
  '--color-win',
  '--color-draw',
  '--color-loss',
  '--color-warning',
  '--color-error',
];
const CHARTS = Array.from({ length: 8 }, (_, index) => `--color-chart-${index + 1}`);
const TYRES = [
  '--color-tyre-soft',
  '--color-tyre-medium',
  '--color-tyre-hard',
  '--color-tyre-inter',
  '--color-tyre-wet',
  '--color-tyre-unknown',
];
const COLOR_TOKENS = [...SURFACES, ...BORDERS, ...TEXT, ...ACCENT, ...MEANING, ...CHARTS, ...TYRES];
// Tyre colors are the real compound colors and stay the same in both schemes.
const SCHEME_COLORS = [...SURFACES, ...BORDERS, ...TEXT, ...ACCENT, ...MEANING, ...CHARTS];

const REQUIRED_TOKENS = [
  ...COLOR_TOKENS,
  '--font-family',
  ...['12', '13', '14', '16', '20', '24', '32'].map((step) => `--text-${step}`),
  '--weight-regular',
  '--weight-medium',
  '--weight-semibold',
  '--weight-bold',
  '--line-body',
  '--line-heading',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-round',
  ...['4', '8', '12', '16', '24', '32', '48'].map((step) => `--space-${step}`),
  '--control-sm',
  '--control-md',
  '--control-lg',
  '--shadow-1',
  '--shadow-2',
  '--layer-sticky',
  '--layer-header',
  '--layer-drawer',
  '--layer-dialog',
  '--layer-toast',
  '--layer-tooltip',
  '--duration-hover',
  '--duration-page',
  '--ease',
];

type Scheme = 'dark' | 'light';

function palette(scheme: Scheme, theme: string | null): Record<string, string> {
  const layers = [base];
  if (scheme === 'light') layers.push(light);
  if (theme)
    layers.push(
      declarationsOf(scheme === 'light' ? lightThemeSelector(theme) : darkThemeSelector(theme)),
    );
  return Object.assign({}, ...layers);
}

const schemes: { scheme: Scheme; theme: string | null }[] = [];
for (const scheme of ['dark', 'light'] as const) {
  schemes.push({ scheme, theme: null });
  for (const theme of THEMES) schemes.push({ scheme, theme });
}

type Rgb = [number, number, number];

function parseColor(value: string): Rgb {
  const text = value.trim();
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (shortHex) {
    return [
      parseInt(shortHex[1]! + shortHex[1]!, 16),
      parseInt(shortHex[2]! + shortHex[2]!, 16),
      parseInt(shortHex[3]! + shortHex[3]!, 16),
    ];
  }
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (hex) {
    return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
  }
  const rgb = /^rgb\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)$/i.exec(text);
  if (rgb) {
    const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (channels.every((channel) => channel >= 0 && channel <= 255)) {
      return channels as Rgb;
    }
  }
  throw new Error(`Token value is not a plain hex or rgb() color: ${value}`);
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(foreground: string, background: string): number {
  const first = relativeLuminance(parseColor(foreground));
  const second = relativeLuminance(parseColor(background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function expectContrast(
  foreground: string,
  background: string,
  minimum: number,
  label: string,
): void {
  const ratio = contrast(foreground, background);
  if (ratio < minimum) {
    throw new Error(
      `${label}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
    );
  }
}

describe('design tokens', () => {
  it('defines every token on .app-root', () => {
    const missing = REQUIRED_TOKENS.filter((token) => base[token] === undefined);
    expect(missing).toEqual([]);
  });

  it('uses the dark scheme by default and overrides the colors for light', () => {
    expect(relativeLuminance(parseColor(base['--color-bg']!))).toBeLessThan(0.1);
    expect(relativeLuminance(parseColor(light['--color-bg']!))).toBeGreaterThan(0.5);
    for (const token of SCHEME_COLORS) {
      expect(light[token], `${token} is missing from the light scheme`).toBeDefined();
    }
  });

  it('covers every tournament theme of the app', () => {
    const defined = blocks
      .map((block) => /^\.app-root\[data-theme='([a-z0-9]+)'\]$/.exec(block.selector)?.[1])
      .filter((theme): theme is string => theme !== undefined)
      .sort();
    expect(defined).toEqual(THEMES);
  });

  it('lets a tournament change only the accent tokens', () => {
    for (const theme of THEMES) {
      for (const scheme of ['dark', 'light'] as const) {
        const declarations = declarationsOf(
          scheme === 'light' ? lightThemeSelector(theme) : darkThemeSelector(theme),
        );
        expect(Object.keys(declarations).sort(), `${scheme} ${theme}`).toEqual([...ACCENT].sort());
      }
    }
  });

  it('keeps every color token a plain hex or rgb() value', () => {
    for (const { scheme, theme } of schemes) {
      const values = palette(scheme, theme);
      for (const token of COLOR_TOKENS) {
        expect(
          () => parseColor(values[token]!),
          `${scheme} ${theme ?? 'neutral'} ${token}`,
        ).not.toThrow();
      }
    }
  });

  describe('contrast', () => {
    for (const { scheme, theme } of schemes) {
      const name = `${scheme} ${theme ?? 'neutral'}`;
      it(`${name}: text levels stand out from every surface`, () => {
        const values = palette(scheme, theme);
        for (const surface of SURFACES) {
          expectContrast(
            values['--color-text']!,
            values[surface]!,
            4.5,
            `${name} text on ${surface}`,
          );
          expectContrast(
            values['--color-text-secondary']!,
            values[surface]!,
            4.5,
            `${name} secondary text on ${surface}`,
          );
          expectContrast(
            values['--color-text-tertiary']!,
            values[surface]!,
            3,
            `${name} tertiary text on ${surface}`,
          );
        }
      });

      it(`${name}: the accent and text on it are readable`, () => {
        const values = palette(scheme, theme);
        for (const surface of ['--color-bg', '--color-surface-1', '--color-surface-2']) {
          expectContrast(
            values['--color-accent']!,
            values[surface]!,
            3,
            `${name} accent on ${surface}`,
          );
        }
        expectContrast(
          values['--color-on-accent']!,
          values['--color-accent']!,
          4.5,
          `${name} text on the accent`,
        );
      });

      it(`${name}: meaning colors are readable`, () => {
        const values = palette(scheme, theme);
        for (const token of MEANING) {
          for (const surface of ['--color-bg', '--color-surface-1']) {
            expectContrast(values[token]!, values[surface]!, 3, `${name} ${token} on ${surface}`);
          }
        }
      });
    }
  });
});
