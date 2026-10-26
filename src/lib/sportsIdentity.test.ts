import { expect, it } from 'vitest';
import contract from '../shared/sportsContracts.json';
import {
  classifyMatchStatus,
  matchesFavoriteIdentity,
  teamMatchesFavorite,
} from './sportsIdentity';
it('matches the shared senior-team alias contract without substrings', () => {
  for (const c of contract.favoriteCases)
    expect(teamMatchesFavorite(c.team, [c.favorite]), JSON.stringify(c)).toBe(c.matches);
});
it('shares the same exact live/terminal status contract with Rust', () => {
  for (const c of contract.statusCases)
    expect(classifyMatchStatus(c.status, c.text), JSON.stringify(c)).toBe(c.expected);
});
it('uses exact opaque PitchAPI IDs even when two teams have identical display names', () => {
  const favorites = [{ id: 'senior-ID', name: 'Arsenal' }];
  expect(matchesFavoriteIdentity({ id: 'women-ID', name: 'Arsenal' }, favorites)).toBe(false);
  expect(matchesFavoriteIdentity({ id: 'senior-ID', name: 'Changed name' }, favorites)).toBe(true);
  expect(matchesFavoriteIdentity({ name: 'FC Arsenal' }, favorites, 'other')).toBe(true);
  expect(matchesFavoriteIdentity({ name: 'Arsenal U21' }, favorites, 'other')).toBe(false);
});
