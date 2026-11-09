import { useEffect } from 'react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import { isValidTimezone, STORAGE_KEYS } from '../football/storage';
export function allowedProfileKey(key: string) {
  if (!key.startsWith('sportsdesk.')) return false;
  const name = key.slice('sportsdesk.'.length);
  if (/token|secret|apikey|api_key|password|credential/i.test(name)) return false;
  return (
    [
      'scheme',
      'design',
      'sport',
      'league',
      'density',
      'timezone',
      'sidebar.collapsed',
      'tray.mode',
      'whatsnew.seen',
      'planner.priorities',
      'hero.compact',
      'notifications',
    ].includes(name) ||
    [
      'football.',
      'f1.',
      'view.',
      'cup.',
      'ucl.',
      'notifications.',
      'watch.favorites',
      'watch.recent',
      'watch.view',
      'watch.preferred',
    ].some((p) => name.startsWith(p))
  );
}
export function profileEntries(): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && allowedProfileKey(k)) {
      const v = localStorage.getItem(k);
      if (v !== null) entries.push([k, v]);
    }
  }
  return entries;
}
function validateProfile(settings: Record<string, string>) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('Профиль не содержит настроек.');
  const entries = Object.entries(settings);
  if (entries.length === 0 || entries.length > 200)
    throw new Error('В профиле неподходящее количество настроек.');
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  let total = 0;
  for (const [k, v] of Object.entries(settings)) {
    if (!allowedProfileKey(k) || typeof v !== 'string' || bytes(k) > 128 || bytes(v) > 200_000)
      throw new Error('В копии есть неподдерживаемые настройки.');
    if (k === STORAGE_KEYS.timezone && !isValidTimezone(v))
      throw new Error('В профиле указан неверный часовой пояс.');
    total += bytes(k) + bytes(v);
  }
  if (total > 1_500_000) throw new Error('Профиль превышает допустимый размер.');
}

function replaceEntries(entries: Array<[string, string]>) {
  for (const [key] of profileEntries()) localStorage.removeItem(key);
  for (const [key, value] of entries) localStorage.setItem(key, value);
}

/** Replace the profile and return an undo operation for a later failed history restore. */
export function replaceProfile(
  settings: Record<string, string>,
): (writes?: Map<string, string | null>) => void {
  validateProfile(settings);
  const previous = profileEntries();
  try {
    replaceEntries(Object.entries(settings));
  } catch (error) {
    try {
      replaceEntries(previous);
    } catch (rollback) {
      throw new Error(
        `Не удалось применить профиль и вернуть прежние настройки: ${String(rollback)}.`,
        {
          cause: error,
        },
      );
    }
    throw new Error('Не удалось применить профиль. Прежние настройки восстановлены.', {
      cause: error,
    });
  }
  const applied = new Map(Object.entries(settings));
  return (writes = new Map()) => {
    // Retain edits that arrived while the history commit was in flight.
    const current = new Map(profileEntries());
    const result = new Map(previous);
    for (const key of new Set([...applied.keys(), ...current.keys()])) {
      if (applied.has(key) !== current.has(key) || applied.get(key) !== current.get(key)) {
        const value = current.get(key);
        if (value === undefined) result.delete(key);
        else result.set(key, value);
      }
    }
    for (const [key, value] of writes) {
      if (value === null) result.delete(key);
      else result.set(key, value);
    }
    replaceEntries([...result]);
  };
}

function observeProfileWrites() {
  const writes = new Map<string, string | null>();
  const changed = (event: Event) => {
    const storageEvent = event instanceof StorageEvent ? event : undefined;
    const key = storageEvent
      ? storageEvent.key
      : (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key && allowedProfileKey(key))
      writes.set(key, storageEvent ? storageEvent.newValue : localStorage.getItem(key));
  };
  window.addEventListener('sportsdesk-storage-changed', changed);
  window.addEventListener('sportsdesk-storage-write-intent', changed);
  window.addEventListener('storage', changed);
  return {
    writes,
    stop() {
      window.removeEventListener('sportsdesk-storage-changed', changed);
      window.removeEventListener('sportsdesk-storage-write-intent', changed);
      window.removeEventListener('storage', changed);
    },
  };
}

function retainProfileWrites(writes: Map<string, string | null>) {
  for (const [key, value] of writes) {
    if (localStorage.getItem(key) === value) continue;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}

function sameProfile(a: Array<[string, string]>, b: Array<[string, string]>) {
  const left = new Map(a),
    right = new Map(b);
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
}

export async function applyProfile(settings: Record<string, string>) {
  await withProfileMirrorPaused(async () => {
    const undo = replaceProfile(settings);
    const observer = observeProfileWrites();
    try {
      if (isTauriRuntime()) {
        try {
          await rpc('sync_profile', { settings: profileEntries() });
        } catch (error) {
          try {
            undo(observer.writes);
          } catch (rollback) {
            throw new Error(
              `Не удалось сохранить профиль и вернуть прежние настройки: ${String(rollback)}.`,
              { cause: error },
            );
          }
          throw error;
        }
      }
    } finally {
      observer.stop();
    }
  });
  window.location.reload();
}

let mirrorPauses = 0;
const mirrorWrites = new Set<Promise<unknown>>();
let previousProfileAction: Promise<void> = Promise.resolve();

/** Drain earlier writes so an old mirror cannot overwrite a new backup or restore. */
export async function withProfileMirrorPaused<T>(action: () => Promise<T>): Promise<T> {
  mirrorPauses++;
  const previous = previousProfileAction;
  let release!: () => void;
  previousProfileAction = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    await Promise.allSettled([...mirrorWrites]);
    return await action();
  } finally {
    release();
    mirrorPauses--;
    if (mirrorPauses === 0) window.dispatchEvent(new Event('sportsdesk-storage-changed'));
  }
}

/** Close the native restore journal; if this fails, the next start replays it. */
async function finishRestoreJournal(id: number) {
  try {
    await rpc('finish_backup_restore', { id });
  } catch {
    /* recovered on the next start */
  }
}

/** Finish a restore interrupted by a crash. Resolves true when the page reloads. */
export async function recoverInterruptedRestore(): Promise<boolean> {
  return withProfileMirrorPaused(async () => {
    const recovered = await rpc<{
      id: number;
      profile: { settings: Record<string, string> };
      completed: boolean;
    } | null>('backup_recovery');
    if (!recovered) return false;
    replaceProfile(recovered.profile.settings);
    await rpc('finish_backup_restore', { id: recovered.id });
    window.location.reload();
    return true;
  });
}

export async function restoreFullBackup(path: string): Promise<void> {
  await withProfileMirrorPaused(async () => {
    const original = profileEntries();
    const observer = observeProfileWrites();
    try {
      const prepared = await rpc<{
        id: number;
        profile: { settings: Record<string, string> };
        safetyFile: string;
        safetyWarning?: string | null;
      }>('prepare_backup_restore', { path, settings: original });
      let undo: ((writes?: Map<string, string | null>) => void) | undefined;
      let committed = false;
      try {
        if (observer.writes.size > 0 || !sameProfile(original, profileEntries()))
          throw new Error(
            'Настройки изменились после создания защитной копии. Повторите восстановление.',
          );
        observer.writes.clear();
        undo = replaceProfile(prepared.profile.settings);
        await rpc('commit_backup_restore', { id: prepared.id });
        committed = true;
        retainProfileWrites(observer.writes);
        await finishRestoreJournal(prepared.id);
      } catch (error) {
        if (committed)
          throw new Error(
            `История восстановлена, но не удалось сохранить параллельные изменения профиля: ${String(error)}. Резервная копия текущих данных: ${prepared.safetyFile}. ${prepared.safetyWarning ?? ''}`,
            { cause: error },
          );
        const failures: string[] = [];
        if (undo) {
          try {
            undo(observer.writes);
          } catch (rollback) {
            failures.push(`Не удалось вернуть прежний профиль: ${String(rollback)}.`);
          }
        }
        try {
          await rpc('cancel_backup_restore', { id: prepared.id });
        } catch (cancel) {
          failures.push(`Не удалось отменить подготовленное восстановление: ${String(cancel)}.`);
        }
        await finishRestoreJournal(prepared.id);
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ${failures.join(' ')} Резервная копия текущих данных: ${prepared.safetyFile}. ${prepared.safetyWarning ?? ''}`,
          { cause: error },
        );
      }
    } finally {
      observer.stop();
    }
  });
  window.location.reload();
}
export function useProfileMirror() {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      active = true,
      running = false,
      queued = false,
      unlisten: (() => void) | undefined;
    const save = async () => {
      queued = true;
      if (running || mirrorPauses > 0) return;
      running = true;
      try {
        while (queued && active && mirrorPauses === 0) {
          queued = false;
          const write = rpc('sync_profile', { settings: profileEntries() });
          mirrorWrites.add(write);
          try {
            await write;
          } finally {
            mirrorWrites.delete(write);
          }
        }
      } catch {
        /* the backup panel exposes write errors */
      } finally {
        running = false;
      }
    };
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void save(), 1500);
    };
    // Apply a crash-interrupted restore before the first mirror write.
    void recoverInterruptedRestore()
      .then((reloading) => {
        if (active && !reloading) void save();
      })
      .catch(() => {
        if (active) void save();
      });
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const stop = await listen<number>('sportsdesk://backup-profile-request', (event) => {
          void (async () => {
            // A new profile operation may be queued while an earlier one is
            // finishing. Wait for the entire queue before reading storage.
            while (active) {
              const waiting = previousProfileAction;
              await waiting;
              if (waiting === previousProfileAction && mirrorPauses === 0) break;
            }
            if (active)
              await rpc('provide_backup_profile', {
                id: event.payload,
                settings: profileEntries(),
              });
          })().catch(() => undefined);
        });
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    window.addEventListener('sportsdesk-storage-changed', changed);
    window.addEventListener('storage', changed);
    return () => {
      active = false;
      unlisten?.();
      clearTimeout(timer);
      window.removeEventListener('sportsdesk-storage-changed', changed);
      window.removeEventListener('storage', changed);
    };
  }, []);
}
