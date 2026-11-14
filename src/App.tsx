import { useCallback, useEffect, useState } from 'react';
import WhatsNewDialog from './components/WhatsNewDialog';
import { SectionBoundary } from './components/SectionBoundary';
import { FirstRunWizard } from './features/onboarding/FirstRunWizard';
import { MiniWindow } from './features/football/MiniWindow';
import { SportsNotifications } from './features/football/SportsNotifications';
import { FinishCelebration } from './features/atmosphere/FinishCelebration';
import { GoalCelebration } from './features/atmosphere/GoalCelebration';
import { TeamRadioSignal } from './features/atmosphere/TeamRadioSignal';
import { getString, setString } from './features/football/storage';
import { UpdateProvider } from './features/settings/Updates';
import {
  competitionKind,
  defaultFootballTab,
  isCompetitionId,
  isLeagueId,
  isLeagueTab,
  isMyTab,
  isValidSettingsCategory,
} from './lib/navigation';
import { isCompetitionVisible } from './lib/modules';
import { isTauriRuntime, rpc } from './lib/bridge';
import { useShellNavigation } from './lib/useShellNavigation';
import { viewState } from './lib/viewState';
import { useInterfaceDesign } from './lib/interfaceDesign';
import type { SearchTarget } from './lib/searchIndex';
import { WatchActionContext } from './lib/watchIntent';
import { startOfflineRunner } from './features/offline/offlineQueue';
import { AppShell } from './app/AppShell';
import { LegacyShell } from './app/LegacyShell';
import { useShellPreview } from './app/shellFlag';
import { lastAnalysisMode } from './app/shellModel';
import type { FrameProps } from './app/frame';

export type { ShellRoute, Sport } from './lib/navigation';
export type { FootballSection } from './features/football/FootballView';

/** Route wrapper: #mini renders the compact live window instead of the main UI. */
export default function App() {
  const isMini = typeof window !== 'undefined' && window.location.hash === '#mini';
  if (isMini) return <MiniWindow />;
  return (
    <SectionBoundary resetKey="application" name="SportsDesk">
      <UpdateProvider>
        <MainApp />
      </UpdateProvider>
    </SectionBoundary>
  );
}

function MainApp() {
  useEffect(startOfflineRunner, []);
  const preview = useShellPreview();
  const design = useInterfaceDesign();
  const navigation = useShellNavigation({ startOnToday: preview });
  const { sport, cupId, route, leagueId, navigate, back, canBack } = navigation;
  const [scheme, setScheme] = useState<'dark' | 'light'>(() =>
    getString('sportsdesk.scheme') === 'light' ? 'light' : 'dark',
  );
  const [density, setDensity] = useState<'default' | 'compact'>(() =>
    getString('sportsdesk.density') === 'compact' ? 'compact' : 'default',
  );
  useEffect(() => setString('sportsdesk.scheme', scheme), [scheme]);
  useEffect(() => {
    document.documentElement.dataset.design = design;
    document.documentElement.dataset.scheme = scheme;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.style.backgroundColor =
      scheme === 'light' ? '#f3f6fb' : design === 'broadcast' ? '#181818' : '#0b101c';
    if (isTauriRuntime()) void rpc('apply_window_appearance', { scheme }).catch(() => {});
  }, [scheme, design]);
  useEffect(() => setString('sportsdesk.density', density), [density]);
  // Appearance (theme/density) changes from the settings without a reload.
  useEffect(() => {
    const onAppearance = () => {
      setScheme(getString('sportsdesk.scheme') === 'light' ? 'light' : 'dark');
      setDensity(getString('sportsdesk.density') === 'compact' ? 'compact' : 'default');
    };
    window.addEventListener('sportsdesk-appearance-changed', onAppearance);
    return () => window.removeEventListener('sportsdesk-appearance-changed', onAppearance);
  }, []);
  const setLeagueId = (id: string) => {
    const next = isLeagueId(id) ? id : leagueId;
    if (route.kind === 'football' || route.kind === 'football-match')
      navigate({ ...route, competitionId: next }, { leagueId: next });
    else navigate(route, { leagueId: next });
  };
  const openFootballMatch = useCallback(
    (matchId: string, eventLeague?: string) => {
      const eventKind = competitionKind(eventLeague);
      const contextId = eventKind ? eventLeague! : leagueId;
      // An external link to a hidden competition lands on «Сегодня», not on
      // another league the user did not ask for.
      if (preview && !isCompetitionVisible(contextId)) {
        navigate({ kind: 'today', mode: 'today' });
        return;
      }
      navigate(
        { kind: 'football-match', matchId, competitionId: contextId },
        eventKind === 'league'
          ? { leagueId: contextId }
          : eventKind === 'cup'
            ? { cupId: contextId }
            : {},
      );
    },
    [leagueId, navigate, preview],
  );
  const openWeekend = useCallback(
    (season: string | number, round: string | number) => {
      viewState.write('f1.year', Number(season));
      viewState.write(`f1.${season}.calendar.filter`, 'all');
      viewState.write(`f1.${season}.calendar.round`, Number(round));
      navigate({ kind: 'f1', tab: 'calendar' });
    },
    [navigate],
  );
  const searchTarget = (target: SearchTarget) => {
    switch (target.kind) {
      case 'team': {
        const teamLeague = isLeagueId(target.leagueId) ? target.leagueId : leagueId;
        navigate(
          { kind: 'football', competitionId: teamLeague, tab: 'team', teamId: target.id },
          { leagueId: teamLeague },
        );
        break;
      }
      case 'match':
        openFootballMatch(target.id, target.leagueId);
        break;
      case 'player':
        viewState.write('players.requested', target.player);
        viewState.write('players.selected', target.player.id);
        navigate({ kind: 'football', competitionId: leagueId, tab: 'players' });
        break;
      case 'driver':
        viewState.write('f1.year', target.year);
        viewState.write(`f1.${target.year}.compare.a`, target.id);
        navigate({ kind: 'f1', tab: 'compare' });
        break;
      case 'channel':
        navigate({ kind: 'watch', channelId: target.id });
        break;
      case 'competition':
        if (isCompetitionId(target.id) && isCompetitionVisible(target.id))
          navigate({
            kind: 'football',
            competitionId: target.id,
            tab: defaultFootballTab(target.id),
          });
        else navigate({ kind: 'today', mode: 'today' });
        break;
      case 'settings':
        if (isValidSettingsCategory(target.category))
          navigate({ kind: 'settings', category: target.category });
        break;
      case 'section':
        if (target.id.startsWith('football.')) {
          const tab = target.id.slice('football.'.length);
          if (isLeagueTab(tab)) navigate({ kind: 'football', competitionId: leagueId, tab });
        } else if (target.id === 'football')
          navigate({
            kind: 'football',
            competitionId: leagueId,
            tab: defaultFootballTab(leagueId),
          });
        else if (target.id === 'f1') navigate({ kind: 'f1', tab: 'overview' });
        else if (target.id === 'f1.calendar') navigate({ kind: 'f1', tab: 'calendar' });
        else if (target.id === 'f1.standings') navigate({ kind: 'f1', tab: 'standings' });
        else if (target.id === 'f1.analysis') navigate({ kind: 'f1', tab: lastAnalysisMode() });
        else if (target.id === 'today' || target.id === 'today.week')
          navigate({ kind: 'today', mode: target.id === 'today' ? 'today' : 'week' });
        else if (target.id === 'today.plan') navigate({ kind: 'today', mode: 'plan' });
        else if (target.id === 'watch') navigate({ kind: 'watch' });
        else if (target.id === 'my') navigate({ kind: 'my', tab: 'favorites' });
        else if (target.id.startsWith('my.')) {
          const tab = target.id.slice('my.'.length);
          if (isMyTab(tab)) navigate({ kind: 'my', tab });
        } else if (target.id === 'events') navigate({ kind: 'events' });
        else if (target.id === 'offline') navigate({ kind: 'offline' });
        else if (target.id === 'settings') navigate({ kind: 'settings' });
    }
  };
  useEffect(() => {
    let active = true,
      stop: (() => void) | undefined;
    void (async () => {
      if (!isTauriRuntime()) return;
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<{
        kind: string;
        matchId?: string;
        season?: string | number;
        round?: string | number;
      }>('sportsdesk://open-event', ({ payload: e }) => {
        if (e.kind === 'match' && e.matchId) openFootballMatch(e.matchId);
        if (e.kind === 'f1' && e.season !== undefined && e.round !== undefined)
          openWeekend(e.season, e.round);
        // Notification and legacy links without a place open the event list.
        if (e.kind === 'events') navigate({ kind: 'events' });
      });
      if (active) stop = off;
      else off();
    })().catch(() => {});
    return () => {
      active = false;
      stop?.();
    };
  }, [navigate, openFootballMatch, openWeekend]);
  const openMini = async () => {
    try {
      await rpc('open_mini_window');
    } catch {
      /* non-Tauri: ignore */
    }
  };
  const togglePage = navigation.auxiliary;
  const frame: FrameProps = {
    route,
    sport,
    leagueId,
    cupId,
    design,
    scheme,
    density,
    canBack,
    onBack: back,
    navigate,
    changeSection: navigation.changeSection,
    changeSport: navigation.changeSport,
    auxiliary: navigation.auxiliary,
    setLeagueId,
    searchTarget,
    openFootballMatch,
    openWeekend,
    openMini,
  };
  const overlays = (
    <>
      <SportsNotifications />
      <GoalCelebration />
      <FinishCelebration />
      <TeamRadioSignal />
      <WhatsNewDialog />
      <FirstRunWizard
        onLeagueChange={setLeagueId}
        onOpenSettings={() => togglePage('settings')}
        onOpenWatch={() => togglePage('watch')}
      />
    </>
  );
  return (
    <WatchActionContext.Provider value={(intent) => navigate({ kind: 'watch', intent })}>
      {preview ? (
        <AppShell {...frame}>{overlays}</AppShell>
      ) : (
        <LegacyShell {...frame}>{overlays}</LegacyShell>
      )}
    </WatchActionContext.Provider>
  );
}
