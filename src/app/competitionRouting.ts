import { useEffect } from 'react';
import {
  defaultFootballTab,
  isValidFootballTab,
  type FootballTab,
  type ShellRoute,
} from '../lib/navigation';
import { LEAGUES } from '../lib/navigationMetadata';
import { isCompetitionVisible, useModules } from '../lib/modules';

export type CompetitionVisibility = (competitionId: string) => boolean;

/**
 * Where «Футбол» goes when the module switches hide the current competition:
 * the first visible league keeps the tab, or «Сегодня» when no league is left.
 * null means the competition is visible and the route stays.
 */
export function hiddenCompetitionRoute(
  competitionId: string,
  tab?: FootballTab,
  isVisible: CompetitionVisibility = isCompetitionVisible,
): ShellRoute | null {
  if (isVisible(competitionId)) return null;
  const league = LEAGUES.find((item) => isVisible(item.id));
  if (!league) return { kind: 'today', mode: 'today' };
  return {
    kind: 'football',
    competitionId: league.id,
    tab: tab && isValidFootballTab(league.id, tab) ? tab : defaultFootballTab(league.id),
  };
}

/**
 * The new frame keeps one competition switcher, so a hidden competition never
 * stays on screen: neither after a module switch nor after a direct link.
 */
export function useHiddenCompetitionRedirect(
  route: ShellRoute,
  navigate: (route: ShellRoute) => void,
): void {
  const modules = useModules();
  useEffect(() => {
    if (route.kind !== 'football' && route.kind !== 'football-match') return;
    const next = hiddenCompetitionRoute(
      route.competitionId,
      route.kind === 'football' ? route.tab : undefined,
    );
    if (next) navigate(next);
    // modules re-runs the check when a switch changes; the storage read stays in one place.
  }, [route, modules, navigate]);
}
