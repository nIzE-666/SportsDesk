import { describe, expect, it } from 'vitest';
import type { MatchSummary } from '../football/types';
import { buildLeagueTable, clubSnapshot, f1TeamName, matchStart, opponentName } from './todayModel';

const team = (id: string, name: string) => ({ id, name });
const match = (
  id: string,
  status: string,
  home: string,
  away: string,
  scoreHome: number | null,
  scoreAway: number | null,
  time: string,
): MatchSummary => ({
  id,
  status,
  home_team: team(home, home.toUpperCase()),
  away_team: team(away, away.toUpperCase()),
  score_home: scoreHome,
  score_away: scoreAway,
  time_utc: time,
  date: time.slice(0, 10),
});

describe('buildLeagueTable', () => {
  it('counts only finished matches with a score and sorts by points, goal difference and goals', () => {
    const table = buildLeagueTable([
      match('1', 'finished', 'a', 'b', 2, 0, '2026-08-01T12:00:00Z'),
      match('2', 'finished', 'c', 'a', 1, 1, '2026-08-08T12:00:00Z'),
      match('3', 'finished', 'b', 'c', 3, 2, '2026-08-15T12:00:00Z'),
      match('4', 'scheduled', 'a', 'c', null, null, '2026-09-01T12:00:00Z'),
      match('5', 'finished', 'b', 'c', null, null, '2026-08-22T12:00:00Z'),
    ]);
    expect([...table.values()].map((row) => [row.teamId, row.position, row.points])).toEqual([
      ['a', 1, 4],
      ['b', 2, 3],
      ['c', 3, 1],
    ]);
    expect(table.get('a')).toMatchObject({
      played: 2,
      goalsFor: 3,
      goalsAgainst: 1,
      goalDifference: 2,
    });
  });

  it('is empty without finished results so the screen can show a dash', () => {
    expect(
      buildLeagueTable([match('1', 'scheduled', 'a', 'b', null, null, '2026-09-01T12:00:00Z')])
        .size,
    ).toBe(0);
  });
});

describe('clubSnapshot', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const matches = [
    match('old', 'finished', 'a', 'x', 1, 0, '2026-11-01T12:00:00Z'),
    match('recent', 'finished', 'y', 'a', 0, 2, '2026-11-08T12:00:00Z'),
    match('running', 'live', 'a', 'live-opponent', 1, 0, '2026-11-10T11:00:00Z'),
    match('next', 'scheduled', 'a', 'z', null, null, '2026-11-15T12:00:00Z'),
    match('later', 'scheduled', 'w', 'a', null, null, '2026-11-20T12:00:00Z'),
  ];

  it('takes the latest finished and the nearest scheduled fixture of the club', () => {
    const snapshot = clubSnapshot(matches, 'a', now);
    expect(snapshot.last?.id).toBe('recent');
    expect(snapshot.next?.id).toBe('next');
  });

  it('ignores another club and matches without a readable time', () => {
    const snapshot = clubSnapshot(
      [
        ...matches,
        match('other', 'finished', 'b', 'c', 3, 0, '2026-11-09T12:00:00Z'),
        {
          ...match('broken', 'scheduled', 'a', 'q', null, null, ''),
          time_utc: '',
          date: undefined,
        },
      ],
      'a',
      now,
    );
    expect(snapshot.last?.id).toBe('recent');
    expect(snapshot.next?.id).toBe('next');
  });
});

describe('helpers', () => {
  it('reads UTC and date-only fixtures without inventing a local midnight', () => {
    expect(matchStart({ time_utc: '2026-11-10T12:00:00Z' })).toBe(
      Date.parse('2026-11-10T12:00:00Z'),
    );
    expect(matchStart({ date: '2026-11-10' })).toBe(Date.parse('2026-11-10T00:00:00Z'));
    expect(Number.isNaN(matchStart({}))).toBe(true);
  });

  it('names the opponent and known Formula 1 constructors', () => {
    const fixture = match('1', 'finished', 'a', 'b', 2, 1, '2026-11-10T12:00:00Z');
    expect(opponentName(fixture, 'a')).toBe('B');
    expect(opponentName(fixture, 'b')).toBe('A');
    expect(opponentName(fixture, 'z')).toBe('');
    expect(f1TeamName('mercedes')).toBe('Mercedes');
    expect(f1TeamName('unknown-team')).toBe('unknown-team');
  });
});
