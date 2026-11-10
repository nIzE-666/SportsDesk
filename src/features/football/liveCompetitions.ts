import { matchInvolvesFavorite } from './FavoritesProvider';

// SportScore does not supply the PitchAPI league ID in this feed. Exact names
// avoid confusing unrelated competitions such as Jamaica's Premier League.
const COMPETITIONS = new Set([
  'premier league',
  'english premier league',
  'england premier league',
  'la liga',
  'laliga',
  'spanish la liga',
  'spain la liga',
  'serie a',
  'italian serie a',
  'italy serie a',
  'bundesliga',
  'german bundesliga',
  'germany bundesliga',
  'ligue 1',
  'french ligue 1',
  'france ligue 1',
  'mls',
  'major league soccer',
  'united states major league soccer',
  'uefa champions league',
  'champions league',
  'uefa europa league',
  'europa league',
  'uefa conference league',
  'uefa europa conference league',
  'europa conference league',
  'fifa world cup',
  'world cup',
]);

export function isPersonalLiveMatch(
  match: { home?: string; away?: string; competition?: string },
  favoriteNames: string[],
) {
  if (matchInvolvesFavorite(match.home, match.away, favoriteNames)) return true;
  const name = match.competition
    ?.normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/\s+/g, ' ');
  return !!name && COMPETITIONS.has(name);
}
