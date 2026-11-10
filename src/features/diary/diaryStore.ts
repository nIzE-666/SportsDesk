import { useSyncExternalStore } from 'react';
import {
  DIARY_KEY,
  DIARY_VERSION,
  diaryReadError,
  mergeDiary,
  parseDiaryText,
  withDiaryEntry,
  type DiaryEntry,
  type DiaryStore,
} from './diaryModel';
interface Snapshot {
  store: DiaryStore;
  writable: boolean;
  error: string | null;
}
let rawCache: string | null | undefined;
let cache: Snapshot;
export function readDiary(): Snapshot {
  let raw: string | null;
  try {
    raw = localStorage.getItem(DIARY_KEY);
  } catch {
    raw = '@unavailable';
  }
  if (raw === rawCache && cache) return cache;
  rawCache = raw;
  const store =
    raw === null ? ({ version: DIARY_VERSION, entries: [] } as DiaryStore) : parseDiaryText(raw);
  cache = {
    store: store ?? { version: DIARY_VERSION, entries: [] },
    writable: store !== null,
    error: store
      ? null
      : raw === '@unavailable'
        ? 'Локальное хранилище дневника недоступно.'
        : diaryReadError(raw!),
  };
  return cache;
}
function subscribe(listener: () => void) {
  const changed = (event: Event) => {
    const key =
      event instanceof StorageEvent
        ? event.key
        : (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key === DIARY_KEY || key === null) listener();
  };
  window.addEventListener('storage', changed);
  window.addEventListener('sportsdesk-storage-changed', changed);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener('sportsdesk-storage-changed', changed);
  };
}
export const useDiary = () => useSyncExternalStore(subscribe, readDiary, readDiary);
function writable() {
  const state = readDiary();
  if (!state.writable) throw new Error(state.error ?? 'Дневник недоступен.');
  return state.store;
}
function write(store: DiaryStore) {
  try {
    localStorage.setItem(DIARY_KEY, JSON.stringify(store));
  } catch {
    throw new Error('Не удалось сохранить дневник. Изменения остались в форме.');
  }
  window.dispatchEvent(
    new CustomEvent('sportsdesk-storage-changed', { detail: { key: DIARY_KEY } }),
  );
}
export function saveDiaryEntry(entry: DiaryEntry): DiaryEntry {
  const store = writable(),
    previous = store.entries.find((e) => e.id === entry.id);
  const saved = {
    ...entry,
    createdAt: previous?.createdAt ?? entry.createdAt,
    updatedAt: new Date().toISOString(),
  };
  write(withDiaryEntry(store, saved));
  return saved;
}
export function deleteDiaryEntry(id: string) {
  const store = writable();
  write({ version: DIARY_VERSION, entries: store.entries.filter((e) => e.id !== id) });
}
export function importDiary(store: DiaryStore, overwrite: boolean) {
  write(mergeDiary(writable(), store, overwrite));
}
