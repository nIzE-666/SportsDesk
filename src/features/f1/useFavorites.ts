import { useCallback, useSyncExternalStore } from 'react';
import { loadFavDrivers, loadFavTeams, saveFavDrivers, saveFavTeams } from './prefs';

// Module-level listeners so multiple components stay in sync via localStorage.
const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let driversCache: string[] | null = null;
let teamsCache: string[] | null = null;
let driversSnapshot = '';
let teamsSnapshot = '';

function getDriversSnapshot(): string {
  if (driversCache === null) driversCache = loadFavDrivers();
  return driversSnapshot;
}
function getTeamsSnapshot(): string {
  if (teamsCache === null) teamsCache = loadFavTeams();
  return teamsSnapshot;
}

// We keep a snapshot string updated whenever we mutate so useSyncExternalStore
// can provide stable references. Arrays are parsed from cache at read time.
function readDrivers(): string[] {
  if (driversCache === null) driversCache = loadFavDrivers();
  return driversCache;
}
function readTeams(): string[] {
  if (teamsCache === null) teamsCache = loadFavTeams();
  return teamsCache;
}

export function useFavoriteDrivers(): [string[], (id: string) => void] {
  const snap = useSyncExternalStore(subscribe, getDriversSnapshot, getDriversSnapshot);
  // ensure recompute reacts to snapshot change
  void snap;
  const list = readDrivers();
  const toggle = useCallback((id: string) => {
    const current = readDrivers();
    const has = current.includes(id);
    const next = has ? current.filter((x) => x !== id) : [...current, id];
    driversCache = next;
    saveFavDrivers(next);
    driversSnapshot = next.join('|');
    emit();
  }, []);
  return [list, toggle];
}

export function useFavoriteTeams(): [string[], (id: string) => void] {
  const snap = useSyncExternalStore(subscribe, getTeamsSnapshot, getTeamsSnapshot);
  void snap;
  const list = readTeams();
  const toggle = useCallback((id: string) => {
    const current = readTeams();
    const has = current.includes(id);
    const next = has ? current.filter((x) => x !== id) : [...current, id];
    teamsCache = next;
    saveFavTeams(next);
    teamsSnapshot = next.join('|');
    emit();
  }, []);
  return [list, toggle];
}
