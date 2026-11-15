import { Suspense, lazy, useEffect } from 'react';
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
  isValidFootballTab,
  type MyTab,
  type ShellRoute,
  type Sport,
} from '../lib/navigation';
import type { FootballSection } from '../features/football/FootballView';
import type { TabId as F1Tab } from '../features/f1/F1View';
import type { UclTab } from '../features/ucl/ChampionsView';
import type { CupTab } from '../features/ucl/CupsView';
import { rememberAnalysisMode } from './shellModel';
import type { Navigate } from './frame';
import { viewState } from '../lib/viewState';
import { resolveMyTab } from '../features/my/myTabs';

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
const TodayView = lazy(() =>
  import('../features/today/TodayView').then((m) => ({ default: m.TodayView })),
);
const EventCenter = lazy(() =>
  import('../features/events/EventCenter').then((m) => ({ default: m.EventCenter })),
);
const MyView = lazy(() => import('../features/my/MyView').then((m) => ({ default: m.MyView })));

interface RouteContentProps {
  route: ShellRoute;
  sport: Sport;
  leagueId: string;
  cupId: string;
  onNavigate: Navigate;
  onLeagueChange: (id: string) => void;
  onOpenMatch: (matchId: string, eventLeague?: string) => void;
  onOpenWeekend: (season: string | number, round: string | number) => void;
}

/** One route-to-screen mapping of the five-section frame. */
export function RouteContent({
  route,
  sport,
  leagueId,
  cupId,
  onNavigate,
  onLeagueChange,
  onOpenMatch,
  onOpenWeekend,
}: RouteContentProps) {
  const competitionId =
    route.kind === 'football' || route.kind === 'football-match' ? route.competitionId : leagueId;
  const competition = competitionKind(competitionId);
  const f1Tab = route.kind === 'f1' && isF1Tab(route.tab) ? route.tab : 'overview';
  const uclTab: UclTab =
    route.kind === 'football' && competition === 'ucl' && isChampionsTab(route.tab)
      ? route.tab
      : 'matches';
  const cupTab: CupTab =
    route.kind === 'football' &&
    competition === 'cup' &&
    isCupTab(route.tab) &&
    isValidFootballTab(route.competitionId, route.tab)
      ? route.tab
      : 'matches';
  const leagueTab: FootballSection =
    route.kind === 'football' && competition === 'league' && isLeagueTab(route.tab)
      ? route.tab
      : 'matches';
  const myTab: MyTab = route.kind === 'my' ? (route.tab ?? 'favorites') : 'favorites';
  const shownMyTab = resolveMyTab(myTab);
  const auxiliary =
    route.kind === 'watch' ||
    route.kind === 'settings' ||
    route.kind === 'events' ||
    route.kind === 'my';

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
          route.kind === 'today'
            ? ['pitch', 'jolpica']
            : route.kind === 'settings' ||
                route.kind === 'watch' ||
                route.kind === 'events' ||
                route.kind === 'my'
              ? []
              : sport === 'f1'
                ? ['jolpica', 'openf1']
                : ['pitch', 'sportscore', 'espn']
        }
      />
      <UpdateNotice />
      <Suspense fallback={<LoadingBlock label="Открываем раздел…" rows={3} />}>
        {!auxiliary && route.kind === 'today' && (
          <SectionBoundary name="Сегодня" resetKey={`today.${route.mode ?? 'today'}`}>
            <TodayView
              mode={route.mode ?? 'today'}
              onModeChange={(mode) => onNavigate({ kind: 'today', mode })}
              onOpenMatch={onOpenMatch}
              onOpenWeekend={(race) => onOpenWeekend(race.season, race.round)}
              onOpenTeam={(id, _name, teamLeagueId) => {
                const teamLeague = isLeagueId(teamLeagueId) ? teamLeagueId : leagueId;
                onNavigate(
                  { kind: 'football', competitionId: teamLeague, tab: 'team', teamId: id },
                  { leagueId: teamLeague },
                );
              }}
              onOpenF1={() => onNavigate({ kind: 'f1', tab: 'overview' })}
            />
          </SectionBoundary>
        )}
        {!auxiliary &&
          ((route.kind === 'football' && competition === 'league') ||
            route.kind === 'football-match') && (
            <SectionBoundary
              name="Футбол"
              resetKey={`football.${competitionId}.${JSON.stringify(route)}`}
            >
              <FootballView
                leagueId={competitionId}
                onLeagueChange={onLeagueChange}
                section={route.kind === 'football-match' ? 'matches' : leagueTab}
                selectedTeamId={
                  route.kind === 'football' && route.tab === 'team' ? route.teamId : undefined
                }
                initialMatchesFilter={route.kind === 'football' ? route.matchesFilter : undefined}
                matchId={route.kind === 'football-match' ? route.matchId : null}
                onOpenMatch={onOpenMatch}
                onOpenTeam={(id, _name, teamLeagueId) => {
                  const teamLeague = isLeagueId(teamLeagueId) ? teamLeagueId : competitionId;
                  onNavigate(
                    { kind: 'football', competitionId: teamLeague, tab: 'team', teamId: id },
                    { leagueId: teamLeague },
                  );
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
                ? shownMyTab === 'games'
                  ? 'games'
                  : shownMyTab === 'diary'
                    ? 'diary'
                    : `my.${shownMyTab}`
                : route.kind
            }
          >
            {route.kind === 'watch' ? (
              <WatchView intent={route.intent} requestedChannelId={route.channelId} />
            ) : route.kind === 'my' ? (
              <MyView
                tab={myTab}
                onTabChange={(tab) => onNavigate({ kind: 'my', tab })}
                onOpenMatch={onOpenMatch}
                onOpenWeekend={onOpenWeekend}
                onOpenClub={(teamId, teamLeagueId) => {
                  const teamLeague = isLeagueId(teamLeagueId) ? teamLeagueId : leagueId;
                  onNavigate(
                    { kind: 'football', competitionId: teamLeague, tab: 'team', teamId },
                    { leagueId: teamLeague },
                  );
                }}
                onOpenPlayer={(player) => {
                  viewState.write('players.requested', player);
                  viewState.write('players.selected', player.id);
                  onNavigate({ kind: 'football', competitionId: leagueId, tab: 'players' });
                }}
                onOpenF1={() => onNavigate({ kind: 'f1', tab: 'overview' })}
                onOpenSettings={(category) => onNavigate({ kind: 'settings', category })}
              />
            ) : route.kind === 'events' ? (
              <EventCenter
                onOpen={(event) => {
                  if (event.sport === 'f1' && event.season && event.round)
                    onOpenWeekend(event.season, event.round);
                  else if (event.matchId) onOpenMatch(event.matchId, event.leagueId);
                }}
              />
            ) : (
              <SettingsView
                category={route.kind === 'settings' ? route.category : undefined}
                onCategoryChange={(category) => onNavigate({ kind: 'settings', category })}
              />
            )}
          </PageFrame>
        )}
      </Suspense>
      <footer className="app-footer">
        <span>
          SPORTSDESK <span className="app-footer-dot" aria-hidden="true" />
        </span>
        <span>Время событий · {getUserTimezone()}</span>
      </footer>
    </>
  );
}
