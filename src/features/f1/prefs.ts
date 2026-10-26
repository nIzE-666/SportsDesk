/**
 * Favorites persistence (namespaced, defensive). Non-secret UI only.
 */

const DRIVER_KEY = 'sportsdesk.f1.favDrivers';
const TEAM_KEY = 'sportsdesk.f1.favTeams';

const DEFAULT_DRIVERS = ['max_verstappen'];
const DEFAULT_TEAMS = ['red_bull', 'mercedes', 'ferrari'];

function readList(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...fallback];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    /* ignore */
  }
  return [...fallback];
}

function writeList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(new Set(list))));
  } catch {
    /* storage may be unavailable */
  }
}

export function loadFavDrivers(): string[] {
  return readList(DRIVER_KEY, DEFAULT_DRIVERS);
}
export function saveFavDrivers(list: string[]): void {
  writeList(DRIVER_KEY, list);
}
export function loadFavTeams(): string[] {
  return readList(TEAM_KEY, DEFAULT_TEAMS);
}
export function saveFavTeams(list: string[]): void {
  writeList(TEAM_KEY, list);
}

export function readNotificationsEnabled(): boolean {
  try {
    const raw = localStorage.getItem('sportsdesk.notifications');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return (
      parsed === true ||
      (typeof parsed === 'object' && parsed && (parsed as Record<string, unknown>).enabled === true)
    );
  } catch {
    return false;
  }
}
