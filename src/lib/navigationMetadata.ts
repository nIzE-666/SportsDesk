import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  Radio,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
export const LEAGUES = [
  { id: 'l_4WFCIZ', label: 'Premier League', short: 'PL', theme: 'epl' },
  { id: 'l_0ErfuF', label: 'Ла Лига', short: 'LL', theme: 'laliga' },
  { id: 'l_0ALvwF', label: 'Серия A', short: 'SA', theme: 'seriea' },
  { id: 'l_1Isor4', label: 'Бундеслига', short: 'BL', theme: 'bundesliga' },
  { id: 'l_3FJFUl', label: 'Лига 1', short: 'L1', theme: 'ligue1' },
  { id: 'l_0eg6C9', label: 'MLS', short: 'MLS', theme: 'mls' },
] as const;
export const footballNav = [
  { id: 'dashboard', label: 'Мой обзор', icon: LayoutDashboard },
  { id: 'matches', label: 'Матчи', icon: CalendarDays },
  { id: 'standings', label: 'Таблицы', icon: ListOrdered },
  { id: 'live', label: 'Счёт и события', icon: Radio },
  { id: 'players', label: 'Игроки', icon: Users },
  { id: 'team', label: 'Клубы', icon: Shield },
] as const;
export const f1Nav = [
  { id: 'overview', label: 'Паддок', icon: LayoutDashboard },
  { id: 'calendar', label: 'Календарь', icon: CalendarDays },
  { id: 'standings', label: 'Зачёты', icon: Trophy },
  { id: 'compare', label: 'Сравнение пилотов', icon: ArrowLeftRight },
  { id: 'pace', label: 'Темп по кругам', icon: Gauge },
  { id: 'session', label: 'Центр сессии', icon: Activity },
] as const;
export const uclNav = [
  { id: 'overview', label: 'Европейский вечер', icon: Sparkles },
  { id: 'table', label: 'Общая таблица', icon: ListOrdered },
  { id: 'bracket', label: 'Сетка плей-офф', icon: Trophy },
  { id: 'matches', label: 'Все матчи', icon: CalendarDays },
  { id: 'stats', label: 'Игроки и статистика', icon: BarChart3 },
] as const;
export const cupNav = [
  { id: 'overview', label: 'Обзор', icon: Sparkles },
  { id: 'table', label: 'Таблица', icon: ListOrdered },
  { id: 'bracket', label: 'Сетка плей-офф', icon: Trophy },
  { id: 'matches', label: 'Все матчи', icon: CalendarDays },
] as const;
