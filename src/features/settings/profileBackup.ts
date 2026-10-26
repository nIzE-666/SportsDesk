import { useEffect } from 'react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
export function allowedProfileKey(key: string) {
  if (!key.startsWith('sportsdesk.')) return false;
  const name = key.slice(10);
  if (/token|secret|apikey|api_key|password|credential/i.test(name)) return false;
  return (
    [
      'scheme',
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
export function applyProfile(settings: Record<string, string>) {
  for (const [k, v] of Object.entries(settings)) {
    if (!allowedProfileKey(k) || typeof v !== 'string')
      throw new Error('В копии есть неподдерживаемые настройки.');
  }
  const previous = profileEntries();
  try {
    for (const [k] of previous) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(settings)) localStorage.setItem(k, v);
  } catch {
    for (const k of Object.keys(settings)) localStorage.removeItem(k);
    for (const [k, v] of previous) localStorage.setItem(k, v);
    throw new Error('Не хватило места для профиля. Прежние настройки восстановлены.');
  }
  window.location.reload();
}
export function useProfileMirror() {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      active = true,
      running = false,
      queued = false;
    const save = async () => {
      queued = true;
      if (running) return;
      running = true;
      try {
        while (queued && active) {
          queued = false;
          await rpc('sync_profile', { settings: profileEntries() });
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
    void save();
    window.addEventListener('sportsdesk-storage-changed', changed);
    window.addEventListener('storage', changed);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('sportsdesk-storage-changed', changed);
      window.removeEventListener('storage', changed);
    };
  }, []);
}
