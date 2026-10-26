import { expect, it, vi } from 'vitest';
import { ViewStateStore } from './viewState';
it('restores validated selections from storage, rejecting corrupt data', () => {
  const values = new Map([
    ['sportsdesk.view.year', '2025'],
    ['sportsdesk.view.filter', '{broken'],
    ['sportsdesk.view.badYear', '"oops"'],
  ]);
  const store = new ViewStateStore(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  }));
  expect(store.read('year', 2026, (v) => typeof v === 'number' && v >= 2023)).toBe(2025);
  expect(store.read('filter', 'all')).toBe('all');
  expect(store.read('badYear', 2026)).toBe(2026);
  store.write('filter', 'finished');
  expect(
    new ViewStateStore(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: () => {},
    })).read('filter', 'all'),
  ).toBe('finished');
});
it('keeps season and league scopes independent and notifies only affected subscribers', () => {
  const store = new ViewStateStore(() => null),
    a = vi.fn(),
    b = vi.fn();
  const stop = store.subscribe('epl.2026.query', a);
  store.subscribe('laliga.2026.query', b);
  store.write('epl.2026.query', 'Arsenal');
  store.write('epl.2025.query', 'Chelsea');
  expect(store.read('epl.2026.query', '')).toBe('Arsenal');
  expect(store.read('epl.2025.query', '')).toBe('Chelsea');
  expect(a).toHaveBeenCalledOnce();
  expect(b).not.toHaveBeenCalled();
  stop();
  store.write('epl.2026.query', '');
  expect(a).toHaveBeenCalledOnce();
});
it('keeps working in memory if browser storage is unavailable', () => {
  const store = new ViewStateStore(() => {
    throw new Error('blocked');
  });
  expect(store.read('query', '')).toBe('');
  store.write('query', 'Red Bull');
  expect(store.read('query', '')).toBe('Red Bull');
});
