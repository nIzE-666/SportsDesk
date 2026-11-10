// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { tacticLineups, tacticMatch } from '../../test/fixtures/tactics';
import { profileEntries, replaceProfile } from '../settings/profileBackup';
import { schemeFromLineups, TACTICS_KEY } from './tacticsModel';
import { deleteScheme, saveScheme } from './tacticsStore';
vi.mock('../../lib/bridge', () => ({ isTauriRuntime: () => false, rpc: vi.fn() }));
const create = () => schemeFromLineups(tacticMatch, tacticLineups, 'scheme');
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it('persists a scheme through profile export and restore and notifies the native mirror', () => {
  const changed = vi.fn();
  window.addEventListener('sportsdesk-storage-changed', changed);
  try {
    const saved = saveScheme(create());
    expect(changed.mock.calls[0]?.[0].detail.key).toBe(TACTICS_KEY);
    const settings = Object.fromEntries(profileEntries());
    expect(settings[TACTICS_KEY]).toBeDefined();
    localStorage.clear();
    replaceProfile(settings);
    expect(JSON.parse(localStorage.getItem(TACTICS_KEY)!).schemes).toEqual([saved]);
  } finally {
    window.removeEventListener('sportsdesk-storage-changed', changed);
  }
});
it('does not replace a corrupt or future store with a new empty library', () => {
  for (const raw of ['{bad', JSON.stringify({ version: 2, schemes: [] })]) {
    localStorage.setItem(TACTICS_KEY, raw);
    expect(() => saveScheme(create())).toThrow();
    expect(() => deleteScheme('scheme')).toThrow();
    expect(localStorage.getItem(TACTICS_KEY)).toBe(raw);
  }
});
it('keeps the previous saved value when storage is full', () => {
  saveScheme(create());
  const previous = localStorage.getItem(TACTICS_KEY);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(() => saveScheme({ ...create(), title: 'Новый вариант' })).toThrow('Не удалось сохранить');
  expect(localStorage.getItem(TACTICS_KEY)).toBe(previous);
});
it('rejects a damaged tactical profile before touching other settings', () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  expect(() =>
    replaceProfile({
      'sportsdesk.scheme': 'light',
      [TACTICS_KEY]: JSON.stringify({ version: 1, schemes: [{}] }),
    }),
  ).toThrow('тактические схемы');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
  expect(() =>
    replaceProfile({
      'sportsdesk.scheme': 'light',
      [TACTICS_KEY]: JSON.stringify({ version: 2, schemes: [] }),
    }),
  ).toThrow('Обновите приложение');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
});
it('deletes only the requested saved scheme', () => {
  saveScheme(create());
  saveScheme({ ...create(), id: 'second', title: 'Второй вариант' });
  deleteScheme('scheme');
  expect(
    JSON.parse(localStorage.getItem(TACTICS_KEY)!).schemes.map((s: { id: string }) => s.id),
  ).toEqual(['second']);
});
