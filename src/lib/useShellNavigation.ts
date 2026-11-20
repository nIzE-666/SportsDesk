import { useCallback, useEffect, useRef, useState } from 'react';
import { getString, setString } from '../features/football/storage';
import { isModuleOn } from './modules';
import { viewState } from './viewState';
import {
  competitionKind,
  isStartSection,
  migrateCupId,
  migrateLeagueId,
  migrateSport,
  rememberedLocation,
  sectionOfRoute,
  sportOfRoute,
  START_SECTION,
  START_SECTION_KEY,
  startLocation,
  type Location,
  type RememberedSources,
  type Section,
  type ShellRoute,
} from './navigation';
export type { Location } from './navigation';

interface State {
  entries: Location[];
  cursor: number;
}

function readRaw(key: string): unknown {
  return viewState.read<unknown>(key, undefined, () => true);
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

function initial(): State {
  const savedSport = migrateSport(getString('sportsdesk.sport'));
  const leagueId = migrateLeagueId(getString('sportsdesk.league'));
  const cupId = migrateCupId(getString('sportsdesk.cup.current'));
  const preferred = getString(START_SECTION_KEY);
  const section = isModuleOn('home') && isStartSection(preferred) ? preferred : START_SECTION;
  return { entries: [startLocation(leagueId, cupId, savedSport, section)], cursor: 0 };
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
        const next: Location = {
          ...previous,
          ...overrides,
          section: sectionOfRoute(route) ?? overrides.section ?? previous.section,
          sport: sportOfRoute(route) ?? overrides.sport ?? previous.sport,
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
  const changeSection = useCallback(
    (section: Section) => {
      const current = ref.current.entries[ref.current.cursor]!;
      const target = rememberedLocation(section, sourcesForSection(section), {
        sport: current.sport,
        leagueId: current.leagueId,
        cupId: current.cupId,
      });
      navigate(target.route, target);
    },
    [navigate],
  );
  useEffect(() => {
    setString('sportsdesk.sport', location.sport);
    setString('sportsdesk.league', location.leagueId);
    setString('sportsdesk.cup.current', location.cupId);
    const section = sectionOfRoute(location.route);
    if (section) viewState.write('navigation2.' + section, location);
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
    changeSection,
    canBack: state.cursor > 0,
  };
}
