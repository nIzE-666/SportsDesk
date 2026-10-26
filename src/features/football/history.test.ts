import { describe, expect, it } from 'vitest';
import { h2hSummary, pointsProgression, teamForm, type HistoryMatch } from './history';

function hm(
  id: string,
  homeId: string,
  awayId: string,
  homeScore: number,
  awayScore: number,
  date: string,
  round = '1',
): HistoryMatch {
  return {
    id,
    leagueId: 'l_test',
    season: '2025/2026',
    homeId,
    homeName: homeId,
    awayId,
    awayName: awayId,
    homeScore,
    awayScore,
    status: 'finished',
    date,
    round,
  };
}

describe('teamForm', () => {
  it('computes W/D/L from the team perspective, newest first', () => {
    const matches = [
      hm('m1', 'A', 'B', 2, 1, '2026-01-01'),
      hm('m2', 'C', 'A', 0, 0, '2026-01-08'),
      hm('m3', 'A', 'D', 1, 3, '2026-01-15'),
    ];
    expect(teamForm(matches, 'A')).toEqual(['W', 'D', 'L']);
  });

  it('ignores unfinished rows', () => {
    const matches = [
      hm('m1', 'A', 'B', 2, 1, '2026-01-01'),
      { ...hm('m2', 'A', 'B', 0, 0, '2026-01-08'), status: 'scheduled' },
    ];
    expect(teamForm(matches, 'A')).toEqual(['W']);
  });
});

describe('h2hSummary', () => {
  it('aggregates wins, draws and goals from both orientations', () => {
    const matches = [
      hm('m1', 'A', 'B', 3, 1, '2026-01-01'),
      hm('m2', 'B', 'A', 2, 2, '2026-02-01'),
      hm('m3', 'A', 'B', 0, 2, '2026-03-01'),
    ];
    const s = h2hSummary(matches, 'A', 'B');
    expect(s.played).toBe(3);
    expect(s.aWins).toBe(1);
    expect(s.bWins).toBe(1);
    expect(s.draws).toBe(1);
    expect(s.aGoals).toBe(5);
    expect(s.bGoals).toBe(5);
  });
});

describe('pointsProgression', () => {
  it('accumulates 3/1/0 points in date order', () => {
    const matches = [
      hm('m1', 'A', 'B', 1, 0, '2026-01-01'),
      hm('m2', 'C', 'A', 1, 1, '2026-01-08'),
      hm('m3', 'A', 'D', 0, 1, '2026-01-15'),
      hm('m4', 'E', 'A', 0, 4, '2026-01-22'),
    ];
    const prog = pointsProgression(matches, 'A');
    expect(prog.map((p) => p.points)).toEqual([3, 4, 4, 7]);
  });

  it('orders by date, not by input order', () => {
    const matches = [
      hm('m2', 'A', 'B', 1, 0, '2026-02-01'),
      hm('m1', 'A', 'B', 1, 0, '2026-01-01'),
    ];
    expect(pointsProgression(matches, 'A').map((p) => p.points)).toEqual([3, 6]);
  });
});
