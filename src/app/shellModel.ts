import { F1_TABS, f1TabFor, type F1AnalysisMode } from '../features/f1/f1Tabs';
import { CUP_COMPETITIONS } from '../features/ucl/cups';
import {
  CHAMPIONS_LEAGUE_ID,
  competitionKind,
  defaultFootballTab,
  isChampionsTab,
  isCupTab,
  isF1Tab,
  isLeagueTab,
  type ChampionsTab,
  type CupTab,
  type LeagueTab,
  type ShellRoute,
} from '../lib/navigation';
import { LEAGUES } from '../lib/navigationMetadata';
import { viewState } from '../lib/viewState';
import { MY_TAB_LABELS, resolveMyTab, visibleMyTabs } from '../features/my/myTabs';

const F1_ANALYSIS_KEY = 'f1.analysis.mode';
const DEFAULT_ANALYSIS_MODE: F1AnalysisMode = 'compare';

function isAnalysisMode(value: unknown): value is F1AnalysisMode {
  return value === 'compare' || value === 'pace' || value === 'session';
}

/** Last opened analysis mode, or «Сравнение пилотов» on the first visit. */
export function lastAnalysisMode(): F1AnalysisMode {
  return viewState.read(F1_ANALYSIS_KEY, DEFAULT_ANALYSIS_MODE, isAnalysisMode);
}

export function rememberAnalysisMode(tab: unknown): void {
  if (isAnalysisMode(tab)) viewState.write(F1_ANALYSIS_KEY, tab);
}

export function competitionName(id: string): string {
  const kind = competitionKind(id);
  if (kind === 'ucl') return 'Лига чемпионов';
  if (kind === 'cup')
    return CUP_COMPETITIONS.find((competition) => competition.id === id)?.title ?? 'Кубок';
  if (kind === 'league') return LEAGUES.find((league) => league.id === id)?.label ?? 'Футбол';
  return 'Футбол';
}

export function pageTitle(route: ShellRoute, leagueId: string): string {
  switch (route.kind) {
    case 'today':
      return 'Сегодня';
    case 'football':
      return competitionName(route.competitionId);
    case 'football-match':
      return `${competitionName(route.competitionId)} · Матч`;
    case 'f1':
      return 'Формула 1';
    case 'watch':
      return 'Смотреть';
    case 'my':
      return 'Моё';
    case 'settings':
      return 'Настройки';
    case 'events':
      return 'События';
    case 'offline':
      return 'Офлайн-сезоны';
    default:
      return competitionName(leagueId);
  }
}

export interface HeaderTab {
  key: string;
  label: string;
  active: boolean;
  route: ShellRoute;
}

const LEAGUE_TABS: ReadonlyArray<[LeagueTab, string]> = [
  ['matches', 'Матчи'],
  ['standings', 'Таблица'],
  ['team', 'Клубы'],
  ['players', 'Игроки'],
  ['live', 'Сейчас идут'],
];

const CHAMPIONS_TABS: ReadonlyArray<[ChampionsTab, string]> = [
  ['overview', 'Обзор'],
  ['table', 'Таблица'],
  ['bracket', 'Сетка'],
  ['matches', 'Матчи'],
  ['stats', 'Игроки'],
];

const CUP_TABS: ReadonlyArray<[CupTab, string]> = [
  ['overview', 'Обзор'],
  ['table', 'Таблица'],
  ['bracket', 'Сетка'],
  ['matches', 'Матчи'],
];

function footballTabs(route: Extract<ShellRoute, { kind: 'football' }>): HeaderTab[] {
  const id = route.competitionId;
  const kind = competitionKind(id);
  if (kind === 'ucl') {
    const active = isChampionsTab(route.tab) ? route.tab : 'overview';
    return CHAMPIONS_TABS.map(([key, label]) => ({
      key,
      label,
      active: key === active,
      route: { kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: key },
    }));
  }
  if (kind === 'cup') {
    const active = isCupTab(route.tab) ? route.tab : 'overview';
    return CUP_TABS.map(([key, label]) => ({
      key,
      label,
      active: key === active,
      route: { kind: 'football', competitionId: id, tab: key },
    }));
  }
  const active = isLeagueTab(route.tab) ? route.tab : defaultFootballTab(id);
  return LEAGUE_TABS.map(([key, label]) => ({
    key,
    label,
    active: key === active,
    route: { kind: 'football', competitionId: id, tab: key },
  }));
}

function f1Tabs(route: Extract<ShellRoute, { kind: 'f1' }>): HeaderTab[] {
  const tab = isF1Tab(route.tab) ? route.tab : 'overview';
  const active = f1TabFor(tab).id;
  return F1_TABS.map((entry) => ({
    key: entry.id,
    label: entry.label,
    active: entry.id === active,
    route: {
      kind: 'f1',
      tab: entry.id === 'analysis' ? lastAnalysisMode() : (entry.tabs[0] ?? 'overview'),
    },
  }));
}

/** Tabs of the page header for the current route; empty for service pages and matches. */
export function headerTabs(route: ShellRoute): HeaderTab[] {
  switch (route.kind) {
    case 'today': {
      const active = route.mode ?? 'today';
      return [
        {
          key: 'today',
          label: 'Сегодня',
          active: active === 'today',
          route: { kind: 'today', mode: 'today' },
        },
        {
          key: 'week',
          label: 'Неделя',
          active: active === 'week',
          route: { kind: 'today', mode: 'week' },
        },
        {
          key: 'plan',
          label: 'Мой план',
          active: active === 'plan',
          route: { kind: 'today', mode: 'plan' },
        },
      ];
    }
    case 'football':
      return footballTabs(route);
    case 'f1':
      return f1Tabs(route);
    case 'my': {
      const active = resolveMyTab(route.tab);
      return visibleMyTabs().map((tab) => ({
        key: tab,
        label: MY_TAB_LABELS[tab],
        active: tab === active,
        route: { kind: 'my', tab },
      }));
    }
    default:
      return [];
  }
}
