import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import ConnectivityBanner from '../components/ConnectivityBanner';
import { PageFrame } from '../components/PageFrame';
import { SectionBoundary } from '../components/SectionBoundary';
import { LoadingBlock } from '../components/StateViews';
import { UpdateNotice } from '../features/settings/Updates';
import { getUserTimezone } from '../features/football/storage';
import {
  CHAMPIONS_LEAGUE_ID,
  competitionKind,
  isChampionsTab,
  isCupTab,
  isF1Tab,
  isLeagueId,
  isLeagueTab,
  type ShellRoute,
  type Sport,
} from '../lib/navigation';
import type { FootballSection } from '../features/football/FootballView';
import type { TabId as F1Tab } from '../features/f1/F1View';
import type { UclTab } from '../features/ucl/ChampionsView';
import type { CupTab } from '../features/ucl/CupsView';
import { rememberAnalysisMode } from './shellModel';
import type { Navigate } from './frame';

const OfflineView = lazy(() =>
  import('../features/offline/OfflineView').then((m) => ({ default: m.OfflineView })),
);
const FootballView = lazy(() =>
  import('../features/football/FootballView').then((m) => ({ default: m.FootballView })),
);
const F1View = lazy(() => import('../features/f1/F1View').then((m) => ({ default: m.F1View })));
const SettingsView = lazy(() =>
  import('../features/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
);
const ChampionsView = lazy(() =>
  import('../features/ucl/ChampionsView').then((m) => ({ default: m.ChampionsView })),
);
const CupsView = lazy(() =>
  import('../features/ucl/CupsView').then((m) => ({ default: m.CupsView })),
);
const WatchView = lazy(() =>
  import('../features/watch/WatchView').then((m) => ({ default: m.WatchView })),
);
const ViewingPlanner = lazy(() =>
  import('../features/planner/ViewingPlanner').then((m) => ({ default: m.ViewingPlanner })),
);
const EventCenter = lazy(() =>
  import('../features/events/EventCenter').then((m) => ({ default: m.EventCenter })),
);
const GamesView = lazy(() =>
  import('../features/games/GamesView').then((m) => ({ default: m.GamesView })),
);
const DiaryView = lazy(() =>
  import('../features/diary/DiaryView').then((m) => ({ default: m.DiaryView })),
);

interface RouteContentProps {
  route: ShellRoute;
  sport: Sport;
  leagueId: string;
  cupId: string;
  onNavigate: Navigate;
  onLeagueChange: (id: string) => void;
  onOpenMatch: (matchId: string, eventLeague?: string) => void;
  onOpenWeekend: (season: string | number, round: string | number) => void;
  onBack: () => void;
  /** The legacy frame shows its breadcrumb between the update banner and the screen. */
  contentHeader?: ReactNode;
  /** The legacy frame keeps its «Вернуться к спорту» button on service pages. */
  auxiliaryBack?: ReactNode;
}

/** One route-to-screen mapping shared by the current frame and the new shell. */
export function RouteContent({
  route,
  sport,
  leagueId,
  cupId,
  onNavigate,
  onLeagueChange,
  onOpenMatch,
  onOpenWeekend,
  onBack,
  contentHeader,
  auxiliaryBack,
}: RouteContentProps) {
  const competitionId =
    route.kind === 'football' || route.kind === 'football-match' ? route.competitionId : leagueId;
  const competition = competitionKind(competitionId);
  const f1Tab = route.kind === 'f1' && isF1Tab(route.tab) ? route.tab : 'overview';
  const uclTab: UclTab =
    route.kind === 'football' && competition === 'ucl' && isChampionsTab(route.tab)
      ? route.tab
      : 'overview';
  const cupTab: CupTab =
    route.kind === 'football' && competition === 'cup' && isCupTab(route.tab)
      ? route.tab
      : 'overview';
  const leagueTab: FootballSection =
    route.kind === 'football' && competition === 'league' && isLeagueTab(route.tab)
      ? route.tab
      : 'matches';
  const auxiliary =
    route.kind === 'watch' ||
    route.kind === 'settings' ||
    route.kind === 'events' ||
    route.kind === 'my' ||
    route.kind === 'offline' ||
    (route.kind === 'today' && route.mode === 'plan');

  const setF1Tab = (tab: F1Tab) => {
    rememberAnalysisMode(tab);
    onNavigate({ kind: 'f1', tab });
  };
  useEffect(() => {
    if (route.kind === 'f1') rememberAnalysisMode(route.tab);
  }, [route]);
  const setUclTab = (tab: UclTab) =>
    onNavigate({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab });
  const setCupTab = (tab: CupTab) => onNavigate({ kind: 'football', competitionId: cupId, tab });

  return (
    <>
      <ConnectivityBanner
        sources={
          route.kind === 'today' && route.mode === 'plan'
            ? ['pitch', 'jolpica']
            : route.kind === 'settings' ||
                route.kind === 'watch' ||
                route.kind === 'events' ||
                route.kind === 'my' ||
                route.kind === 'offline'
              ? []
              : sport === 'f1'
                ? ['jolpica', 'openf1']
                : ['pitch', 'sportscore', 'espn']
        }
      />
      <UpdateNotice />
      {contentHeader}
      <Suspense fallback={<LoadingBlock label="Открываем раздел…" rows={3} />}>
        {!auxiliary &&
          (route.kind === 'today' ||
            (route.kind === 'football' && competition === 'league') ||
            route.kind === 'football-match') && (
            <SectionBoundary
              name="Футбол"
              resetKey={`football.${competitionId}.${JSON.stringify(route)}`}
            >
              <FootballView
                leagueId={competitionId}
                onLeagueChange={onLeagueChange}
                section={
                  route.kind === 'today'
                    ? 'dashboard'
                    : route.kind === 'football-match'
                      ? 'matches'
                      : leagueTab
                }
                selectedTeamId={
                  route.kind === 'football' && route.tab === 'team' ? route.teamId : undefined
                }
                matchId={route.kind === 'football-match' ? route.matchId : null}
                onOpenMatch={onOpenMatch}
                onBackFromMatch={onBack}
                onOpenTeam={(id, _name, teamLeagueId) => {
                  const teamLeague = isLeagueId(teamLeagueId) ? teamLeagueId : competitionId;
                  onNavigate(
                    { kind: 'football', competitionId: teamLeague, tab: 'team', teamId: id },
                    { leagueId: teamLeague },
                  );
                }}
                onNavigate={(section) => {
                  if (section === 'dashboard') onNavigate({ kind: 'today', mode: 'today' });
                  else
                    onNavigate({
                      kind: 'football',
                      competitionId: competition === 'league' ? competitionId : leagueId,
                      tab: section,
                    });
                }}
              />
            </SectionBoundary>
          )}
        {!auxiliary && route.kind === 'football' && competition === 'ucl' && (
          <SectionBoundary name="Раздел" resetKey={`ucl.${uclTab}.${cupId}`}>
            <ChampionsView tab={uclTab} onTabChange={setUclTab} />
          </SectionBoundary>
        )}
        {!auxiliary && route.kind === 'football' && competition === 'cup' && (
          <SectionBoundary name="Раздел" resetKey={`cup.${cupTab}.${cupId}`}>
            <CupsView competitionId={route.competitionId} tab={cupTab} onTabChange={setCupTab} />
          </SectionBoundary>
        )}
        {!auxiliary && route.kind === 'f1' && (
          <SectionBoundary name="Раздел" resetKey={`f1.${f1Tab}.${cupId}`}>
            <F1View tab={f1Tab} onTabChange={setF1Tab} />
          </SectionBoundary>
        )}
        {auxiliary && (
          <PageFrame
            page={
              route.kind === 'my'
                ? route.tab === 'games'
                  ? 'games'
                  : route.tab === 'diary'
                    ? 'diary'
                    : `my.${route.tab ?? 'favorites'}`
                : route.kind === 'today'
                  ? 'planner'
                  : route.kind
            }
          >
            {auxiliaryBack}
            {route.kind === 'watch' ? (
              <WatchView intent={route.intent} requestedChannelId={route.channelId} />
            ) : route.kind === 'offline' ? (
              <OfflineView />
            ) : route.kind === 'my' && route.tab === 'diary' ? (
              <DiaryView
                onOpen={(reference) =>
                  reference.kind === 'football'
                    ? onOpenMatch(reference.matchId, reference.leagueId ?? undefined)
                    : onOpenWeekend(reference.season, reference.round)
                }
              />
            ) : route.kind === 'my' && route.tab === 'games' ? (
              <GamesView onOpenMatch={onOpenMatch} />
            ) : route.kind === 'my' ? null : route.kind === 'events' ? (
              <EventCenter
                onOpen={(event) => {
                  if (event.sport === 'f1' && event.season && event.round)
                    onOpenWeekend(event.season, event.round);
                  else if (event.matchId) onOpenMatch(event.matchId, event.leagueId);
                }}
              />
            ) : route.kind === 'today' ? (
              <ViewingPlanner
                onOpenMatch={onOpenMatch}
                onOpenWeekend={(race) => onOpenWeekend(race.season, race.round)}
              />
            ) : (
              <SettingsView />
            )}
          </PageFrame>
        )}
      </Suspense>
      <footer className="app-footer">
        <span>
          SPORTSDESK <b>●</b>
        </span>
        <span>Время событий · {getUserTimezone()}</span>
      </footer>
    </>
  );
}
