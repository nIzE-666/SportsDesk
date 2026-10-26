import { expect, it } from 'vitest';
import { homeRoute, toggleAuxiliary } from './navigation';
it('returns from auxiliary pages to the same cup instead of a football route', () => {
  const cup = homeRoute('cup', 'europa');
  expect(toggleAuxiliary(toggleAuxiliary(cup, 'settings', cup), 'settings', cup)).toEqual(cup);
  expect(toggleAuxiliary({ kind: 'watch' }, 'watch', cup)).toEqual(cup);
  expect(homeRoute('cup', 'europa')).toEqual({ kind: 'cup', cupId: 'europa', tab: 'overview' });
  expect(homeRoute('f1', 'europa')).toEqual({ kind: 'f1', tab: 'overview' });
  expect(homeRoute('ucl', 'europa')).toEqual({ kind: 'ucl', tab: 'overview' });
});
