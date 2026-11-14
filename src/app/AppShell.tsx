import { LEAGUES } from '../lib/navigationMetadata';
import { competitionKind, type ShellRoute } from '../lib/navigation';
import { NavRail } from './NavRail';
import { PageHeader } from './PageHeader';
import { RouteContent } from './RouteContent';
import type { FrameProps } from './frame';
import './shell.css';

/** The new five-section frame: permanent rail, thin header and page content. */
export function AppShell(props: FrameProps) {
  const {
    route,
    leagueId,
    cupId,
    design,
    scheme,
    density,
    canBack,
    onBack,
    navigate,
    changeSection,
    setLeagueId,
    searchTarget,
    openFootballMatch,
    openWeekend,
    openMini,
    children,
  } = props;
  const service =
    route.kind === 'settings' ||
    route.kind === 'events' ||
    route.kind === 'offline' ||
    route.kind === 'watch';
  const competition =
    route.kind === 'football' || route.kind === 'football-match'
      ? competitionKind(route.competitionId)
      : competitionKind(leagueId);
  const leagueTheme = LEAGUES.find((league) => league.id === leagueId)?.theme ?? 'epl';
  const appSport = service ? 'neutral' : route.kind === 'f1' ? 'f1' : 'football';
  const appTheme = service
    ? 'neutral'
    : route.kind === 'f1'
      ? 'f1'
      : competition === 'ucl' || competition === 'cup'
        ? 'ucl'
        : leagueTheme;
  const contentSport = route.kind === 'f1' ? 'f1' : 'football';
  const contentRoute: ShellRoute =
    route.kind === 'my' && route.tab !== 'games' ? { kind: 'my', tab: 'diary' } : route;

  return (
    <div
      className="app-root app-root-shell"
      data-sport={appSport}
      data-theme={appTheme}
      data-scheme={scheme}
      data-density={density}
      data-design={design}
    >
      {children}
      <div className="shell-frame">
        <NavRail
          route={route}
          onChangeSection={changeSection}
          onOpenEvents={() => navigate({ kind: 'events' })}
          onOpenSettings={() => navigate({ kind: 'settings' })}
        />
        <div className="shell-main">
          <PageHeader
            route={route}
            leagueId={leagueId}
            sport={contentSport}
            canBack={canBack}
            onBack={onBack}
            onNavigate={navigate}
            onSearchTarget={searchTarget}
            onOpenMini={openMini}
          />
          <main className="content shell-content" tabIndex={-1}>
            <div className="content-inner">
              <RouteContent
                route={contentRoute}
                sport={contentSport}
                leagueId={leagueId}
                cupId={cupId}
                onNavigate={navigate}
                onLeagueChange={setLeagueId}
                onOpenMatch={openFootballMatch}
                onOpenWeekend={openWeekend}
                onBack={onBack}
              />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
