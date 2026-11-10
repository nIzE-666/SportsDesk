import { useSyncExternalStore } from 'react';
import {
  parseTactics,
  TACTICS_KEY,
  TACTICS_VERSION,
  upsertScheme,
  type TacticScheme,
  type TacticsStore,
} from './tacticsModel';

interface Snapshot {
  store: TacticsStore;
  error: string | null;
  writable: boolean;
}
let cachedRaw: string | null | undefined;
let cached: Snapshot;
function read(): Snapshot {
  let raw: string | null;
  try {
    raw = localStorage.getItem(TACTICS_KEY);
  } catch {
    raw = '@unavailable';
  }
  if (raw === cachedRaw && cached) return cached;
  cachedRaw = raw;
  let store: TacticsStore | null = null;
  let error: string | null = null;
  if (raw === null) store = { version: TACTICS_VERSION, schemes: [] };
  else {
    try {
      const value: unknown = JSON.parse(raw);
      store = parseTactics(value);
      if (!store)
        error =
          value &&
          typeof value === 'object' &&
          'version' in value &&
          typeof value.version === 'number' &&
          value.version > TACTICS_VERSION
            ? 'Схемы созданы более новой версией SportsDesk. Обновите приложение.'
            : 'Сохранённые схемы повреждены. Восстановите их из резервной копии.';
    } catch {
      error =
        raw === '@unavailable'
          ? 'Локальное хранилище недоступно.'
          : 'Сохранённые схемы не удалось прочитать. Восстановите их из резервной копии.';
    }
  }
  cached = {
    store: store ?? { version: TACTICS_VERSION, schemes: [] },
    error,
    writable: store !== null,
  };
  return cached;
}
function subscribe(listener: () => void) {
  const changed = (event: Event) => {
    const key =
      event instanceof StorageEvent
        ? event.key
        : (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key === TACTICS_KEY || key === null) listener();
  };
  window.addEventListener('storage', changed);
  window.addEventListener('sportsdesk-storage-changed', changed);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener('sportsdesk-storage-changed', changed);
  };
}
export const useTactics = () => useSyncExternalStore(subscribe, read, read);
function write(store: TacticsStore) {
  try {
    localStorage.setItem(TACTICS_KEY, JSON.stringify(store));
  } catch {
    throw new Error('Не удалось сохранить схему на этом компьютере. Изменения остались на доске.');
  }
  window.dispatchEvent(
    new CustomEvent('sportsdesk-storage-changed', { detail: { key: TACTICS_KEY } }),
  );
}
export function saveScheme(scheme: TacticScheme): TacticScheme {
  const current = read();
  if (!current.writable) throw new Error(current.error ?? 'Хранилище недоступно.');
  const saved = { ...scheme, title: scheme.title.trim(), updatedAt: new Date().toISOString() };
  write(upsertScheme(current.store, saved));
  return saved;
}
export function deleteScheme(id: string) {
  const current = read();
  if (!current.writable) throw new Error(current.error ?? 'Хранилище недоступно.');
  write({ version: TACTICS_VERSION, schemes: current.store.schemes.filter((s) => s.id !== id) });
}
