import { useEffect, useRef } from 'react';
import { rpc, isTauriRuntime } from '../../lib/bridge';
import { getString, getJson, setString, normalizeName, STORAGE_KEYS } from '../football/storage';
import { DEFAULT_FAVORITE_TEAM_NAMES, teamMatchesFavorite } from '../football/FavoritesProvider';
import { readPolicy, getUserTimezone } from '../settings/notificationPolicy';
import { VERIFIED_LEAGUES } from './useFootballData';

/**
 * Bridge to the Rust background poller. The UI owns localStorage settings;
 * this hook pushes them (enabled + favourite team names) to the native poller
 * whenever they change, and subscribes to nothing: delivery is a native
 * notification sent from Rust, which works even when the window is hidden.
 */

interface StoredFavorites {
  ids?: unknown;
  dismissed?: unknown;
  seeded?: unknown;
}

interface CatalogueEntry {
  id?: unknown;
  name?: unknown;
  leagueId?: string;
  leagueName?: string;
}

export function readNotificationsEnabled(): boolean {
  const raw = getString(STORAGE_KEYS.notifications);
  if (raw === null) {
    const legacy = getJson<boolean | null>('sportsdesk.notifications', null);
    return legacy === true;
  }
  return raw === '1';
}

/** Same resolution rules as the old JS notifier (ids -> catalogue names). */
export function resolveFavoriteTeamNames(): string[] {
  const stored = getJson<StoredFavorites | null>(STORAGE_KEYS.favoritesTeams, null);
  const dismissedRaw = Array.isArray(stored?.dismissed) ? (stored?.dismissed as unknown[]) : [];
  const dismissed = new Set(
    dismissedRaw.filter((x): x is string => typeof x === 'string').map((x) => normalizeName(x)),
  );
  const idsRaw = Array.isArray(stored?.ids) ? (stored?.ids as unknown[]) : [];
  const ids = new Set(idsRaw.filter((x): x is string => typeof x === 'string'));

  const catalogueRaw = getJson<CatalogueEntry[] | null>(STORAGE_KEYS.catalogue, null);
  const catalogue = Array.isArray(catalogueRaw) ? catalogueRaw : [];
  const nameById = new Map<string, string>();
  for (const entry of catalogue) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
    nameById.set(entry.id, entry.name);
  }

  const names = new Set<string>();
  for (const id of ids) {
    const name = nameById.get(id);
    if (!name) continue;
    if (dismissed.has(normalizeName(name))) continue;
    names.add(name);
  }
  for (const def of DEFAULT_FAVORITE_TEAM_NAMES) {
    const key = normalizeName(def);
    if (dismissed.has(key)) continue;
    if (teamMatchesFavorite(def, Array.from(names))) continue;
    names.add(def);
  }
  return Array.from(names);
}

export interface PollerConfig {
  enabled: boolean;
  favorites: string[];
  f1Reminders: boolean;
}

export function resolveFavoriteTeams(): Array<{ id: string; name: string; leagueId?: string }> {
  const stored = getJson<StoredFavorites | null>(STORAGE_KEYS.favoritesTeams, null);
  const ids = new Set(Array.isArray(stored?.ids) ? stored.ids : []);
  const names = resolveFavoriteTeamNames();
  const catalogue = getJson<CatalogueEntry[]>(STORAGE_KEYS.catalogue, []);
  return (Array.isArray(catalogue) ? catalogue : [])
    .filter(
      (e): e is { id: string; name: string; leagueId?: string; leagueName?: string } =>
        typeof e?.id === 'string' &&
        typeof e.name === 'string' &&
        ids.has(e.id) &&
        teamMatchesFavorite(e.name, names),
    )
    .map(({ id, name, leagueId, leagueName }) => ({
      id,
      name,
      leagueId:
        leagueId ??
        VERIFIED_LEAGUES.find((l) => normalizeName(l.name) === normalizeName(leagueName ?? ''))?.id,
    }));
}

export function usePollerSync(): void {
  const lastPush = useRef<string>('');
  const favoritesKey = STORAGE_KEYS.favoritesTeams;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true,
      running = false,
      queued = false;
    const push = async () => {
      queued = true;
      if (running) return;
      running = true;
      try {
        while (queued && active) {
          queued = false;
          const enabled = readNotificationsEnabled();
          const f1Reminders = getString('sportsdesk.notifications.f1') !== '0';
          const favorites = resolveFavoriteTeamNames();
          const favoriteTeams = resolveFavoriteTeams(),
            policy = readPolicy(),
            timezone = getUserTimezone();
          let trayValue = getString(STORAGE_KEYS.trayMode);
          if (trayValue === null) {
            try {
              trayValue = (await rpc<boolean>('get_tray_mode')) ? '1' : '0';
              setString(STORAGE_KEYS.trayMode, trayValue);
            } catch {
              return;
            }
          }
          const tray = trayValue !== '0';
          const signature = JSON.stringify({
            enabled,
            favorites,
            tray,
            f1Reminders,
            favoriteTeams,
            policy,
            timezone,
          });
          if (signature === lastPush.current) continue;
          try {
            await rpc('set_poller_config', {
              config: { enabled, favorites, f1Reminders, favoriteTeams, policy, timezone },
            });
            await rpc('set_tray_mode', { enabled: tray });
            lastPush.current = signature;
          } catch {
            /* dev bridge: polling silently unavailable */
          }
        }
      } finally {
        running = false;
      }
    };

    void push();
    const onStorage = (event: Event) => {
      const key =
        event instanceof CustomEvent
          ? event.detail?.key
          : event instanceof StorageEvent
            ? event.key
            : null;
      if (
        !key ||
        key === STORAGE_KEYS.favoritesTeams ||
        key === STORAGE_KEYS.catalogue ||
        key === STORAGE_KEYS.notifications ||
        key === STORAGE_KEYS.trayMode ||
        key.startsWith('sportsdesk.notifications') ||
        key.toLowerCase().includes('timezone')
      )
        void push();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('sportsdesk-storage-changed', onStorage);
    window.addEventListener('sportsdesk-favorites-changed', onStorage);
    return () => {
      active = false;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sportsdesk-storage-changed', onStorage);
      window.removeEventListener('sportsdesk-favorites-changed', onStorage);
    };
  }, [favoritesKey]);
}

/** Fired by FavoritesProvider after every persisted change. */
export function notifyFavoritesChanged(): void {
  window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
}

export function setNotificationsEnabled(enabled: boolean): void {
  setString(STORAGE_KEYS.notifications, enabled ? '1' : '0');
  window.dispatchEvent(new Event('storage'));
}

/** Settings UI helper: persists the flag and pokes the poller sync loop. */
export function writeNotificationsEnabled(enabled: boolean): void {
  setNotificationsEnabled(enabled);
  window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
}
