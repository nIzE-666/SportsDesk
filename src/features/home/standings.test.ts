import { expect, it } from 'vitest';
import type { MatchSummary } from '../football/types';
import { tableBefore } from './standings';

const team = (name: string) => ({ id: name, name });

const played = (
  home: string,
  away: string,
  scoreHome: number,
  scoreAway: number,
  timeUtc: string,
): MatchSummary => ({
  id: `${home}-${away}-${timeUtc}`,
  status: 'finished',
  time_utc: timeUtc,
  home_team: team(home),
  away_team: team(away),
  score_home: scoreHome,
  score_away: scoreAway,
});

it('ranks the table before a date by points, goal difference and goals scored', () => {
  const cutoff = '2026-02-01T00:00:00Z';
  const matches = [
    played('A', 'B', 3, 1, '2026-01-02T12:00:00Z'),
    played('C', 'D', 2, 0, '2026-01-02T14:00:00Z'),
    played('E', 'F', 2, 2, '2026-01-03T12:00:00Z'),
    played('G', 'H', 5, 0, '2026-01-03T14:00:00Z'),
    // Started after the cutoff: not in the table yet.
    played('X', 'Y', 10, 0, '2026-02-01T12:00:00Z'),
    // Not finished.
    { ...played('Z', 'W', 1, 0, '2026-01-04T12:00:00Z'), status: 'scheduled' },
    // Finished, but the score is unknown.
    {
      ...played('U', 'V', 1, 0, '2026-01-04T12:00:00Z'),
      score_home: null,
      score_away: null,
    },
  ];

  const rows = tableBefore(matches, cutoff);

  expect(rows.map((row) => [row.teamName, row.place, row.points])).toEqual([
    ['G', 1, 3],
    ['A', 2, 3],
    ['C', 3, 3],
    ['E', 4, 1],
    ['F', 5, 1],
    ['B', 6, 0],
    ['D', 7, 0],
    ['H', 8, 0],
  ]);
  expect(rows.find((row) => row.teamName === 'A')).toMatchObject({
    played: 1,
    won: 1,
    drawn: 0,
    lost: 0,
    goalsFor: 3,
    goalsAgainst: 1,
    goalDifference: 2,
  });
});

it('gives a zero table when there is nothing to count', () => {
  expect(tableBefore([], '2026-02-01T00:00:00Z')).toEqual([]);
  expect(tableBefore([played('A', 'B', 1, 0, '2026-01-02T12:00:00Z')], 'nonsense')).toEqual([]);
});
