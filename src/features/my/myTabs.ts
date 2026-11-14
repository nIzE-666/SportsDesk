import { readModules, type ModulesState } from '../../lib/modules';
import type { MyTab } from '../../lib/navigation';

/** Tabs of «Моё» and the modules that hide them (plan U2.6, sections 3.2 and 3.6). */
export const MY_TAB_LABELS: Record<MyTab, string> = {
  favorites: 'Избранное',
  diary: 'Дневник',
  games: 'Игры и прогнозы',
  schemes: 'Схемы',
};

export const MY_TAB_ORDER: readonly MyTab[] = ['favorites', 'diary', 'games', 'schemes'];

export function isMyTabVisible(tab: MyTab, modules: ModulesState): boolean {
  if (tab === 'diary') return modules.diary;
  if (tab === 'games') return modules.games || modules.predictions;
  if (tab === 'schemes') return modules.tactics;
  return true;
}

/** «Избранное» is always visible; the rest follow their module switches. */
export function visibleMyTabs(modules: ModulesState = readModules()): MyTab[] {
  return MY_TAB_ORDER.filter((tab) => isMyTabVisible(tab, modules));
}

/** A hidden or missing current tab opens the first visible one. */
export function resolveMyTab(tab: MyTab | undefined, modules: ModulesState = readModules()): MyTab {
  const visible = visibleMyTabs(modules);
  return tab && visible.includes(tab) ? tab : visible[0]!;
}
