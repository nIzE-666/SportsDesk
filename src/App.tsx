import { ChevronLeft, ChevronRight, CalendarClock, Heart, Settings, Tv } from 'lucide-react';
import { useEffect, useState } from 'react';
import ConnectivityBanner from './components/ConnectivityBanner';
import WhatsNewDialog from './components/WhatsNewDialog';
import type { TabId as F1Tab } from './features/f1/F1View';
import { F1View } from './features/f1/F1View';
import { FootballView } from './features/football/FootballView';
import { MiniWindow } from './features/football/MiniWindow';
import { SportsNotifications } from './features/football/SportsNotifications';
import {
  getJson,
  getString,
  getUserTimezone,
  setString,
  STORAGE_KEYS,
} from './features/football/storage';
import { SettingsView } from './features/settings/SettingsView';
import { UpdateNotice, UpdateProvider } from './features/settings/Updates';
import type { UclTab } from './features/ucl/ChampionsView';
import { ChampionsView } from './features/ucl/ChampionsView';
import type { CupTab } from './features/ucl/CupsView';
import { CupsView } from './features/ucl/CupsView';
import { CUP_COMPETITIONS } from './features/ucl/cups';
import { WatchView } from './features/watch/WatchView';
import { ViewingPlanner } from './features/planner/ViewingPlanner';

import { AppTopbar } from './components/AppTopbar';
import { TodaySidebar } from './components/TodaySidebar';
import { PageFrame } from './components/PageFrame';
import { SectionBoundary } from './components/SectionBoundary';
import { homeRoute } from './lib/navigation';
import { useShellNavigation } from './lib/useShellNavigation';
import { LEAGUES, footballNav, f1Nav, uclNav, cupNav } from './lib/navigationMetadata';
import { viewState } from './lib/viewState';
export type { FootballSection, ShellRoute, Sport } from './lib/navigation';
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
  const navigation = useShellNavigation();
  const { sport, cupId, route, leagueId, navigate: setRoute, back, canBack } = navigation;
  const f1Tab = route.kind === 'f1' ? (route.tab ?? 'overview') : 'overview';
  const uclTab = route.kind === 'ucl' ? (route.tab ?? 'overview') : 'overview';
  const cupTab = route.kind === 'cup' ? (route.tab ?? 'overview') : 'overview';
  const setF1Tab = (tab: F1Tab) => setRoute({ kind: 'f1', tab });
  const setUclTab = (tab: UclTab) => setRoute({ kind: 'ucl', tab });
  const setCupTab = (tab: CupTab) => setRoute({ kind: 'cup', cupId, tab });
  const setLeagueId = (id: string) => setRoute(route, { leagueId: id });
  const [collapsed, setCollapsed] = useState(
    () => getString('sportsdesk.sidebar.collapsed') === '1',
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
  useEffect(() => setString('sportsdesk.scheme', scheme), [scheme]);
  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.style.backgroundColor = scheme === 'light' ? '#f3f6fb' : '#0b101c';
    void import('./lib/bridge')
      .then(({ isTauriRuntime, rpc }) => {
        if (isTauriRuntime()) return rpc('apply_window_appearance', { scheme });
      })
      .catch(() => {});
  }, [scheme]);
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
  const theme =
    sport === 'football'
      ? (LEAGUES.find((l) => l.id === leagueId)?.theme ?? 'epl')
      : sport === 'cup'
        ? 'ucl'
        : sport;
  const auxiliary = route.kind === 'watch' || route.kind === 'settings' || route.kind === 'planner';
  const reset = () => setRoute(homeRoute(sport, cupId));
  const changeMode = navigation.changeSport;
  const openFootballMatch = (matchId: string, eventLeague?: string) =>
    setRoute({ kind: 'football-match', matchId }, eventLeague ? { leagueId: eventLeague } : {});
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
  useEffect(() => {
    let active = true,
      stop: (() => void) | undefined;
    void import('./lib/bridge').then(async ({ isTauriRuntime }) => {
      if (!isTauriRuntime()) return;
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<{ kind: string; matchId?: string; season?: string; round?: string }>(
        'sportsdesk://open-event',
        ({ payload: e }) => {
          if (e.kind === 'match' && e.matchId)
            setRoute({ kind: 'football-match', matchId: e.matchId });
          if (e.kind === 'f1' && e.season && e.round) openWeekend(e.season, e.round);
        },
      );
      if (active) stop = off;
      else off();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, [setRoute]);
  const openMini = async () => {
    try {
      await import('./lib/bridge').then(({ rpc }) => rpc('open_mini_window'));
    } catch {
      /* не-Tauri: игнорируем */
    }
  };
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: getUserTimezone(),
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  }).format(new Date());
  return (
    <div
      className="app-root"
      data-sport={sport === 'f1' ? 'f1' : 'football'}
      data-theme={theme}
      data-scheme={scheme}
      data-density={density}
    >
      <AppTopbar
        sport={sport}
        route={route}
        onBack={back}
        canBack={canBack}
        date={date}
        reset={reset}
        changeMode={changeMode}
        openMini={openMini}
        onWatch={() => togglePage('watch')}
        onSettings={() => togglePage('settings')}
      />
      <SportsNotifications />
      <WhatsNewDialog />
      <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
        <aside className="sidebar" aria-label="Навигация">
          <div className="sidebar-heading">
            <span>
              {sport === 'f1'
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
          <nav className="nav-group">
            {sport === 'football' &&
              footballNav.map(({ id, label, icon: Icon }) => (
                <button
                  className={`nav-item ${!auxiliary && route.kind === 'football' && route.section === id ? 'active' : ''}`}
                  key={id}
                  title={label}
                  onClick={() => setRoute({ kind: 'football', section: id })}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  {id === 'live' && <i className="live-dot" />}
                </button>
              ))}
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
                  className={`nav-item ${!auxiliary && uclTab === id ? 'active' : ''}`}
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
                  className={`nav-item ${!auxiliary && cupTab === id ? 'active' : ''}`}
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
              {CUP_COMPETITIONS.filter((c) => c.id !== 'l_0bfbkO').map((c) => (
                <button
                  key={c.id}
                  className={c.id === cupId ? 'selected' : ''}
                  onClick={() => setRoute({ kind: 'cup', cupId: c.id, tab: 'overview' })}
                >
                  {c.title}
                  <ChevronRight size={12} />
                </button>
              ))}
            </div>
          )}
          {sport === 'football' && (
            <div className="competition-nav">
              <span className="nav-caption">СОРЕВНОВАНИЯ</span>
              {LEAGUES.map((l) => (
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
              <button onClick={() => changeMode('ucl')} title="Лига чемпионов">
                <span className="league-symbol league-ucl">✦</span>
                <span>Лига чемпионов</span>
                <ChevronRight size={12} />
              </button>
              {CUP_COMPETITIONS.filter((c) => c.id !== 'l_0bfbkO').map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setRoute({ kind: 'cup', cupId: c.id, tab: 'overview' });
                  }}
                  title={c.title}
                >
                  <span className="league-symbol league-ucl">
                    {c.id === 'l_38d9HA' ? 'EL' : c.id === 'l_2WZ2tt' ? 'CL' : 'WC'}
                  </span>
                  <span>{c.title}</span>
                  <ChevronRight size={12} />
                </button>
              ))}
            </div>
          )}
          {sport === 'football' && (
            <div className="competition-nav teams-nav">
              <span className="nav-caption">МОИ КОМАНДЫ</span>
              {favTeams.map((t) => (
                <button
                  key={t.id}
                  className={
                    route.kind === 'football' && route.section === 'team' && route.teamId === t.id
                      ? 'selected'
                      : ''
                  }
                  onClick={() => setRoute({ kind: 'football', section: 'team', teamId: t.id })}
                  title={t.name}
                >
                  <span className="nav-team-dot">
                    <Heart size={10} fill="currentColor" />
                  </span>
                  <span>{t.name}</span>
                  <ChevronRight size={12} />
                </button>
              ))}
              {!favTeams.length && (
                <span className="nav-teams-empty muted small">
                  Отметьте команды звёздочкой в «Матчах»
                </span>
              )}
            </div>
          )}
          <div className="sidebar-bottom">
            <button
              className={`nav-item ${route.kind === 'planner' ? 'active' : ''}`}
              title="Мой спортивный вечер"
              onClick={openPlanner}
            >
              <CalendarClock size={18} />
              <span>Мой спортивный вечер</span>
            </button>
            <button
              className={`nav-item ${route.kind === 'watch' ? 'active' : ''}`}
              onClick={() => togglePage('watch')}
              title="Онлайн-просмотр"
            >
              <Tv size={18} />
              <span>Онлайн-просмотр</span>
            </button>
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
                route.kind === 'planner'
                  ? ['pitch', 'jolpica']
                  : route.kind === 'settings' || route.kind === 'watch'
                    ? []
                    : sport === 'f1'
                      ? ['jolpica', 'openf1']
                      : ['pitch', 'sportscore', 'espn']
              }
            />
            <UpdateNotice />
            <div className="page-breadcrumb" aria-label="Текущий раздел">
              <span>
                {sport === 'football'
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
                  : route.kind === 'watch'
                    ? 'Онлайн-просмотр'
                    : route.kind === 'planner'
                      ? 'Мой спортивный вечер'
                      : route.kind === 'football-match'
                        ? 'Статистика матча'
                        : route.kind === 'football'
                          ? footballNav.find((n) => n.id === route.section)?.label
                          : route.kind === 'f1'
                            ? f1Nav.find((n) => n.id === f1Tab)?.label
                            : route.kind === 'ucl'
                              ? uclNav.find((n) => n.id === uclTab)?.label
                              : cupNav.find((n) => n.id === cupTab)?.label}
              </span>
            </div>
            {!auxiliary && sport === 'football' && (
              <SectionBoundary
                name="Футбол"
                resetKey={`football.${leagueId}.${JSON.stringify(route)}`}
              >
                <FootballView
                  leagueId={leagueId}
                  onLeagueChange={setLeagueId}
                  section={route.kind === 'football' ? route.section : 'matches'}
                  selectedTeamId={route.kind === 'football' ? route.teamId : undefined}
                  matchId={route.kind === 'football-match' ? route.matchId : null}
                  onOpenMatch={openFootballMatch}
                  onBackFromMatch={backFromMatch}
                  onOpenTeam={(id) => setRoute({ kind: 'football', section: 'team', teamId: id })}
                  onNavigate={(section) => setRoute({ kind: 'football', section })}
                />
              </SectionBoundary>
            )}
            {!auxiliary && sport === 'f1' && (
              <SectionBoundary name="Раздел" resetKey={`f1.${f1Tab}.${cupId}`}>
                <F1View tab={f1Tab} onTabChange={setF1Tab} />
              </SectionBoundary>
            )}
            {!auxiliary && sport === 'ucl' && (
              <SectionBoundary name="Раздел" resetKey={`ucl.${uclTab}.${cupId}`}>
                <ChampionsView tab={uclTab} onTabChange={setUclTab} />
              </SectionBoundary>
            )}
            {!auxiliary && sport === 'cup' && (
              <SectionBoundary name="Раздел" resetKey={`cup.${cupTab}.${cupId}`}>
                <CupsView competitionId={cupId} tab={cupTab} onTabChange={setCupTab} />
              </SectionBoundary>
            )}
            {auxiliary && (
              <PageFrame page={route.kind}>
                <button className="ghost-btn auxiliary-back" onClick={backFromAuxiliary}>
                  <ChevronLeft size={15} /> Вернуться к спорту
                </button>
                {route.kind === 'watch' ? (
                  <WatchView />
                ) : route.kind === 'planner' ? (
                  <ViewingPlanner
                    onOpenMatch={(id, eventLeague) =>
                      setRoute(
                        { kind: 'football-match', matchId: id },
                        eventLeague ? { leagueId: eventLeague } : {},
                      )
                    }
                    onOpenWeekend={(race) => openWeekend(race.season, race.round)}
                  />
                ) : (
                  <SettingsView />
                )}
              </PageFrame>
            )}
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
  );
}
