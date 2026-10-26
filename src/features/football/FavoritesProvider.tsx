import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getJson, setJson, STORAGE_KEYS, normalizeName } from './storage';
import type { FavoritePlayer } from './types';
import type { TeamCatalogueEntry } from './useFootballData';

import { DEFAULT_FAVORITE_TEAM_NAMES, teamMatchesFavorite } from '../../lib/sportsIdentity';
export { DEFAULT_FAVORITE_TEAM_NAMES, teamMatchesFavorite } from '../../lib/sportsIdentity';

export function matchInvolvesFavorite(
  homeName: string | undefined | null,
  awayName: string | undefined | null,
  favoriteNames: string[],
): boolean {
  return (
    teamMatchesFavorite(homeName, favoriteNames) || teamMatchesFavorite(awayName, favoriteNames)
  );
}

interface FavoritesContextValue {
  teamIds: string[];
  favoriteTeamNames: string[];
  toggleTeam: (teamId: string) => void;
  isTeamFavorite: (teamId: string) => boolean;
  favoritePlayers: FavoritePlayer[];
  togglePlayer: (player: FavoritePlayer) => void;
  isPlayerFavorite: (playerId: string) => boolean;
  /** Resolve unresolved defaults against a loaded team catalogue; safe to call on any render. */
  seedFromCatalogue: (catalogue: TeamCatalogueEntry[]) => void;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

interface StoredTeamFav {
  ids: string[];
  seededDefault?: boolean;
  /** Default favourite names the user explicitly removed (never re-added). */
  dismissed?: string[];
  /** Default favourite names already resolved to a provider id. */
  seeded?: string[];
}

function readStoredFav(): StoredTeamFav {
  const raw = getJson<StoredTeamFav | null>(STORAGE_KEYS.favoritesTeams, null);
  if (!raw || typeof raw !== 'object') return { ids: [] };
  const ids = Array.isArray(raw.ids)
    ? raw.ids.filter((x): x is string => typeof x === 'string')
    : [];
  const dismissed = Array.isArray(raw.dismissed)
    ? raw.dismissed.filter((x): x is string => typeof x === 'string')
    : [];
  const seeded = Array.isArray(raw.seeded)
    ? raw.seeded.filter((x): x is string => typeof x === 'string')
    : [];
  return { ids, dismissed, seeded, seededDefault: Boolean(raw.seededDefault) };
}

/**
 * Map a provider id back to its default favourite name using the persisted
 * catalogue, so removing a previously seeded team also marks that default as
 * dismissed (keeps removed defaults from being re-seeded forever).
 */
function defaultNameForId(teamId: string): string | null {
  const catalogue = getJson<Array<{ id?: unknown; name?: unknown }> | null>(
    STORAGE_KEYS.catalogue,
    null,
  );
  if (!Array.isArray(catalogue)) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const entry of catalogue) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.id !== 'string' || entry.id !== teamId) continue;
    if (typeof entry.name !== 'string') continue;
    for (const def of DEFAULT_FAVORITE_TEAM_NAMES) {
      if (!teamMatchesFavorite(entry.name, [def])) continue;
      const score = normalizeName(def).length;
      if (score > bestScore) {
        bestScore = score;
        best = normalizeName(def);
      }
    }
  }
  return best;
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredTeamFav>(() => readStoredFav());
  const [favoriteTeamNames, setFavoriteTeamNames] = useState<string[]>(() =>
    DEFAULT_FAVORITE_TEAM_NAMES.slice(),
  );
  const [favoritePlayers, setFavoritePlayers] = useState<FavoritePlayer[]>(() => {
    const value = getJson<FavoritePlayer[]>(STORAGE_KEYS.favoritePlayers, []);
    return Array.isArray(value) ? value.filter((p) => p && typeof p.id === 'string') : [];
  });

  useEffect(() => {
    setJson(STORAGE_KEYS.favoritesTeams, stored);
    // Let the Rust poller pick up the new favourite list promptly.
    window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
  }, [stored]);

  useEffect(() => {
    setJson(STORAGE_KEYS.favoritePlayers, favoritePlayers);
  }, [favoritePlayers]);

  /**
   * Resolve default favourites against a loaded catalogue. Names the user has
   * dismissed are never re-seeded; names already seeded are not re-added.
   */
  const seedFromCatalogue = useCallback((catalogue: TeamCatalogueEntry[]) => {
    if (catalogue.length === 0) return;

    // Persist the nonsecret catalogue so notifications can resolve ids to names.
    const previous = getJson<
      Array<{ id: string; name: string; leagueName?: string; leagueId?: string }>
    >(STORAGE_KEYS.catalogue, []);
    const merged = new Map(
      (Array.isArray(previous) ? previous : [])
        .filter((t) => t && typeof t.id === 'string')
        .map((t) => [t.id, t]),
    );
    for (const t of catalogue)
      merged.set(t.id, { id: t.id, name: t.name, leagueName: t.leagueName, leagueId: t.leagueId });
    const nextCatalogue = [...merged.values()];
    if (JSON.stringify(previous) !== JSON.stringify(nextCatalogue)) {
      setJson(STORAGE_KEYS.catalogue, nextCatalogue);
      window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
    }

    setStored((prev) => {
      const knownIds = new Set(prev.ids);
      const dismissed = new Set(prev.dismissed ?? []);
      const seeded = new Set(prev.seeded ?? []);
      const nextIds = prev.ids.slice();
      let changed = false;
      for (const defaultName of DEFAULT_FAVORITE_TEAM_NAMES) {
        const key = normalizeName(defaultName);
        if (dismissed.has(key) || seeded.has(key)) continue;
        const found = catalogue.find((t) => teamMatchesFavorite(t.name, [defaultName]));
        if (!found) continue;
        seeded.add(key);
        changed = true;
        if (!knownIds.has(found.id)) {
          knownIds.add(found.id);
          nextIds.push(found.id);
        }
      }
      if (!changed) return prev;
      return { ...prev, ids: nextIds, seeded: Array.from(seeded), seededDefault: true };
    });
  }, []);

  const toggleTeam = useCallback((teamId: string) => {
    setStored((prev) => {
      const exists = prev.ids.includes(teamId);
      if (exists) {
        // Remember the dismissed default name so it is never re-seeded.
        const dismissed = new Set(prev.dismissed ?? []);
        const defaultName = defaultNameForId(teamId);
        if (defaultName) dismissed.add(defaultName);
        const seeded = new Set(prev.seeded ?? []);
        if (defaultName) seeded.delete(defaultName);
        return {
          ...prev,
          ids: prev.ids.filter((id) => id !== teamId),
          dismissed: Array.from(dismissed),
          seeded: Array.from(seeded),
        };
      }
      const seeded = new Set(prev.seeded ?? []);
      const dismissed = new Set(prev.dismissed ?? []);
      const defaultName = defaultNameForId(teamId);
      if (defaultName) {
        dismissed.delete(defaultName);
        seeded.add(defaultName);
      }
      return {
        ...prev,
        ids: [...prev.ids, teamId],
        dismissed: Array.from(dismissed),
        seeded: Array.from(seeded),
      };
    });
  }, []);

  const togglePlayer = useCallback((player: FavoritePlayer) => {
    setFavoritePlayers((prev) => {
      if (prev.some((p) => p.id === player.id)) return prev.filter((p) => p.id !== player.id);
      return [...prev, player];
    });
  }, []);

  // Keep the public favourite-name list aligned with the stored ids and
  // dismissed names so the dashboard never shows a user-removed club.
  useEffect(() => {
    const dismissed = new Set((stored.dismissed ?? []).map((n) => normalizeName(n)));
    const catalogue = getJson<Array<{ id?: unknown; name?: unknown }> | null>(
      STORAGE_KEYS.catalogue,
      null,
    );
    const nameById = new Map<string, string>();
    if (Array.isArray(catalogue)) {
      for (const entry of catalogue) {
        if (entry && typeof entry.id === 'string' && typeof entry.name === 'string')
          nameById.set(entry.id, entry.name);
      }
    }
    const names: string[] = [];
    for (const id of stored.ids) {
      const name = nameById.get(id);
      if (!name) continue;
      if (dismissed.has(normalizeName(name))) continue;
      names.push(name);
    }
    for (const def of DEFAULT_FAVORITE_TEAM_NAMES) {
      if (dismissed.has(normalizeName(def))) continue;
      if (teamMatchesFavorite(def, names)) continue;
      names.push(def);
    }
    setFavoriteTeamNames((prev) => {
      if (prev.length === names.length && prev.every((v, i) => v === names[i])) return prev;
      return names;
    });
  }, [stored]);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      teamIds: stored.ids,
      favoriteTeamNames,
      toggleTeam,
      isTeamFavorite: (id: string) => stored.ids.includes(id),
      favoritePlayers,
      togglePlayer,
      isPlayerFavorite: (id: string) => favoritePlayers.some((p) => p.id === id),
      seedFromCatalogue,
    }),
    [stored.ids, favoriteTeamNames, toggleTeam, favoritePlayers, togglePlayer, seedFromCatalogue],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider');
  return ctx;
}
