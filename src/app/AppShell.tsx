import { useEffect, useRef, useState } from 'react';
import { LEAGUES } from '../lib/navigationMetadata';
import { competitionKind, type ShellRoute } from '../lib/navigation';
import { useModules } from '../lib/modules';
import type { SportsEvent } from '../features/events/EventCenter';
import { useUnreadEvents } from '../features/events/unreadEvents';
import { EventsDrawer } from './EventsDrawer';
import { useHiddenCompetitionRedirect } from './competitionRouting';
import { NavRail } from './NavRail';
import { PageHeader } from './PageHeader';
import { RouteContent } from './RouteContent';
import type { FrameProps } from './frame';
import './shell.css';

const TODAY: ShellRoute = { kind: 'today', mode: 'today' };

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
  const modules = useModules();
  const unread = useUnreadEvents();
  const [eventsOpen, setEventsOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  // «Смотреть» is gone with its module off, so a direct link lands on «Сегодня».
  const normalizedRoute: ShellRoute = route.kind === 'watch' && !modules.watch ? TODAY : route;
  const previousRoute = useRef<ShellRoute>(
    normalizedRoute.kind === 'events' ? TODAY : normalizedRoute,
  );
  useEffect(() => {
    if (normalizedRoute.kind !== 'events') previousRoute.current = normalizedRoute;
  }, [normalizedRoute]);
  useEffect(() => {
    if (route.kind === 'watch' && !modules.watch) navigate(TODAY);
  }, [route.kind, modules.watch, navigate]);
  useEffect(() => setEventsOpen(false), [route]);
  // The events route of search and old links is a drawer over the last page.
  const pageRoute = route.kind === 'events' ? previousRoute.current : normalizedRoute;
  const drawerOpen = eventsOpen || route.kind === 'events';
  const closeEvents = () => {
    setEventsOpen(false);
    if (route.kind === 'events') navigate(pageRoute);
  };
  const openEvent = (event: SportsEvent) => {
    setEventsOpen(false);
    if (event.sport === 'f1' && event.season && event.round) {
      openWeekend(event.season, event.round);
      return;
    }
    if (event.matchId) {
      openFootballMatch(event.matchId, event.leagueId);
      return;
    }
    if (route.kind === 'events') navigate(pageRoute);
  };
  const service =
    pageRoute.kind === 'settings' || pageRoute.kind === 'events' || pageRoute.kind === 'watch';
  const football = pageRoute.kind === 'football' || pageRoute.kind === 'football-match';
  const competition = football ? competitionKind(pageRoute.competitionId) : undefined;
  const leagueTheme = football
    ? (LEAGUES.find((league) => league.id === pageRoute.competitionId)?.theme ?? 'neutral')
    : 'neutral';
  const appSport = service ? 'neutral' : pageRoute.kind === 'f1' ? 'f1' : 'football';
  // The competition accent belongs to «Футбол»; «Сегодня», «Моё» and service pages stay neutral.
  const appTheme = service
    ? 'neutral'
    : pageRoute.kind === 'f1'
      ? 'f1'
      : football
        ? competition === 'ucl' || competition === 'cup'
          ? 'ucl'
          : leagueTheme
        : 'neutral';
  const contentSport = pageRoute.kind === 'f1' ? 'f1' : 'football';

  useHiddenCompetitionRedirect(route, navigate);

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
          route={pageRoute}
          eventsOpen={drawerOpen}
          unreadCount={unread}
          eventsButtonRef={bellRef}
          onChangeSection={(section) => {
            setEventsOpen(false);
            changeSection(section);
          }}
          onOpenEvents={() => {
            if (drawerOpen) closeEvents();
            else setEventsOpen(true);
          }}
          onOpenSettings={() => {
            setEventsOpen(false);
            navigate({ kind: 'settings' });
          }}
        />
        <div className="shell-main">
          <PageHeader
            route={pageRoute}
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
                route={pageRoute}
                sport={contentSport}
                leagueId={leagueId}
                cupId={cupId}
                onNavigate={navigate}
                onLeagueChange={setLeagueId}
                onOpenMatch={openFootballMatch}
                onOpenWeekend={openWeekend}
              />
            </div>
          </main>
          <EventsDrawer
            open={drawerOpen}
            onClose={closeEvents}
            onOpenEvent={openEvent}
            returnFocusRef={bellRef}
          />
        </div>
      </div>
    </div>
  );
}
