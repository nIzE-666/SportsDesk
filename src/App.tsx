import {
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  Gamepad2,
  HardDriveDownload,
  Heart,
  Settings,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import ConnectivityBanner from './components/ConnectivityBanner';
import WhatsNewDialog from './components/WhatsNewDialog';
import { FirstRunWizard } from './features/onboarding/FirstRunWizard';
import type { TabId as F1Tab } from './features/f1/F1View';
import { MiniWindow } from './features/football/MiniWindow';
import { SportsNotifications } from './features/football/SportsNotifications';
import { useAtmosphere } from './features/atmosphere/atmosphereStore';
import { FinishCelebration } from './features/atmosphere/FinishCelebration';
import { GoalCelebration } from './features/atmosphere/GoalCelebration';
import { TeamRadioSignal } from './features/atmosphere/TeamRadioSignal';
import {
  getJson,
  getString,
  getUserTimezone,
  setString,
  STORAGE_KEYS,
} from './features/football/storage';
import { UpdateNotice, UpdateProvider } from './features/settings/Updates';
import type { UclTab } from './features/ucl/ChampionsView';
import type { CupTab } from './features/ucl/CupsView';
import { CUP_COMPETITIONS } from './features/ucl/cups';

import { AppTopbar } from './components/AppTopbar';
import { TodaySidebar } from './components/TodaySidebar';
import { PageFrame } from './components/PageFrame';
import { SectionBoundary } from './components/SectionBoundary';
import {
  CHAMPIONS_LEAGUE_ID,
  competitionKind,
  homeRoute,
  isChampionsTab,
  isCupTab,
  isF1Tab,
  isLeagueId,
  isLeagueTab,
  isMyTab,
} from './lib/navigation';
import { isTauriRuntime, rpc } from './lib/bridge';
import { useShellNavigation } from './lib/useShellNavigation';
import { LEAGUES, footballNav, f1Nav, uclNav, cupNav } from './lib/navigationMetadata';
import { viewState } from './lib/viewState';
import { useInterfaceDesign } from './lib/interfaceDesign';
import type { SearchTarget } from './lib/searchIndex';
import { WatchActionContext } from './lib/watchIntent';
import { LoadingBlock } from './components/StateViews';
import { startOfflineRunner } from './features/offline/offlineQueue';
import type { FootballSection } from './features/football/FootballView';
const OfflineView = lazy(() =>
  import('./features/offline/OfflineView').then((m) => ({ default: m.OfflineView })),
);
const FootballView = lazy(() =>
  import('./features/football/FootballView').then((m) => ({ default: m.FootballView })),
);
const F1View = lazy(() => import('./features/f1/F1View').then((m) => ({ default: m.F1View })));
const SettingsView = lazy(() =>
  import('./features/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
);
const ChampionsView = lazy(() =>
  import('./features/ucl/ChampionsView').then((m) => ({ default: m.ChampionsView })),
);
const CupsView = lazy(() =>
  import('./features/ucl/CupsView').then((m) => ({ default: m.CupsView })),
);
const WatchView = lazy(() =>
  import('./features/watch/WatchView').then((m) => ({ default: m.WatchView })),
);
const ViewingPlanner = lazy(() =>
  import('./features/planner/ViewingPlanner').then((m) => ({ default: m.ViewingPlanner })),
);
const EventCenter = lazy(() =>
  import('./features/events/EventCenter').then((m) => ({ default: m.EventCenter })),
);
const GamesView = lazy(() =>
  import('./features/games/GamesView').then((m) => ({ default: m.GamesView })),
);
const DiaryView = lazy(() =>
  import('./features/diary/DiaryView').then((m) => ({ default: m.DiaryView })),
);
export type { ShellRoute, Sport } from './lib/navigation';
export type { FootballSection } from './features/football/FootballView';
/** Отслеживаемые команды для сайдбара: ids из localStorage + каталог имён. */
function resolveSidebarFavorites(): Array<{ id: string; name: string }> {
  const stored = getJson<{ ids?: unknown }>(STORAGE_KEYS.favoritesTeams, {});
  const ids = Array.isArray(stored?.ids)
    ? (stored.ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  if (!ids.length) return [];
  const catalogue = getJson<Array<{ id?: unknown; name?: unknown }>>(STORAGE_KEYS.catalogue, []);
  const nameById = new Map<string, string>();
  if (Array.isArray(catalogue))
    for (const e of catalogue) {
      if (e && typeof e.id === 'string' && typeof e.name === 'string') nameById.set(e.id, e.name);
    }
  return ids.map((id) => ({ id, name: nameById.get(id) ?? 'Команда' }));
}
/** Route-обёртка: #mini рендерит компактное live-окно вместо основного UI. */
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
  const design = useInterfaceDesign();
  const atmosphere = useAtmosphere();
  const navigation = useShellNavigation();
  const { sport, cupId, route, leagueId, navigate: setRoute, back, canBack } = navigation;
  const competitionId =
    route.kind === 'football' || route.kind === 'football-match' ? route.competitionId : leagueId;
  const competition = competitionKind(competitionId);
  const f1Tab = route.kind === 'f1' && isF1Tab(route.tab) ? route.tab : 'overview';
  const uclTab =
    route.kind === 'football' && competition === 'ucl' && isChampionsTab(route.tab)
      ? route.tab
      : 'overview';
  const cupTab =
    route.kind === 'football' && competition === 'cup' && isCupTab(route.tab)
      ? route.tab
      : 'overview';
  const leagueTab: FootballSection =
    route.kind === 'football' && competition === 'league' && isLeagueTab(route.tab)
      ? route.tab
      : 'matches';
  const setF1Tab = (tab: F1Tab) => setRoute({ kind: 'f1', tab });
  const setUclTab = (tab: UclTab) =>
    setRoute({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab });
  const setCupTab = (tab: CupTab) => setRoute({ kind: 'football', competitionId: cupId, tab });
  const setLeagueId = (id: string) => {
    const next = isLeagueId(id) ? id : leagueId;
    if (route.kind === 'football' || route.kind === 'football-match')
      setRoute({ ...route, competitionId: next }, { leagueId: next });
    else setRoute(route, { leagueId: next });
  };
  const [collapsed, setCollapsed] = useState(
    () => getString('sportsdesk.sidebar.collapsed') === '1',
  );
  const [competitionsOpen, setCompetitionsOpen] = useState(
    () => getString('sportsdesk.sidebar.competitionsOpen') !== '0',
  );
  const [teamsOpen, setTeamsOpen] = useState(
    () => getString('sportsdesk.sidebar.teamsOpen') !== '0',
  );
  const [scheme, setScheme] = useState<'dark' | 'light'>(() =>
    getString('sportsdesk.scheme') === 'light' ? 'light' : 'dark',
  );
  const [density, setDensity] = useState<'default' | 'compact'>(() =>
    getString('sportsdesk.density') === 'compact' ? 'compact' : 'default',
  );
  const [favTeams, setFavTeams] = useState<Array<{ id: string; name: string }>>(() =>
    resolveSidebarFavorites(),
  );
  useEffect(() => setString('sportsdesk.sidebar.collapsed', collapsed ? '1' : '0'), [collapsed]);
  useEffect(
    () => setString('sportsdesk.sidebar.competitionsOpen', competitionsOpen ? '1' : '0'),
    [competitionsOpen],
  );
  useEffect(() => setString('sportsdesk.sidebar.teamsOpen', teamsOpen ? '1' : '0'), [teamsOpen]);
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
  // Сайдбар показывает актуальный список отслеживаемых команд.
  useEffect(() => {
    const onFav = () => setFavTeams(resolveSidebarFavorites());
    window.addEventListener('sportsdesk-favorites-changed', onFav);
    return () => window.removeEventListener('sportsdesk-favorites-changed', onFav);
  }, []);
  // Внешний вид (тема/плотность) меняется из настроек без перезагрузки.
  useEffect(() => {
    const onAppearance = () => {
      setScheme(getString('sportsdesk.scheme') === 'light' ? 'light' : 'dark');
      setDensity(getString('sportsdesk.density') === 'compact' ? 'compact' : 'default');
    };
    window.addEventListener('sportsdesk-appearance-changed', onAppearance);
    return () => window.removeEventListener('sportsdesk-appearance-changed', onAppearance);
  }, []);
  const matchCompetition =
    route.kind === 'football' || route.kind === 'football-match' ? competition : undefined;
  const theme =
    matchCompetition === 'ucl' || matchCompetition === 'cup'
      ? 'ucl'
      : sport === 'football'
        ? (LEAGUES.find((l) => l.id === leagueId)?.theme ?? 'epl')
        : sport === 'cup'
          ? 'ucl'
          : sport;
  const auxiliary =
    route.kind === 'watch' ||
    route.kind === 'settings' ||
    route.kind === 'events' ||
    route.kind === 'my' ||
    route.kind === 'offline' ||
    (route.kind === 'today' && route.mode === 'plan');
  const reset = () => setRoute(homeRoute(sport, cupId));
  const changeMode = navigation.changeSport;
  const openFootballMatch = (matchId: string, eventLeague?: string) => {
    const eventKind = competitionKind(eventLeague);
    const contextId = eventKind ? eventLeague! : leagueId;
    setRoute(
      { kind: 'football-match', matchId, competitionId: contextId },
      eventKind === 'league'
        ? { leagueId: contextId }
        : eventKind === 'cup'
          ? { cupId: contextId }
          : {},
    );
  };
  const backFromMatch = back,
    backFromAuxiliary = back;
  const togglePage = navigation.auxiliary;
  const openPlanner = () => navigation.auxiliary('planner');
  const openWeekend = (season: string | number, round: string | number) => {
    viewState.write('f1.year', Number(season));
    viewState.write(`f1.${season}.calendar.filter`, 'all');
    viewState.write(`f1.${season}.calendar.round`, Number(round));
    setRoute({ kind: 'f1', tab: 'calendar' });
  };
  const searchTarget = (target: SearchTarget) => {
    switch (target.kind) {
      case 'team': {
        const teamLeague = isLeagueId(target.leagueId) ? target.leagueId : leagueId;
        setRoute(
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
        setRoute({ kind: 'football', competitionId: leagueId, tab: 'players' });
        break;
      case 'driver':
        viewState.write('f1.year', target.year);
        viewState.write(`f1.${target.year}.compare.a`, target.id);
        setRoute({ kind: 'f1', tab: 'compare' });
        break;
      case 'channel':
        setRoute({ kind: 'watch', channelId: target.id });
        break;
      case 'section':
        if (target.id.startsWith('football.')) {
          const tab = target.id.slice('football.'.length);
          if (isLeagueTab(tab)) setRoute({ kind: 'football', competitionId: leagueId, tab });
        } else if (target.id === 'f1') setRoute({ kind: 'f1', tab: 'overview' });
        else if (target.id === 'today' || target.id === 'today.week')
          setRoute({ kind: 'today', mode: target.id === 'today' ? 'today' : 'week' });
        else if (target.id === 'today.plan') setRoute({ kind: 'today', mode: 'plan' });
        else if (target.id === 'watch') setRoute({ kind: 'watch' });
        else if (target.id.startsWith('my.')) {
          const tab = target.id.slice('my.'.length);
          if (isMyTab(tab)) setRoute({ kind: 'my', tab });
        } else if (target.id === 'events') setRoute({ kind: 'events' });
        else if (target.id === 'offline') setRoute({ kind: 'offline' });
        else if (target.id === 'settings') setRoute({ kind: 'settings' });
    }
  };
  useEffect(() => {
    let active = true,
      stop: (() => void) | undefined;
    void (async () => {
      if (!isTauriRuntime()) return;
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<{ kind: string; matchId?: string; season?: string; round?: string }>(
        'sportsdesk://open-event',
        ({ payload: e }) => {
          if (e.kind === 'match' && e.matchId)
            setRoute({ kind: 'football-match', matchId: e.matchId, competitionId: leagueId });
          if (e.kind === 'f1' && e.season && e.round) openWeekend(e.season, e.round);
        },
      );
      if (active) stop = off;
      else off();
    })().catch(() => {});
    return () => {
      active = false;
      stop?.();
    };
  }, [setRoute]);
  const openMini = async () => {
    try {
      await rpc('open_mini_window');
    } catch {
      /* не-Tauri: игнорируем */
    }
  };
  return (
    <WatchActionContext.Provider value={(intent) => setRoute({ kind: 'watch', intent })}>
      <div
        className="app-root"
        data-sport={sport === 'f1' ? 'f1' : 'football'}
        data-theme={theme}
        data-scheme={scheme}
        data-density={density}
        data-design={design}
      >
        <AppTopbar
          sport={sport}
          route={route}
          onBack={back}
          canBack={canBack}
          reset={reset}
          changeMode={changeMode}
          openMini={openMini}
          onWatch={() => togglePage('watch')}
          onSettings={() => togglePage('settings')}
          onSearchTarget={searchTarget}
          onEvents={() => togglePage('events')}
        />
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
        <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
          <aside className="sidebar" aria-label="Навигация">
            <div className="sidebar-heading">
              <span>
                {design === 'broadcast'
                  ? sport === 'f1'
                    ? 'Формула 1'
                    : sport === 'ucl'
                      ? 'Европейский футбол'
                      : sport === 'cup'
                        ? 'Кубковые турниры'
                        : 'Разделы'
                  : sport === 'f1'
                    ? 'RACE CONTROL'
                    : sport === 'ucl'
                      ? 'ЕВРОПЕЙСКИЙ ФУТБОЛ'
                      : 'ВАШЕ ПРОСТРАНСТВО'}
              </span>
              <button
                className="collapse-btn"
                aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            </div>
            <div className="sidebar-scroll">
              <nav className="nav-group">
                {sport === 'football' &&
                  footballNav.map(({ id, label, icon: Icon }) => {
                    const active =
                      id === 'dashboard'
                        ? !auxiliary &&
                          route.kind === 'today' &&
                          (route.mode === undefined || route.mode !== 'plan')
                        : !auxiliary &&
                          route.kind === 'football' &&
                          competition === 'league' &&
                          route.tab === id;
                    return (
                      <button
                        className={`nav-item ${active ? 'active' : ''}`}
                        key={id}
                        title={label}
                        onClick={() =>
                          isLeagueTab(id)
                            ? setRoute({ kind: 'football', competitionId: leagueId, tab: id })
                            : setRoute({ kind: 'today', mode: 'today' })
                        }
                      >
                        <Icon size={18} />
                        <span>{label}</span>
                        {id === 'live' && <i className="live-dot" />}
                      </button>
                    );
                  })}
                {sport === 'f1' &&
                  f1Nav.map(({ id, label, icon: Icon }) => (
                    <button
                      className={`nav-item ${!auxiliary && f1Tab === id ? 'active' : ''}`}
                      key={id}
                      title={label}
                      onClick={() => {
                        setF1Tab(id);
                      }}
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                    </button>
                  ))}
                {sport === 'ucl' &&
                  uclNav.map(({ id, label, icon: Icon }) => (
                    <button
                      className={`nav-item ${!auxiliary && competition === 'ucl' && uclTab === id ? 'active' : ''}`}
                      key={id}
                      title={label}
                      onClick={() => {
                        setUclTab(id);
                      }}
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                    </button>
                  ))}
                {sport === 'cup' &&
                  cupNav.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      className={`nav-item ${!auxiliary && competition === 'cup' && cupTab === id ? 'active' : ''}`}
                      title={label}
                      onClick={() => setCupTab(id)}
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                    </button>
                  ))}
              </nav>
              <TodaySidebar onMatch={openFootballMatch} onWeekend={openWeekend} />
              {sport === 'cup' && (
                <div className="competition-nav" aria-label="Кубковые турниры">
                  <span className="nav-caption">ТУРНИРЫ</span>
                  {CUP_COMPETITIONS.filter((c) => c.id !== CHAMPIONS_LEAGUE_ID).map((c) => (
                    <button
                      key={c.id}
                      className={
                        route.kind === 'football' && route.competitionId === c.id ? 'selected' : ''
                      }
                      onClick={() =>
                        setRoute({ kind: 'football', competitionId: c.id, tab: 'overview' })
                      }
                    >
                      {c.title}
                      <ChevronRight size={12} />
                    </button>
                  ))}
                </div>
              )}
              {sport === 'football' && (
                <div className="competition-nav">
                  <button
                    className="nav-section-toggle"
                    aria-expanded={competitionsOpen}
                    title="Соревнования"
                    onClick={() => setCompetitionsOpen(!competitionsOpen)}
                  >
                    <span>Соревнования</span>
                    <ChevronRight size={14} className={competitionsOpen ? 'expanded' : ''} />
                  </button>
                  {competitionsOpen &&
                    LEAGUES.map((l) => (
                      <button
                        key={l.id}
                        className={leagueId === l.id ? 'selected' : ''}
                        onClick={() => {
                          setRoute(homeRoute('football', cupId), { leagueId: l.id });
                        }}
                        title={l.label}
                      >
                        <span className={`league-symbol league-${l.theme}`}>{l.short}</span>
                        <span>{l.label}</span>
                        <ChevronRight size={12} />
                      </button>
                    ))}
                </div>
              )}
              {sport === 'football' && (
                <div className="competition-nav teams-nav">
                  <button
                    className="nav-section-toggle"
                    aria-expanded={teamsOpen}
                    title="Мои команды"
                    onClick={() => setTeamsOpen(!teamsOpen)}
                  >
                    <span>Мои команды</span>
                    <ChevronRight size={14} className={teamsOpen ? 'expanded' : ''} />
                  </button>
                  {teamsOpen &&
                    favTeams.map((t) => (
                      <button
                        key={t.id}
                        className={
                          route.kind === 'football' && route.tab === 'team' && route.teamId === t.id
                            ? 'selected'
                            : ''
                        }
                        onClick={() =>
                          setRoute({
                            kind: 'football',
                            competitionId: leagueId,
                            tab: 'team',
                            teamId: t.id,
                          })
                        }
                        title={t.name}
                      >
                        <span className="nav-team-dot">
                          <Heart size={10} fill="currentColor" />
                        </span>
                        <span>{t.name}</span>
                        <ChevronRight size={12} />
                      </button>
                    ))}
                  {teamsOpen && !favTeams.length && (
                    <span className="nav-teams-empty muted small">
                      Отметьте команды звёздочкой в «Матчах»
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="sidebar-bottom">
              <button
                className={`nav-item ${route.kind === 'offline' ? 'active' : ''}`}
                title="Офлайн-сезоны"
                onClick={() => togglePage('offline')}
              >
                <HardDriveDownload size={18} />
                <span>Офлайн-сезоны</span>
              </button>
              <button
                className={`nav-item ${route.kind === 'my' && route.tab === 'diary' ? 'active' : ''}`}
                title="Дневник просмотра"
                onClick={() => togglePage('diary')}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <rect x="5" y="3" width="15" height="18" rx="2" />
                  <path d="M9 3v18M3 7h4M3 12h4M3 17h4M12 8h5M12 12h5" />
                </svg>
                <span>Дневник просмотра</span>
              </button>
              <button
                className={`nav-item ${route.kind === 'today' && route.mode === 'plan' ? 'active' : ''}`}
                title="Мой спортивный вечер"
                onClick={openPlanner}
              >
                <CalendarClock size={18} />
                <span>Мой спортивный вечер</span>
              </button>
              {atmosphere.enabled && (
                <button
                  className={`nav-item ${route.kind === 'my' && route.tab === 'games' ? 'active' : ''}`}
                  title="Игры"
                  onClick={() => togglePage('games')}
                >
                  <Gamepad2 size={18} />
                  <span>Игры</span>
                </button>
              )}
              <button
                className={`nav-item ${route.kind === 'settings' ? 'active' : ''}`}
                onClick={() => togglePage('settings')}
                title="Настройки"
              >
                <Settings size={18} />
                <span>Настройки</span>
              </button>
              <div className="sidebar-foot">
                <i />
                <span>
                  Личное пространство <small>SportsDesk / Windows</small>
                </span>
              </div>
            </div>
          </aside>
          <main className="content" key={sport} tabIndex={-1}>
            <div className="content-inner">
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
              <div className="page-breadcrumb" aria-label="Текущий раздел">
                <span>
                  {matchCompetition === 'ucl'
                    ? 'Лига чемпионов'
                    : matchCompetition === 'cup'
                      ? CUP_COMPETITIONS.find((c) => c.id === competitionId)?.title
                      : matchCompetition === 'league'
                        ? LEAGUES.find((l) => l.id === competitionId)?.label
                        : sport === 'football'
                          ? LEAGUES.find((l) => l.id === leagueId)?.label
                          : sport === 'f1'
                            ? 'Формула 1'
                            : sport === 'ucl'
                              ? 'Лига чемпионов'
                              : CUP_COMPETITIONS.find((c) => c.id === cupId)?.title}
                </span>
                <span className="breadcrumb-line" />
                <span>
                  {route.kind === 'settings'
                    ? 'Настройки'
                    : route.kind === 'offline'
                      ? 'Офлайн-сезоны'
                      : route.kind === 'my'
                        ? route.tab === 'games'
                          ? 'Игры'
                          : route.tab === 'schemes'
                            ? 'Мои схемы'
                            : route.tab === 'favorites'
                              ? 'Избранное'
                              : 'Дневник просмотра'
                        : route.kind === 'events'
                          ? 'Центр событий'
                          : route.kind === 'watch'
                            ? 'Онлайн-просмотр'
                            : route.kind === 'today'
                              ? route.mode === 'plan'
                                ? 'Мой спортивный вечер'
                                : footballNav.find((n) => n.id === 'dashboard')?.label
                              : route.kind === 'football-match'
                                ? 'Статистика матча'
                                : route.kind === 'football'
                                  ? competition === 'ucl'
                                    ? uclNav.find((n) => n.id === uclTab)?.label
                                    : competition === 'cup'
                                      ? cupNav.find((n) => n.id === cupTab)?.label
                                      : footballNav.find((n) => n.id === leagueTab)?.label
                                  : f1Nav.find((n) => n.id === f1Tab)?.label}
                </span>
              </div>
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
                        onLeagueChange={setLeagueId}
                        section={
                          route.kind === 'today'
                            ? 'dashboard'
                            : route.kind === 'football-match'
                              ? 'matches'
                              : leagueTab
                        }
                        selectedTeamId={
                          route.kind === 'football' && route.tab === 'team'
                            ? route.teamId
                            : undefined
                        }
                        matchId={route.kind === 'football-match' ? route.matchId : null}
                        onOpenMatch={openFootballMatch}
                        onBackFromMatch={backFromMatch}
                        onOpenTeam={(id, _name, teamLeagueId) => {
                          const teamLeague = isLeagueId(teamLeagueId)
                            ? teamLeagueId
                            : competitionId;
                          setRoute(
                            {
                              kind: 'football',
                              competitionId: teamLeague,
                              tab: 'team',
                              teamId: id,
                            },
                            { leagueId: teamLeague },
                          );
                        }}
                        onNavigate={(section) => {
                          if (section === 'dashboard') setRoute({ kind: 'today', mode: 'today' });
                          else
                            setRoute({
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
                    <CupsView
                      competitionId={route.competitionId}
                      tab={cupTab}
                      onTabChange={setCupTab}
                    />
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
                    <button className="ghost-btn auxiliary-back" onClick={backFromAuxiliary}>
                      <ChevronLeft size={15} /> Вернуться к спорту
                    </button>
                    {route.kind === 'watch' ? (
                      <WatchView intent={route.intent} requestedChannelId={route.channelId} />
                    ) : route.kind === 'offline' ? (
                      <OfflineView />
                    ) : route.kind === 'my' && route.tab === 'diary' ? (
                      <DiaryView
                        onOpen={(reference) =>
                          reference.kind === 'football'
                            ? openFootballMatch(reference.matchId, reference.leagueId ?? undefined)
                            : openWeekend(reference.season, reference.round)
                        }
                      />
                    ) : route.kind === 'my' && route.tab === 'games' ? (
                      <GamesView onOpenMatch={openFootballMatch} />
                    ) : route.kind === 'my' ? null : route.kind === 'events' ? (
                      <EventCenter
                        onOpen={(event) => {
                          if (event.sport === 'f1' && event.season && event.round)
                            openWeekend(event.season, event.round);
                          else if (event.matchId) openFootballMatch(event.matchId, event.leagueId);
                        }}
                      />
                    ) : route.kind === 'today' ? (
                      <ViewingPlanner
                        onOpenMatch={openFootballMatch}
                        onOpenWeekend={(race) => openWeekend(race.season, race.round)}
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
            </div>
          </main>
        </div>
      </div>
    </WatchActionContext.Provider>
  );
}
