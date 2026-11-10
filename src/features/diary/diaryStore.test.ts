// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { diaryFixture, diaryFootballEntry, diaryRaceEntry } from '../../test/fixtures/diary';
import { profileEntries, replaceProfile } from '../settings/profileBackup';
import { DIARY_KEY } from './diaryModel';
import { deleteDiaryEntry, importDiary, readDiary, saveDiaryEntry } from './diaryStore';
vi.mock('../../lib/bridge', () => ({ isTauriRuntime: () => false, rpc: vi.fn() }));
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it('exports and restores journal entries with the profile, separately from prediction data', () => {
  localStorage.setItem('sportsdesk.view.games.predictions', 'kept');
  saveDiaryEntry(diaryFootballEntry);
  saveDiaryEntry(diaryRaceEntry);
  const settings = Object.fromEntries(profileEntries());
  delete settings['sportsdesk.view.games.predictions'];
  localStorage.clear();
  replaceProfile(settings);
  expect(readDiary().store.entries).toHaveLength(2);
  expect(readDiary().store.entries.find((e) => e.id === diaryFootballEntry.id)?.event).toEqual(
    diaryFootballEntry.event,
  );
});
it('updates one record and notifies the profile mirror only after a successful write', () => {
  const changed = vi.fn();
  window.addEventListener('sportsdesk-storage-changed', changed);
  try {
    saveDiaryEntry(diaryFootballEntry);
    saveDiaryEntry({ ...diaryFootballEntry, note: 'Новая заметка' });
    expect(readDiary().store.entries).toHaveLength(1);
    expect(changed.mock.calls).toHaveLength(2);
    expect(changed.mock.calls[0]?.[0].detail.key).toBe(DIARY_KEY);
  } finally {
    window.removeEventListener('sportsdesk-storage-changed', changed);
  }
});
it('does not overwrite a corrupt or future diary during save, deletion or import', () => {
  for (const raw of ['{bad', JSON.stringify({ version: 2, entries: [] })]) {
    localStorage.setItem(DIARY_KEY, raw);
    expect(() => saveDiaryEntry(diaryFootballEntry)).toThrow();
    expect(() => deleteDiaryEntry('id')).toThrow();
    expect(() => importDiary(diaryFixture, true)).toThrow();
    expect(localStorage.getItem(DIARY_KEY)).toBe(raw);
  }
});
it('leaves the previous library intact after a storage failure', () => {
  saveDiaryEntry(diaryFootballEntry);
  const previous = localStorage.getItem(DIARY_KEY);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(() => saveDiaryEntry(diaryRaceEntry)).toThrow('Изменения остались');
  expect(localStorage.getItem(DIARY_KEY)).toBe(previous);
});
it('rejects invalid and future journal data before changing any profile keys', () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  expect(() =>
    replaceProfile({ 'sportsdesk.scheme': 'light', [DIARY_KEY]: '{"version":1,"entries":[{}]}' }),
  ).toThrow('Дневник повреждён');
  expect(() =>
    replaceProfile({ 'sportsdesk.scheme': 'light', [DIARY_KEY]: '{"version":2,"entries":[]}' }),
  ).toThrow('Обновите приложение');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
});
it('merges an imported diary and deletes only its own entries, leaving predictions unchanged', () => {
  const key = 'sportsdesk.view.games.predictions';
  localStorage.setItem(key, 'untouched');
  importDiary(diaryFixture, false);
  deleteDiaryEntry(diaryFootballEntry.id);
  expect(readDiary().store.entries.map((e) => e.id)).toEqual([diaryRaceEntry.id]);
  expect(localStorage.getItem(key)).toBe('untouched');
});
