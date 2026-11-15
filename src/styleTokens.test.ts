import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/* Section 5.2 of the UI plan: no raw colors, font sizes or radii outside
   src/tokens.css. This check counts the places that still need moving.
   PENDING_FILES only shrinks: remove a file when it has no findings left. */

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');
const TOKENS_FILE = 'src/tokens.css';

export const PENDING_FILES: ReadonlySet<string> = new Set([
  'src/app/shell.css',
  'src/components/personAvatar.css',
  'src/components/searchSelect.css',
  'src/design.css',
  'src/features/atmosphere/atmosphere.css',
  'src/features/diary/diary.css',
  'src/features/f1/calendar.css',
  'src/features/f1/f1.css',
  'src/features/f1/racePace.css',
  'src/features/football/football.css',
  'src/features/football/matchAnalysis.css',
  'src/features/football/matchLineups.css',
  'src/features/football/matchStats.css',
  'src/features/football/mini.css',
  'src/features/football/playerForm.css',
  'src/features/football/players.css',
  'src/features/games/games.css',
  'src/features/my/my.css',
  'src/features/offline/offline.css',
  'src/features/onboarding/onboarding.css',
  'src/features/planner/planner.css',
  'src/features/settings/favoritesEditor.css',
  'src/features/settings/settings.css',
  'src/features/spoilers/spoilers.css',
  'src/features/tactics/tactics.css',
  'src/features/today/today.css',
  'src/features/ucl/ucl.css',
  'src/features/watch/watch.css',
  'src/productivity.css',
  'src/styles.css',
  'src/themes/broadcast.css',
]);

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
const TEXT_SIZE = /^var\(--text-[a-z0-9-]+\)$/i;
const RADIUS = /^var\(--radius-[a-z0-9-]+\)$/i;

interface Counts {
  colors: number;
  fontSizes: number;
  radii: number;
}

interface Declaration {
  property: string;
  value: string;
}

function cssFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) cssFiles(path, found);
    else if (entry.isFile() && entry.name.endsWith('.css')) found.push(path);
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

function countInFile(css: string): Counts {
  const counts: Counts = { colors: 0, fontSizes: 0, radii: 0 };
  for (const { property, value } of declarations(css)) {
    const clean = value.replace(/\s*!important\s*$/i, '').trim();
    const hexColors = clean.match(/#[0-9a-f]{3,8}\b/gi)?.length ?? 0;
    const colorFunctions = clean.match(/\b(?:rgba?|hsla?)\(/gi)?.length ?? 0;
    const namedColors =
      COLOR_PROPERTY.test(property) || property.startsWith('--') ? namedColorsIn(clean) : 0;
    counts.colors += hexColors + colorFunctions + namedColors;

    if (property === 'font-size' && !TEXT_SIZE.test(clean)) counts.fontSizes += 1;

    const radiusParts = clean.split(/\s+/);
    const radiusIsToken = radiusParts.every(
      (part) => RADIUS.test(part) || part === '0' || part === '50%',
    );
    if (property.endsWith('border-radius') && !radiusIsToken) counts.radii += 1;
  }
  return counts;
}

const total = (counts: Counts): number => counts.colors + counts.fontSizes + counts.radii;

function relativePath(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

const files = cssFiles(SRC_DIR)
  .map(relativePath)
  .filter((file) => file !== TOKENS_FILE)
  .sort();
const counts = new Map(
  files.map((file) => [file, countInFile(readFileSync(join(ROOT, file), 'utf8'))]),
);

describe('style tokens', () => {
  it('keeps the pending list sorted and without duplicates', () => {
    const pending = [...PENDING_FILES];
    expect(pending).toEqual([...new Set(pending)].sort());
  });

  it('finds no raw colors, font sizes or radii outside the pending list', () => {
    const offenders = files
      .filter((file) => !PENDING_FILES.has(file))
      .map((file) => ({ file, ...counts.get(file)! }))
      .filter((file) => total(file) > 0);
    expect(offenders).toEqual([]);
  });

  it('keeps the pending list honest: every entry still has findings and exists', () => {
    const stale = [...PENDING_FILES]
      .filter((file) => !counts.has(file) || total(counts.get(file)!) === 0)
      .sort();
    expect(stale).toEqual([]);
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

  it('accepts token values and the allowed exceptions', () => {
    expect(
      countInFile(
        `.sample {
          color: var(--color-text);
          background: transparent;
          border-color: currentColor;
          outline-color: inherit;
          font-size: var(--text-14);
          border-radius: var(--radius-md) 0 50%;
        }`,
      ),
    ).toEqual({ colors: 0, fontSizes: 0, radii: 0 });
  });
});
