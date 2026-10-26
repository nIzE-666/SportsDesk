import contract from '../shared/sportsContracts.json';
export const DEFAULT_FAVORITE_TEAM_NAMES = contract.teams.map((team) => team.name);
const nameKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const aliases = new Map<string, string>();
for (const team of contract.teams)
  for (const alias of [team.name, ...team.aliases]) aliases.set(nameKey(alias), nameKey(team.name));
export function canonicalTeamName(name: string) {
  const key = nameKey(name);
  return aliases.get(key) ?? key;
}
export function teamMatchesFavorite(name: string | null | undefined, favorites: readonly string[]) {
  if (!name) return false;
  const key = canonicalTeamName(name);
  return !!key && favorites.some((favorite) => canonicalTeamName(favorite) === key);
}
export interface FavoriteTeamIdentity {
  id: string;
  name: string;
  leagueId?: string;
}
export function matchesFavoriteIdentity(
  team: { id?: string | null; name?: string | null },
  favorites: readonly FavoriteTeamIdentity[],
  provider: 'pitch' | 'other' = 'pitch',
) {
  if (provider === 'pitch' && team.id) return favorites.some((favorite) => favorite.id === team.id);
  return teamMatchesFavorite(
    team.name,
    favorites.map((favorite) => favorite.name),
  );
}
export type MatchState = 'finished' | 'cancelled' | 'postponed' | 'live' | 'scheduled' | 'unknown';
const statusKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
export function classifyMatchStatus(...values: Array<string | null | undefined>): MatchState {
  const keys = values.filter((v): v is string => typeof v === 'string').map(statusKey);
  for (const state of ['finished', 'cancelled', 'postponed', 'live', 'scheduled'] as const) {
    if (keys.some((key) => contract.statuses[state].includes(key))) return state;
  }
  return 'unknown';
}
export function matchStateLabel(...values: Array<string | null | undefined>) {
  return {
    finished: 'Завершён',
    cancelled: 'Отменён',
    postponed: 'Перенесён / приостановлен',
    live: 'В игре',
    scheduled: 'Запланирован',
    unknown: 'Статус уточняется',
  }[classifyMatchStatus(...values)];
}
