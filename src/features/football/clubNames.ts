import { canonicalTeamName } from '../../lib/sportsIdentity';

/**
 * Standings come from one source and the club catalogue from another, and they write the
 * same club differently: "Bayer 04 Leverkusen" and "Bayer Leverkusen", "AC Milan" and "Milan".
 * clubKey gives both spellings the same key so a table row can borrow the catalogue's name,
 * crest and club page. Distinct clubs keep distinct keys; a key shared by two catalogue clubs
 * is never used to match (see StandingsView).
 */

/** Legal forms and prefixes that sources add or drop; the club is the words around them. */
const FORM_WORDS = new Set([
  'fc',
  'cf',
  'afc',
  'sc',
  'sv',
  'vfb',
  'vfl',
  'tsg',
  'fsv',
  'rc',
  'rcd',
  'ca',
  'ac',
  'as',
  'ogc',
  'losc',
  'aj',
  'sco',
  'ssc',
  'ss',
  'us',
  'ud',
  'cd',
  'football',
  'club',
]);

/**
 * The same club under names the rules above cannot join. The first name is the catalogue's,
 * the rest are how the standings source writes it (checked against both sources on 2026-11-12).
 */
const SAME_CLUB: ReadonlyArray<readonly [string, ...string[]]> = [
  ['Inter', 'Inter Milan'],
  ['Bayern München', 'FC Bayern Munich'],
  ['Brest', 'Stade Brestois 29'],
  ['Rennes', 'Stade Rennais FC'],
  ['Strasbourg', 'RC Strasbourg Alsace'],
  ['Le Havre', 'Havre Athletic Club'],
  ['Deportivo A Coruña', 'RC Deportivo'],
  ['Celta Vigo', 'RC Celta'],
  ['Espanyol', 'RCD Espanyol de Barcelona'],
  ['Red Bull New York', 'New York Red Bulls'],
  ['CF Montréal', 'Montreal Impact'],
  ['LA Galaxy', 'Los Angeles Galaxy'],
];

function strip(name: string): string {
  const words = canonicalTeamName(name)
    .split(' ')
    .filter((word) => word && !/^\d+$/.test(word));
  while (words.length > 1 && FORM_WORDS.has(words[0]!)) words.shift();
  while (words.length > 1 && FORM_WORDS.has(words[words.length - 1]!)) words.pop();
  return words.join(' ') || canonicalTeamName(name);
}

const ALIASES = new Map<string, string>();
for (const [catalogue, ...others] of SAME_CLUB)
  for (const other of others) ALIASES.set(strip(other), strip(catalogue));

export function clubKey(name: string): string {
  const key = strip(name);
  return ALIASES.get(key) ?? key;
}
