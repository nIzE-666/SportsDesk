import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  HardDriveDownload,
  Heart,
  Settings,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppTopbar } from '../components/AppTopbar';
import { TodaySidebar } from '../components/TodaySidebar';
import { useAtmosphere } from '../features/atmosphere/atmosphereStore';
import { getJson, getString, setString, STORAGE_KEYS } from '../features/football/storage';
import { CUP_COMPETITIONS } from '../features/ucl/cups';
import {
  CHAMPIONS_LEAGUE_ID,
  competitionKind,
  homeRoute,
  isChampionsTab,
  isCupTab,
  isF1Tab,
  isLeagueTab,
} from '../lib/navigation';
import { LEAGUES, cupNav, f1Nav, footballNav, uclNav } from '../lib/navigationMetadata';
import type { FootballSection } from '../features/football/FootballView';
import { RouteContent } from './RouteContent';
import type { FrameProps } from './frame';

/** Tracked teams for the sidebar: ids from localStorage plus catalogue names. */
export function resolveSidebarFavorites(): Array<{ id: string; name: string }> {
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

/** The current frame: sidebar, top bar and page content. Kept until U2.11. */
export function LegacyShell(props: FrameProps) {
  const {
    route,
    sport,
    leagueId,
    cupId,
    design,
    scheme,
    density,
    canBack,
    onBack,
    navigate,
    changeSport,
    auxiliary,
    setLeagueId,
    searchTarget,
    openFootballMatch,
    openWeekend,
    openMini,
    children,
  } = props;
  const atmosphere = useAtmosphere();
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
  const [collapsed, setCollapsed] = useState(
    () => getString('sportsdesk.sidebar.collapsed') === '1',
  );
  const [competitionsOpen, setCompetitionsOpen] = useState(
    () => getString('sportsdesk.sidebar.competitionsOpen') !== '0',
  );
  const [teamsOpen, setTeamsOpen] = useState(
    () => getString('sportsdesk.sidebar.teamsOpen') !== '0',
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
  // The sidebar shows the current list of tracked teams.
  useEffect(() => {
    const onFav = () => setFavTeams(resolveSidebarFavorites());
    window.addEventListener('sportsdesk-favorites-changed', onFav);
    return () => window.removeEventListener('sportsdesk-favorites-changed', onFav);
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
  const auxiliaryPage =
    route.kind === 'watch' ||
    route.kind === 'settings' ||
    route.kind === 'events' ||
    route.kind === 'my' ||
    route.kind === 'offline' ||
    (route.kind === 'today' && route.mode === 'plan');
  const reset = () => navigate(homeRoute(sport, cupId));
  const togglePage = auxiliary;
  const backFromAuxiliary = onBack;
  const openPlanner = () => auxiliary('planner');

  return (
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
        onBack={onBack}
        canBack={canBack}
        reset={reset}
        changeMode={changeSport}
        openMini={openMini}
        onWatch={() => togglePage('watch')}
        onSettings={() => togglePage('settings')}
        onSearchTarget={searchTarget}
        onEvents={() => togglePage('events')}
      />
      {children}
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
                      ? !auxiliaryPage &&
                        route.kind === 'today' &&
                        (route.mode === undefined || route.mode !== 'plan')
                      : !auxiliaryPage &&
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
                          ? navigate({ kind: 'football', competitionId: leagueId, tab: id })
                          : navigate({ kind: 'today', mode: 'today' })
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
                    className={`nav-item ${!auxiliaryPage && f1Tab === id ? 'active' : ''}`}
                    key={id}
                    title={label}
                    onClick={() => {
                      navigate({ kind: 'f1', tab: id });
                    }}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                  </button>
                ))}
              {sport === 'ucl' &&
                uclNav.map(({ id, label, icon: Icon }) => (
                  <button
                    className={`nav-item ${!auxiliaryPage && competition === 'ucl' && uclTab === id ? 'active' : ''}`}
                    key={id}
                    title={label}
                    onClick={() => {
                      navigate({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: id });
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
                    className={`nav-item ${!auxiliaryPage && competition === 'cup' && cupTab === id ? 'active' : ''}`}
                    title={label}
                    onClick={() => navigate({ kind: 'football', competitionId: cupId, tab: id })}
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
                      navigate({ kind: 'football', competitionId: c.id, tab: 'overview' })
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
                        navigate(homeRoute('football', cupId), { leagueId: l.id });
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
                        navigate({
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
            <RouteContent
              route={route}
              sport={sport}
              leagueId={leagueId}
              cupId={cupId}
              onNavigate={navigate}
              onLeagueChange={setLeagueId}
              onOpenMatch={openFootballMatch}
              onOpenWeekend={openWeekend}
              onBack={onBack}
              auxiliaryBack={
                <button className="ghost-btn auxiliary-back" onClick={backFromAuxiliary}>
                  <ChevronLeft size={15} /> Вернуться к спорту
                </button>
              }
              contentHeader={
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
              }
            />
          </div>
        </main>
      </div>
    </div>
  );
}
