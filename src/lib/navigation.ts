import type { WatchIntent } from './watchIntent';
export type Sport = 'football' | 'f1' | 'ucl' | 'cup';
export type FootballSection = 'dashboard' | 'matches' | 'standings' | 'live' | 'team' | 'players';
export type ContentRoute =
  | { kind: 'football'; section: FootballSection; teamId?: string }
  | { kind: 'football-match'; matchId: string }
  | { kind: 'f1'; tab?: 'overview' | 'calendar' | 'standings' | 'compare' | 'pace' | 'session' }
  | { kind: 'ucl'; tab?: 'overview' | 'table' | 'bracket' | 'matches' | 'stats' }
  | { kind: 'cup'; cupId: string; tab?: 'overview' | 'table' | 'bracket' | 'matches' };
export type ShellRoute =
  | ContentRoute
  | { kind: 'watch'; channelId?: number; intent?: WatchIntent }
  | { kind: 'settings' }
  | { kind: 'planner' }
  | { kind: 'events' }
  | { kind: 'games' };

export function homeRoute(sport: Sport, cupId: string): ContentRoute {
  return sport === 'cup'
    ? { kind: 'cup', cupId, tab: 'overview' }
    : sport === 'f1'
      ? { kind: 'f1', tab: 'overview' }
      : sport === 'ucl'
        ? { kind: 'ucl', tab: 'overview' }
        : { kind: 'football', section: 'dashboard' };
}
export function isContentRoute(route: ShellRoute): route is ContentRoute {
  return (
    route.kind !== 'watch' &&
    route.kind !== 'settings' &&
    route.kind !== 'planner' &&
    route.kind !== 'events' &&
    route.kind !== 'games'
  );
}
export function isValidContentRoute(value: unknown): value is ContentRoute {
  if (!value || typeof value !== 'object') return false;
  const route = value as Record<string, unknown>;
  if (route.kind === 'football')
    return (
      ['dashboard', 'matches', 'standings', 'live', 'team', 'players'].includes(
        String(route.section),
      ) &&
      (route.teamId === undefined || typeof route.teamId === 'string')
    );
  if (route.kind === 'football-match')
    return typeof route.matchId === 'string' && route.matchId.length > 0;
  if (route.kind === 'f1')
    return (
      route.tab === undefined ||
      ['overview', 'calendar', 'standings', 'compare', 'pace', 'session'].includes(
        String(route.tab),
      )
    );
  if (route.kind === 'ucl')
    return (
      route.tab === undefined ||
      ['overview', 'table', 'bracket', 'matches', 'stats'].includes(String(route.tab))
    );
  return (
    route.kind === 'cup' &&
    typeof route.cupId === 'string' &&
    route.cupId.length > 0 &&
    (route.tab === undefined ||
      ['overview', 'table', 'bracket', 'matches'].includes(String(route.tab)))
  );
}
export function toggleAuxiliary(
  route: ShellRoute,
  kind: 'watch' | 'settings',
  previous: ShellRoute,
): ShellRoute {
  return route.kind === kind ? previous : { kind };
}
