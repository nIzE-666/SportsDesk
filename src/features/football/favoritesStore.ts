import { DEFAULT_FAVORITE_TEAM_NAMES, teamMatchesFavorite } from '../../lib/sportsIdentity';
import { getJson, getString, normalizeName, setJson, STORAGE_KEYS } from './storage';
import type { FavoritePlayer } from './types';

/**
 * Единое хранилище избранного для всего приложения.
 *
 * Состояние живёт в localStorage и читается заново, как только меняется
 * сохранённая строка. Поэтому все экраны (матчи, планировщик, ЛЧ, настройки,
 * мастер первого запуска) видят одно и то же избранное и не перезаписывают
 * изменения друг друга. Основная идентичность клуба — id источника; названия
 * служат только для поиска и для клубов по умолчанию.
 */

export interface StoredTeamFav {
  ids: string[];
  seededDefault?: boolean;
  /** Клубы по умолчанию, которые пользователь убрал (больше не возвращаются сами). */
  dismissed?: string[];
  /** Клубы по умолчанию, уже сопоставленные с id источника. */
  seeded?: string[];
}

export interface CatalogueTeam {
  id: string;
  name: string;
  leagueName?: string;
  leagueId?: string;
}

export interface FavoritesSnapshot {
  stored: StoredTeamFav;
  teamIds: string[];
  favoriteTeamNames: string[];
  favoritePlayers: FavoritePlayer[];
  catalogue: CatalogueTeam[];
}

export const FAVORITES_CHANGED_EVENT = 'sportsdesk-favorites-changed';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

export function readStoredFav(): StoredTeamFav {
  const raw = getJson<StoredTeamFav | null>(STORAGE_KEYS.favoritesTeams, null);
  if (!raw || typeof raw !== 'object') return { ids: [] };
  return {
    ids: strings(raw.ids),
    dismissed: strings(raw.dismissed),
    seeded: strings(raw.seeded),
    seededDefault: Boolean(raw.seededDefault),
  };
}

export function readCatalogue(): CatalogueTeam[] {
  const raw = getJson<unknown>(STORAGE_KEYS.catalogue, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is CatalogueTeam =>
      !!t && typeof t === 'object' && typeof t.id === 'string' && typeof t.name === 'string',
  );
}

function readPlayers(): FavoritePlayer[] {
  const value = getJson<FavoritePlayer[]>(STORAGE_KEYS.favoritePlayers, []);
  return Array.isArray(value) ? value.filter((p) => p && typeof p.id === 'string') : [];
}

export function resolveNames(stored: StoredTeamFav, catalogue: CatalogueTeam[]): string[] {
  const dismissed = new Set((stored.dismissed ?? []).map((n) => normalizeName(n)));
  const nameById = new Map(catalogue.map((t) => [t.id, t.name]));
  const names: string[] = [];
  for (const id of stored.ids) {
    const name = nameById.get(id);
    if (!name || dismissed.has(normalizeName(name))) continue;
    names.push(name);
  }
  for (const def of DEFAULT_FAVORITE_TEAM_NAMES) {
    if (dismissed.has(normalizeName(def))) continue;
    if (teamMatchesFavorite(def, names)) continue;
    names.push(def);
  }
  return names;
}

/** Имя клуба по умолчанию, которому соответствует id (через сохранённый каталог). */
export function defaultNameForId(teamId: string, catalogue = readCatalogue()): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const entry of catalogue) {
    if (entry.id !== teamId) continue;
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

let cacheKey: string | null = null;
let cache: FavoritesSnapshot | null = null;

function storageKey(): string {
  return JSON.stringify([
    getString(STORAGE_KEYS.favoritesTeams),
    getString(STORAGE_KEYS.favoritePlayers),
    getString(STORAGE_KEYS.catalogue),
  ]);
}

/** Стабильный снимок: новый объект появляется только при изменении сохранённых данных. */
export function getFavoritesSnapshot(): FavoritesSnapshot {
  const key = storageKey();
  if (cache && key === cacheKey) return cache;
  const stored = readStoredFav();
  const catalogue = readCatalogue();
  cache = {
    stored,
    teamIds: stored.ids,
    favoriteTeamNames: resolveNames(stored, catalogue),
    favoritePlayers: readPlayers(),
    catalogue,
  };
  cacheKey = key;
  return cache;
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeFavorites(listener: () => void): () => void {
  listeners.add(listener);
  const onWindow = () => listener();
  window.addEventListener('storage', onWindow);
  window.addEventListener('sportsdesk-storage-changed', onWindow);
  window.addEventListener(FAVORITES_CHANGED_EVENT, onWindow);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onWindow);
    window.removeEventListener('sportsdesk-storage-changed', onWindow);
    window.removeEventListener(FAVORITES_CHANGED_EVENT, onWindow);
  };
}

function writeStored(next: StoredTeamFav): void {
  setJson(STORAGE_KEYS.favoritesTeams, next);
  emit();
  // Фоновый опрос на Rust сразу получает новый список.
  window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
}

export function addFavoriteTeam(teamId: string): void {
  const prev = readStoredFav();
  if (prev.ids.includes(teamId)) return;
  const seeded = new Set(prev.seeded ?? []);
  const dismissed = new Set(prev.dismissed ?? []);
  const defaultName = defaultNameForId(teamId);
  if (defaultName) {
    dismissed.delete(defaultName);
    seeded.add(defaultName);
  }
  writeStored({
    ...prev,
    ids: [...prev.ids, teamId],
    dismissed: [...dismissed],
    seeded: [...seeded],
  });
}

export function removeFavoriteTeam(teamId: string): void {
  const prev = readStoredFav();
  if (!prev.ids.includes(teamId)) return;
  const dismissed = new Set(prev.dismissed ?? []);
  const seeded = new Set(prev.seeded ?? []);
  const defaultName = defaultNameForId(teamId);
  if (defaultName) {
    // Убранный клуб по умолчанию не возвращается автоматически.
    dismissed.add(defaultName);
    seeded.delete(defaultName);
  }
  writeStored({
    ...prev,
    ids: prev.ids.filter((id) => id !== teamId),
    dismissed: [...dismissed],
    seeded: [...seeded],
  });
}

export function toggleFavoriteTeam(teamId: string): void {
  if (readStoredFav().ids.includes(teamId)) removeFavoriteTeam(teamId);
  else addFavoriteTeam(teamId);
}

/** Убрать клуб по умолчанию, даже если он ещё не сопоставлен с каталогом. */
export function dismissDefaultTeam(name: string): void {
  const key = normalizeName(name);
  const prev = readStoredFav();
  const catalogue = readCatalogue();
  const matching = new Set(
    catalogue.filter((t) => teamMatchesFavorite(t.name, [name])).map((t) => t.id),
  );
  const dismissed = new Set(prev.dismissed ?? []);
  const seeded = new Set(prev.seeded ?? []);
  dismissed.add(key);
  seeded.delete(key);
  writeStored({
    ...prev,
    ids: prev.ids.filter((id) => !matching.has(id)),
    dismissed: [...dismissed],
    seeded: [...seeded],
  });
}

/** Вернуть убранный клуб по умолчанию — только по явному действию пользователя. */
export function restoreDefaultTeam(name: string): void {
  const key = normalizeName(name);
  const prev = readStoredFav();
  const dismissed = new Set(prev.dismissed ?? []);
  dismissed.delete(key);
  const seeded = new Set(prev.seeded ?? []);
  const ids = prev.ids.slice();
  const found = readCatalogue().find((t) => teamMatchesFavorite(t.name, [name]));
  if (found) {
    seeded.add(key);
    if (!ids.includes(found.id)) ids.push(found.id);
  }
  writeStored({ ...prev, ids, dismissed: [...dismissed], seeded: [...seeded] });
}

/** Клубы по умолчанию, которые пользователь убрал. */
export function dismissedDefaultTeams(stored: StoredTeamFav): string[] {
  const dismissed = new Set(stored.dismissed ?? []);
  return DEFAULT_FAVORITE_TEAM_NAMES.filter((n) => dismissed.has(normalizeName(n)));
}

export function toggleFavoritePlayer(player: FavoritePlayer): void {
  const prev = readPlayers();
  const next = prev.some((p) => p.id === player.id)
    ? prev.filter((p) => p.id !== player.id)
    : [...prev, player];
  setJson(STORAGE_KEYS.favoritePlayers, next);
  emit();
}

/**
 * Сохраняет каталог (для имён в уведомлениях) и сопоставляет клубы по
 * умолчанию с id источника. Убранные и уже сопоставленные не добавляются.
 */
export function seedFavoritesFromCatalogue(entries: CatalogueTeam[]): void {
  if (entries.length === 0) return;
  const previous = readCatalogue();
  const merged = new Map(previous.map((t) => [t.id, t]));
  for (const t of entries)
    merged.set(t.id, { id: t.id, name: t.name, leagueName: t.leagueName, leagueId: t.leagueId });
  const nextCatalogue = [...merged.values()];
  if (JSON.stringify(previous) !== JSON.stringify(nextCatalogue)) {
    setJson(STORAGE_KEYS.catalogue, nextCatalogue);
    emit();
    window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
  }

  const prev = readStoredFav();
  const knownIds = new Set(prev.ids);
  const dismissed = new Set(prev.dismissed ?? []);
  const seeded = new Set(prev.seeded ?? []);
  const nextIds = prev.ids.slice();
  let changed = false;
  for (const defaultName of DEFAULT_FAVORITE_TEAM_NAMES) {
    const key = normalizeName(defaultName);
    if (dismissed.has(key) || seeded.has(key)) continue;
    const found = entries.find((t) => teamMatchesFavorite(t.name, [defaultName]));
    if (!found) continue;
    seeded.add(key);
    changed = true;
    if (!knownIds.has(found.id)) {
      knownIds.add(found.id);
      nextIds.push(found.id);
    }
  }
  if (changed) writeStored({ ...prev, ids: nextIds, seeded: [...seeded], seededDefault: true });
}
