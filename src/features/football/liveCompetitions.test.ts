import { expect, it } from 'vitest';
import { isPersonalLiveMatch } from './liveCompetitions';

// Названия взяты из ответов SportScore для таблиц турниров (10 ноября 2026):
// так же называется турнир и в ленте матчей.
const REAL_COMPETITIONS = [
  'English Premier League',
  'Spanish La Liga',
  'Italian Serie A',
  'Bundesliga',
  'French Ligue 1',
  'United States Major League Soccer',
  'UEFA Champions League',
  'UEFA Europa League',
  'UEFA Europa Conference League',
];

it('recognizes the followed competitions under the names SportScore really uses', () => {
  for (const competition of REAL_COMPETITIONS)
    expect(isPersonalLiveMatch({ home: 'A', away: 'B', competition }, [])).toBe(true);
});

it('does not take unrelated leagues with similar names for followed ones', () => {
  for (const competition of [
    'Jamaica Premier League',
    'Mongolia Premier League',
    'MEX Liga Premier',
    'DR Congo Vodacom Ligue 1',
    'Algerian Ligue Professionnelle 2',
    'International Friendly',
  ])
    expect(isPersonalLiveMatch({ home: 'A', away: 'B', competition }, [])).toBe(false);
  expect(isPersonalLiveMatch({ home: 'A', away: 'B' }, [])).toBe(false);
});
