import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { groupBracket, normalizeKnockoutRound } from './bracket';
const details = JSON.parse(
  readFileSync(new URL('../../test/fixtures/ucl-round-details.json', import.meta.url), 'utf8'),
);

describe('Champions League stage and aggregate correctness', () => {
  it('keeps ordinary league-phase round numbers out of the knockout bracket', () => {
    for (const n of ['1', '2', '3', '4', '5', '6', '7', '8'])
      expect(normalizeKnockoutRound(n)).toBeNull();
    expect(normalizeKnockoutRound('1/2')).toBe('semi');
    expect(normalizeKnockoutRound('1/8')).toBe('r16');
  });
  it('adds reversed home-and-away legs to the same team', () => {
    const ties = groupBracket(details);
    const arsenal = ties.find(
      (t) => t.round === 'semi' && [t.home.id, t.away.id].includes('t_1gkhxH'),
    );
    expect(arsenal?.complete).toBe(true);
    expect(arsenal?.winnerId).toBe('t_1gkhxH');
    expect([arsenal?.aggregateHome, arsenal?.aggregateAway].sort()).toEqual([1, 2]);
  });
  it('keeps the real home side of each leg next to the oriented aggregate values', () => {
    const arsenal = groupBracket(details).find(
      (t) => t.round === 'semi' && [t.home.id, t.away.id].includes('t_1gkhxH'),
    );
    expect([arsenal?.aggregateHome, arsenal?.aggregateAway]).toEqual([2, 1]);
    const [first, second] = arsenal?.legs ?? [];
    expect(first).toMatchObject({
      realHome: { id: 't_3NIiXl' },
      realAway: { id: 't_1gkhxH' },
      realHomeScore: 1,
      realAwayScore: 1,
      homeId: 't_1gkhxH',
      awayId: 't_3NIiXl',
    });
    expect(second).toMatchObject({
      realHome: { id: 't_1gkhxH' },
      realAway: { id: 't_3NIiXl' },
      realHomeScore: 1,
      realAwayScore: 0,
      homeId: 't_1gkhxH',
      awayId: 't_3NIiXl',
    });
  });
  it('does not invent a penalty winner from a drawn final score', () => {
    const final = groupBracket(details).find((t) => t.round === 'final');
    expect(final?.complete).toBe(true);
    expect(final?.aggregateHome).toBe(1);
    expect(final?.aggregateAway).toBe(1);
    expect(final?.winnerId).toBeNull();
  });
  it('keeps a two-leg tie incomplete when only one result is available', () => {
    const partial = groupBracket(details).find(
      (t) => t.round === 'semi' && [t.home.id, t.away.id].includes('t_1cpjqO'),
    );
    expect(partial?.complete).toBe(false);
    expect(partial?.winnerId).toBeNull();
  });
  it('recognises a normalized third-place round when the board re-reads its legs', () => {
    expect(normalizeKnockoutRound('third place')).toBe('third');
    expect(normalizeKnockoutRound('third')).toBe('third');
    const ties = groupBracket(
      [
        {
          id: 'third-1',
          round: 'third',
          status: 'finished',
          home_team: { id: 'a', name: 'A' },
          away_team: { id: 'b', name: 'B' },
          score_home: 2,
          score_away: 1,
        },
      ],
      'single-leg',
    );
    expect(ties).toHaveLength(1);
    expect(ties[0]?.round).toBe('third');
    expect(ties[0]?.winnerId).toBe('a');
  });
});
