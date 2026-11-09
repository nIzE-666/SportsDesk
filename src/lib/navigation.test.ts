import { expect, it } from 'vitest';
import { homeRoute, isContentRoute, isValidContentRoute, toggleAuxiliary } from './navigation';
it('returns from auxiliary pages to the same cup instead of a football route', () => {
  const cup = homeRoute('cup', 'europa');
  expect(toggleAuxiliary(toggleAuxiliary(cup, 'settings', cup), 'settings', cup)).toEqual(cup);
  expect(toggleAuxiliary({ kind: 'watch' }, 'watch', cup)).toEqual(cup);
  expect(homeRoute('cup', 'europa')).toEqual({ kind: 'cup', cupId: 'europa', tab: 'overview' });
  expect(homeRoute('f1', 'europa')).toEqual({ kind: 'f1', tab: 'overview' });
  expect(homeRoute('ucl', 'europa')).toEqual({ kind: 'ucl', tab: 'overview' });
});

it('treats the games page as an auxiliary page, never as sport content', () => {
  expect(isContentRoute({ kind: 'games' })).toBe(false);
  expect(isContentRoute({ kind: 'events' })).toBe(false);
  expect(isContentRoute(homeRoute('f1', 'europa'))).toBe(true);
  expect(isValidContentRoute({ kind: 'games' })).toBe(false);
});
