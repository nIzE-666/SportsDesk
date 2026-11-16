import { expect, it } from 'vitest';
import { DERBIES, isDerby, isDerbyMatch } from './derbies';

it('matches derbies through the club names, in either order and spelling', () => {
  expect(isDerby('Manchester United', 'Manchester City')).toBe(true);
  expect(isDerby('Manchester City', 'Manchester United')).toBe(true);
  expect(isDerby('FC Bayern Munich', 'Borussia Dortmund')).toBe(true);
  expect(isDerby('Real Madrid', 'Barcelona')).toBe(true);
  expect(isDerby('Inter Milan', 'AC Milan')).toBe(true);

  expect(isDerby('Arsenal', 'Chelsea')).toBe(false);
  expect(isDerby('Inter', 'Inter Miami')).toBe(false);
  expect(isDerby('', 'Barcelona')).toBe(false);
});

it('recognises a derby from a match', () => {
  expect(
    isDerbyMatch({
      home_team: { id: 'liverpool', name: 'Liverpool' },
      away_team: { id: 'everton', name: 'Everton' },
    }),
  ).toBe(true);
});

it('has one to three famous derbies for every followed league and El Clásico', () => {
  const leagues = ['Premier League', 'Ла Лига', 'Серия A', 'Бундеслига', 'Лига 1', 'MLS'];
  for (const league of leagues) {
    const count = DERBIES.filter((derby) => derby.league === league).length;
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
  }
  expect(
    DERBIES.some(
      (derby) => derby.teams.includes('Real Madrid') && derby.teams.includes('Barcelona'),
    ),
  ).toBe(true);
});
