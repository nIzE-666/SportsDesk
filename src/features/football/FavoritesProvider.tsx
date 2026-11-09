import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { FavoritePlayer } from './types';
import type { TeamCatalogueEntry } from './useFootballData';
import {
  getFavoritesSnapshot,
  seedFavoritesFromCatalogue,
  subscribeFavorites,
  toggleFavoritePlayer,
  toggleFavoriteTeam,
} from './favoritesStore';

import { teamMatchesFavorite } from '../../lib/sportsIdentity';
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
  /** Resolve unresolved defaults against a loaded team catalogue; call from effects. */
  seedFromCatalogue: (catalogue: TeamCatalogueEntry[]) => void;
}

/**
 * Совместимая обёртка: избранное хранится в общем хранилище, поэтому провайдер
 * больше не держит собственного состояния и может стоять где угодно (или не стоять).
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useFavorites(): FavoritesContextValue {
  const snapshot = useSyncExternalStore(
    subscribeFavorites,
    getFavoritesSnapshot,
    getFavoritesSnapshot,
  );
  return useMemo<FavoritesContextValue>(
    () => ({
      teamIds: snapshot.teamIds,
      favoriteTeamNames: snapshot.favoriteTeamNames,
      toggleTeam: toggleFavoriteTeam,
      isTeamFavorite: (id: string) => snapshot.teamIds.includes(id),
      favoritePlayers: snapshot.favoritePlayers,
      togglePlayer: toggleFavoritePlayer,
      isPlayerFavorite: (id: string) => snapshot.favoritePlayers.some((p) => p.id === id),
      seedFromCatalogue: seedFavoritesFromCatalogue,
    }),
    [snapshot],
  );
}
