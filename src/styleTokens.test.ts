import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/* Section 5.2 of the UI plan: no raw colors, font sizes or radii outside
   src/tokens.css. Every font size is one of the seven text tokens, every
   radius one of the four radius tokens, and no old button class survives. */

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');
const TOKENS_FILE = 'src/tokens.css';

const NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
  blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
  crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
  darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
  dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
  gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
  lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
  magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
  mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
  mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
  powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
  seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
  steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
  yellowgreen`.split(/\s+/),
);
const ALLOWED_COLOR_WORDS = new Set(['transparent', 'currentcolor', 'inherit']);
const COLOR_PROPERTY =
  /^(?:color|background|background-color|background-image|border|border-(?:top|right|bottom|left)|border-(?:top|right|bottom|left)-color|border-color|border-block(?:-start|-end)?(?:-color)?|border-inline(?:-start|-end)?(?:-color)?|border-image|border-image-source|outline|outline-color|box-shadow|text-shadow|text-decoration|text-decoration-color|text-emphasis-color|column-rule|column-rule-color|filter|mask|mask-image|fill|stroke|stop-color|flood-color|lighting-color|accent-color|caret-color|scrollbar-color|-webkit-text-fill-color|-webkit-text-stroke-color)$/;

const TEXT_TOKENS = new Set([
  '--text-12',
  '--text-13',
  '--text-14',
  '--text-16',
  '--text-20',
  '--text-24',
  '--text-32',
]);
const RADIUS_TOKENS = new Set(['--radius-sm', '--radius-md', '--radius-lg', '--radius-round']);
const TOKEN_VALUE = /^var\((--[a-z0-9-]+)\)$/i;

/** Old element classes that the kit replaced; no screen may name them again. */
export const OLD_BUTTON_CLASSES = [
  'primary-btn',
  'ghost-btn',
  'icon-button',
  'link-btn',
  'badge-btn',
  'f1-btn',
  'watch-btn',
  'watch-link-btn',
  'watch-filter-btn',
  'watch-fav-chip',
  'player-name-button',
  'player-photo-button',
  'live-flat-button',
  'my-chip',
  'text-link',
  'chip',
  'live-chip',
  'stale-chip',
  'segmented',
] as const;

interface Counts {
  colors: number;
  fontSizes: number;
  radii: number;
}

interface Declaration {
  property: string;
  value: string;
}

function filesWithExtension(dir: string, extension: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesWithExtension(path, extension, found);
    else if (entry.isFile() && entry.name.endsWith(extension)) found.push(path);
  }
  return found;
}

function declarations(css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Declaration[] = [];
  const pattern = /(?:^|[;{])\s*([-a-zA-Z][-a-zA-Z0-9]*)\s*:\s*([^;{}]*)/g;
  for (const match of text.matchAll(pattern)) {
    found.push({ property: match[1]!.toLowerCase(), value: match[2]!.trim() });
  }
  return found;
}

function namedColorsIn(value: string): number {
  let count = 0;
  for (const word of value.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (!ALLOWED_COLOR_WORDS.has(word) && NAMED_COLORS.has(word)) count += 1;
  }
  return count;
}

function isTextToken(value: string): boolean {
  const token = TOKEN_VALUE.exec(value);
  return token !== null && TEXT_TOKENS.has(token[1]!);
}

function isRadiusToken(value: string): boolean {
  const token = TOKEN_VALUE.exec(value);
  return token !== null && RADIUS_TOKENS.has(token[1]!);
}

function countInFile(css: string): Counts {
  const counts: Counts = { colors: 0, fontSizes: 0, radii: 0 };
  for (const { property, value } of declarations(css)) {
    const clean = value.replace(/\s*!important\s*$/i, '').trim();
    const hexColors = clean.match(/#[0-9a-f]{3,8}\b/gi)?.length ?? 0;
    const colorFunctions = clean.match(/\b(?:rgba?|hsla?)\(/gi)?.length ?? 0;
    const namedColors =
      COLOR_PROPERTY.test(property) || property.startsWith('--') ? namedColorsIn(clean) : 0;
    counts.colors += hexColors + colorFunctions + namedColors;

    if (property === 'font-size' && !isTextToken(clean)) counts.fontSizes += 1;

    const radiusParts = clean.split(/\s+/);
    const radiusIsToken = radiusParts.every(
      (part) => isRadiusToken(part) || part === '0' || part === 'inherit',
    );
    if (property.endsWith('border-radius') && !radiusIsToken) counts.radii += 1;
  }
  return counts;
}

const total = (counts: Counts): number => counts.colors + counts.fontSizes + counts.radii;

function relativePath(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

function classOffenders(text: string, classNames: readonly string[]): string[] {
  return classNames.filter((name) => {
    const pattern = new RegExp(`(^|[^a-zA-Z0-9_-])${name}([^a-zA-Z0-9_-]|$)`);
    return pattern.test(text);
  });
}

const files = filesWithExtension(SRC_DIR, '.css')
  .map(relativePath)
  .filter((file) => file !== TOKENS_FILE)
  .sort();
const counts = new Map(
  files.map((file) => [file, countInFile(readFileSync(join(ROOT, file), 'utf8'))]),
);
const tsxFiles = filesWithExtension(SRC_DIR, '.tsx').map(relativePath).sort();

describe('style tokens', () => {
  it('finds no raw colors, font sizes or radii outside src/tokens.css', () => {
    const offenders = files
      .map((file) => ({ file, ...counts.get(file)! }))
      .filter((file) => total(file) > 0);
    expect(offenders).toEqual([]);
  });

  it('names no old button class in a TSX file', () => {
    const offenders = tsxFiles
      .map((file) => ({
        file,
        classes: classOffenders(readFileSync(join(ROOT, file), 'utf8'), OLD_BUTTON_CLASSES),
      }))
      .filter((entry) => entry.classes.length > 0);
    expect(offenders).toEqual([]);
  });

  it('detects raw colors, font sizes and radii', () => {
    expect(
      countInFile(
        `.sample {
          color: #fff;
          background: rgba(0, 0, 0, 0.5);
          border-color: hsl(210 40% 50%);
          font-size: 12px;
          border-radius: 8px;
        }`,
      ),
    ).toEqual({ colors: 3, fontSizes: 1, radii: 1 });
  });

  it('detects named colors in color values only', () => {
    expect(
      countInFile(`.sample { color: white; background: linear-gradient(black, transparent); }`),
    ).toEqual({ colors: 2, fontSizes: 0, radii: 0 });
    expect(
      countInFile(
        `.sample { background-image: linear-gradient(white, black); filter: drop-shadow(0 0 2px red); }`,
      ),
    ).toEqual({ colors: 3, fontSizes: 0, radii: 0 });
    expect(countInFile(`.sample { white-space: nowrap; animation: white-fade 1s; }`)).toEqual({
      colors: 0,
      fontSizes: 0,
      radii: 0,
    });
  });

  it('accepts the seven text tokens and the allowed radius values', () => {
    expect(
      countInFile(
        `.sample {
          color: var(--color-text);
          background: transparent;
          border-color: currentColor;
          outline-color: inherit;
          font-size: var(--text-14);
          border-radius: var(--radius-md) 0 inherit;
        }`,
      ),
    ).toEqual({ colors: 0, fontSizes: 0, radii: 0 });
  });

  it('rejects text and radius variables outside the token set', () => {
    expect(
      countInFile(
        `.sample {
          font-size: var(--text-15);
          border-radius: var(--radius-xl) 50%;
        }`,
      ),
    ).toEqual({ colors: 0, fontSizes: 1, radii: 1 });
  });

  it('detects an old button class as a whole word', () => {
    expect(classOffenders(`<button className="ghost-btn">Открыть</button>`, ['ghost-btn'])).toEqual(
      ['ghost-btn'],
    );
    expect(classOffenders(`<div className="ui-segmented" />`, ['segmented'])).toEqual([]);
    expect(classOffenders(`<div className="f1-team-chip" />`, ['chip'])).toEqual([]);
  });
});
