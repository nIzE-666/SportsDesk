import { useCallback, useEffect, useRef, useState } from 'react';
import { getString, setString } from '../features/football/storage';
import { viewState } from './viewState';
import {
  homeRoute,
  isContentRoute,
  isValidContentRoute,
  type ShellRoute,
  type Sport,
} from './navigation';
export interface Location {
  sport: Sport;
  leagueId: string;
  cupId: string;
  route: ShellRoute;
}
function valid(value: unknown): value is Location {
  if (!value || typeof value !== 'object') return false;
  const l = value as Location;
  if (
    !['football', 'f1', 'ucl', 'cup'].includes(l.sport) ||
    typeof l.leagueId !== 'string' ||
    typeof l.cupId !== 'string' ||
    !l.route
  )
    return false;
  if (!isValidContentRoute(l.route)) return false;
  return l.route.kind === 'football-match' ? l.sport === 'football' : l.route.kind === l.sport;
}
function remembered(sport: Sport, leagueId: string, cupId: string): Location {
  let route: ShellRoute = homeRoute(sport, cupId);
  const legacy = viewState.read('navigation.' + sport, route, isValidContentRoute);
  if (sport === 'football' && (legacy.kind === 'football' || legacy.kind === 'football-match'))
    route = legacy;
  else if (sport === 'f1') {
    const tab = viewState.read('navigation.f1.tab', 'overview');
    const candidate = { kind: 'f1' as const, tab };
    if (isValidContentRoute(candidate)) route = candidate;
  } else if (sport === 'ucl') {
    const tab = viewState.read('navigation.ucl.tab', 'overview');
    const candidate = { kind: 'ucl' as const, tab };
    if (isValidContentRoute(candidate)) route = candidate;
  } else if (sport === 'cup' && legacy.kind === 'cup') route = legacy;
  return viewState.read<Location>('navigation2.' + sport, { sport, leagueId, cupId, route }, valid);
}
function initial() {
  const saved = getString('sportsdesk.sport');
  const sport: Sport = saved === 'f1' || saved === 'ucl' || saved === 'cup' ? saved : 'football';
  const location = remembered(
    sport,
    getString('sportsdesk.league') ?? 'l_4WFCIZ',
    getString('sportsdesk.cup.current') ?? 'l_38d9HA',
  );
  // A directly restored match still has a useful Back target.
  const entries =
    location.route.kind === 'football-match'
      ? [
          { ...location, route: { kind: 'football' as const, section: 'matches' as const } },
          location,
        ]
      : [location];
  return { entries, cursor: entries.length - 1 };
}
export function useShellNavigation() {
  const [state, setState] = useState(initial),
    ref = useRef(state);
  ref.current = state;
  const location = state.entries[state.cursor]!;
  const navigate = useCallback(
    (route: ShellRoute, overrides: Partial<Omit<Location, 'route'>> = {}) => {
      setState((current) => {
        const previous = current.entries[current.cursor]!;
        const sport: Sport = isContentRoute(route)
          ? route.kind === 'football-match'
            ? 'football'
            : route.kind
          : previous.sport;
        const next: Location = { ...previous, ...overrides, sport, route };
        if (route.kind === 'cup') next.cupId = route.cupId;
        if (JSON.stringify(next) === JSON.stringify(previous)) return current;
        const entries = [...current.entries.slice(0, current.cursor + 1), next].slice(-100);
        return { entries, cursor: entries.length - 1 };
      });
    },
    [],
  );
  const back = useCallback(
    () =>
      setState((current) =>
        current.cursor > 0 ? { ...current, cursor: current.cursor - 1 } : current,
      ),
    [],
  );
  const forward = useCallback(
    () => setState((s) => (s.cursor < s.entries.length - 1 ? { ...s, cursor: s.cursor + 1 } : s)),
    [],
  );
  const changeSport = useCallback(
    (sport: Sport) => {
      const current = ref.current.entries[ref.current.cursor]!;
      const target = remembered(sport, current.leagueId, current.cupId);
      navigate(target.route, target);
    },
    [navigate],
  );
  const auxiliary = useCallback(
    (kind: 'watch' | 'settings' | 'planner' | 'events' | 'games') => {
      const s = ref.current,
        current = s.entries[s.cursor]!;
      if (current.route.kind === kind) {
        back();
        return;
      }
      if (
        kind === 'planner' &&
        current.route.kind === 'football-match' &&
        s.entries[s.cursor - 1]?.route.kind === 'planner'
      ) {
        back();
        return;
      }
      navigate({ kind });
    },
    [navigate, back],
  );
  useEffect(() => {
    setString('sportsdesk.sport', location.sport);
    setString('sportsdesk.league', location.leagueId);
    setString('sportsdesk.cup.current', location.cupId);
    if (isContentRoute(location.route)) {
      viewState.write('navigation2.' + location.sport, location);
      viewState.write('navigation.' + location.sport, location.route);
    }
  }, [location]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') back();
        else forward();
      }
    };
    const mouse = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        if (e.button === 3) back();
        else forward();
      }
    };
    const prevent = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    window.addEventListener('keydown', keyboard);
    window.addEventListener('mouseup', mouse);
    window.addEventListener('auxclick', prevent);
    return () => {
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('mouseup', mouse);
      window.removeEventListener('auxclick', prevent);
    };
  }, [back, forward]);
  return {
    ...location,
    navigate,
    back,
    forward,
    changeSport,
    auxiliary,
    canBack: state.cursor > 0,
  };
}
