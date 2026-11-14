import { useCallback, useEffect, useRef, useState } from 'react';
import { getString, setString } from '../features/football/storage';
import { viewState } from './viewState';
import {
  competitionKind,
  defaultRouteOf,
  legacySportOfRoute,
  locationForRoute,
  migrateCupId,
  migrateLeagueId,
  migrateSport,
  rememberedLegacySport,
  rememberedLocation,
  sectionOfRoute,
  startLocation,
  type Location,
  type RememberedSources,
  type Section,
  type ShellRoute,
  type Sport,
} from './navigation';
export type { Location } from './navigation';

interface State {
  entries: Location[];
  cursor: number;
}
export interface ShellNavigationOptions {
  /** U2.2 uses this behind the temporary flag (decision 3 in section 9). */
  startOnToday?: boolean;
}

function readRaw(key: string): unknown {
  return viewState.read<unknown>(key, undefined, () => true);
}

function sourcesForLegacySport(sport: Sport): RememberedSources {
  if (sport === 'football')
    return { location: readRaw('navigation2.football'), route: readRaw('navigation.football') };
  if (sport === 'f1')
    return {
      location: readRaw('navigation2.f1'),
      route: readRaw('navigation.f1'),
      tab: readRaw('navigation.f1.tab'),
    };
  if (sport === 'ucl')
    return {
      location: readRaw('navigation2.ucl'),
      route: readRaw('navigation.ucl'),
      tab: readRaw('navigation.ucl.tab'),
    };
  return { location: readRaw('navigation2.cup'), route: readRaw('navigation.cup') };
}

function sourcesForSection(section: Section): RememberedSources {
  if (section === 'football')
    return { location: readRaw('navigation2.football'), route: readRaw('navigation.football') };
  if (section === 'f1')
    return {
      location: readRaw('navigation2.f1'),
      route: readRaw('navigation.f1'),
      tab: readRaw('navigation.f1.tab'),
    };
  return { location: readRaw(`navigation2.${section}`) };
}

function initial(startOnToday = false): State {
  const savedSport = migrateSport(getString('sportsdesk.sport'));
  const leagueId = migrateLeagueId(getString('sportsdesk.league'));
  const cupId = migrateCupId(getString('sportsdesk.cup.current'));
  if (startOnToday) {
    const start = startLocation(leagueId, cupId);
    return { entries: [start], cursor: 0 };
  }
  const location = rememberedLegacySport(
    savedSport,
    sourcesForLegacySport(savedSport),
    { sport: savedSport, leagueId, cupId },
    cupId,
  );
  // A directly restored match still has a useful Back target.
  const entries =
    location.route.kind === 'football-match'
      ? [
          locationForRoute(
            {
              kind: 'football',
              competitionId: location.route.competitionId,
              tab: 'matches',
            },
            location,
          ),
          location,
        ]
      : [location];
  return { entries, cursor: entries.length - 1 };
}

export function useShellNavigation({ startOnToday = false }: ShellNavigationOptions = {}) {
  const [state, setState] = useState(() => initial(startOnToday)),
    ref = useRef(state);
  ref.current = state;
  const location = state.entries[state.cursor]!;
  const navigate = useCallback(
    (route: ShellRoute, overrides: Partial<Omit<Location, 'route'>> = {}) => {
      setState((current) => {
        const previous = current.entries[current.cursor]!;
        const next: Location = {
          ...previous,
          ...overrides,
          section: sectionOfRoute(route) ?? overrides.section ?? previous.section,
          sport: legacySportOfRoute(route) ?? overrides.sport ?? previous.sport,
          route,
        };
        if (route.kind === 'football' || route.kind === 'football-match') {
          const kind = competitionKind(route.competitionId);
          if (kind === 'league') next.leagueId = route.competitionId;
          else if (kind === 'cup') next.cupId = route.competitionId;
        }
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
  const rememberLegacy = useCallback((sport: Sport, current: Location) => {
    const target = rememberedLegacySport(
      sport,
      sourcesForLegacySport(sport),
      { sport, leagueId: current.leagueId, cupId: current.cupId },
      current.cupId,
    );
    return target;
  }, []);
  const changeSport = useCallback(
    (sport: Sport) => {
      const current = ref.current.entries[ref.current.cursor]!;
      const target = rememberLegacy(sport, current);
      navigate(target.route, target);
    },
    [navigate, rememberLegacy],
  );
  const changeSection = useCallback(
    (section: Section) => {
      const current = ref.current.entries[ref.current.cursor]!;
      const target = rememberedLocation(
        section,
        sourcesForSection(section),
        { sport: current.sport, leagueId: current.leagueId, cupId: current.cupId },
        defaultRouteOf(section, current.leagueId),
      );
      navigate(target.route, target);
    },
    [navigate],
  );
  const auxiliary = useCallback(
    (kind: 'watch' | 'settings' | 'planner' | 'events' | 'games' | 'diary' | 'offline') => {
      const s = ref.current,
        current = s.entries[s.cursor]!,
        previous = s.entries[s.cursor - 1];
      const route = current.route;
      const active =
        kind === 'watch'
          ? route.kind === 'watch'
          : kind === 'settings'
            ? route.kind === 'settings'
            : kind === 'events'
              ? route.kind === 'events'
              : kind === 'offline'
                ? route.kind === 'offline'
                : kind === 'planner'
                  ? route.kind === 'today' && route.mode === 'plan'
                  : kind === 'games'
                    ? route.kind === 'my' && route.tab === 'games'
                    : route.kind === 'my' && route.tab === 'diary';
      if (active) {
        back();
        return;
      }
      if (
        kind === 'planner' &&
        route.kind === 'football-match' &&
        previous?.route.kind === 'today' &&
        previous.route.mode === 'plan'
      ) {
        back();
        return;
      }
      navigate(
        kind === 'planner'
          ? { kind: 'today', mode: 'plan' }
          : kind === 'games'
            ? { kind: 'my', tab: 'games' }
            : kind === 'diary'
              ? { kind: 'my', tab: 'diary' }
              : { kind },
      );
    },
    [navigate, back],
  );
  useEffect(() => {
    setString('sportsdesk.sport', location.sport);
    setString('sportsdesk.league', location.leagueId);
    setString('sportsdesk.cup.current', location.cupId);
    const section = sectionOfRoute(location.route);
    if (section) viewState.write('navigation2.' + section, location);
    const legacySport = legacySportOfRoute(location.route);
    if (legacySport) {
      viewState.write('navigation2.' + legacySport, location);
      viewState.write('navigation.' + legacySport, location.route);
    } else if (location.route.kind === 'today' && location.route.mode !== 'plan') {
      // «Мой обзор» was the football home until U2.1; keep the legacy switch there.
      viewState.write('navigation.football', location.route);
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
    changeSection,
    auxiliary,
    canBack: state.cursor > 0,
  };
}
