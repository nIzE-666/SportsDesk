import {
  Activity,
  ArrowLeftRight,
  CalendarDays,
  Gauge,
  LayoutDashboard,
  Trophy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type TabId = 'overview' | 'calendar' | 'standings' | 'compare' | 'pace' | 'session';

export type F1AnalysisMode = 'compare' | 'pace' | 'session';

export interface F1Tab {
  id: 'overview' | 'calendar' | 'standings' | 'analysis';
  label: string;
  icon: LucideIcon;
  tabs: readonly TabId[];
}

export const F1_TABS: readonly F1Tab[] = [
  { id: 'overview', label: 'Обзор', icon: LayoutDashboard, tabs: ['overview'] },
  { id: 'calendar', label: 'Календарь', icon: CalendarDays, tabs: ['calendar'] },
  { id: 'standings', label: 'Зачёты', icon: Trophy, tabs: ['standings'] },
  { id: 'analysis', label: 'Анализ', icon: Activity, tabs: ['compare', 'pace', 'session'] },
];

export const F1_ANALYSIS_MODES: readonly {
  id: F1AnalysisMode;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'compare', label: 'Сравнение пилотов', icon: ArrowLeftRight },
  { id: 'pace', label: 'Темп по кругам', icon: Gauge },
  { id: 'session', label: 'Центр сессии', icon: Activity },
];

export function f1TabFor(tab: TabId): F1Tab {
  return F1_TABS.find((entry) => entry.tabs.includes(tab)) ?? F1_TABS[0]!;
}
