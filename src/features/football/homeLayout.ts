import { useMemo, useSyncExternalStore } from 'react';
import { getString, setJson } from './storage';

/** Расположение блоков футбольной главной. Ключ входит в резервную копию профиля (префикс view.). */
export const HOME_LAYOUT_KEY = 'sportsdesk.view.home.layout';
export const HOME_LAYOUT_VERSION = 1;

export type HomeWidgetId = 'insights' | 'calendar' | 'clubs' | 'editorial';
export type HomeDesign = 'classic' | 'broadcast';

export interface HomeWidgetMeta {
  id: HomeWidgetId;
  label: string;
  description: string;
}

export const HOME_WIDGETS: readonly HomeWidgetMeta[] = [
  { id: 'insights', label: 'Сводка', description: 'Клубы под присмотром и ближайший матч' },
  { id: 'calendar', label: 'Экспорт в календарь', description: 'Выгрузка матчей в .ics' },
  { id: 'clubs', label: 'Ваши клубы', description: 'Плитки отслеживаемых команд' },
  {
    id: 'editorial',
    label: 'Расписание и ваши матчи',
    description: 'Расписание лиги, результаты и колонка избранного',
  },
];

const WIDGET_IDS: readonly string[] = HOME_WIDGETS.map((w) => w.id);

/** Стандартный порядок повторяет прежнюю раскладку каждого оформления. */
export const DEFAULT_HOME_ORDER: Readonly<Record<HomeDesign, readonly HomeWidgetId[]>> = {
  classic: ['insights', 'calendar', 'clubs', 'editorial'],
  broadcast: ['editorial', 'clubs', 'insights', 'calendar'],
};

export interface HomeLayoutConfig {
  version: number;
  /** null — стандартный порядок текущего оформления. */
  order: HomeWidgetId[] | null;
  hidden: HomeWidgetId[];
}

export interface ResolvedHomeLayout {
  custom: boolean;
  order: HomeWidgetId[];
  hidden: HomeWidgetId[];
}

function isWidgetId(value: unknown): value is HomeWidgetId {
  return typeof value === 'string' && WIDGET_IDS.includes(value);
}

function uniqueIds(value: unknown): HomeWidgetId[] {
  if (!Array.isArray(value)) return [];
  const out: HomeWidgetId[] = [];
  for (const item of value) if (isWidgetId(item) && !out.includes(item)) out.push(item);
  return out;
}

export function homeWidgetMeta(id: HomeWidgetId): HomeWidgetMeta {
  return HOME_WIDGETS.find((w) => w.id === id) ?? { id, label: id, description: '' };
}

/**
 * Разбирает сохранённую конфигурацию. Неизвестные и повторные id отбрасываются,
 * более новые версии читаются по известным полям — старая копия никогда не ломает главную.
 */
export function parseHomeLayout(raw: string | null): HomeLayoutConfig | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.version !== 'number' || !Number.isFinite(record.version) || record.version < 1)
    return null;
  const order = Array.isArray(record.order) ? uniqueIds(record.order) : [];
  return {
    version: record.version,
    order: order.length ? order : null,
    hidden: uniqueIds(record.hidden),
  };
}

/** Проверка значения при восстановлении профиля. */
export function isValidHomeLayoutValue(raw: string): boolean {
  return parseHomeLayout(raw) !== null;
}

export function resolveHomeLayout(
  config: HomeLayoutConfig | null,
  design: HomeDesign,
): ResolvedHomeLayout {
  const defaults = DEFAULT_HOME_ORDER[design];
  const saved = config?.order ?? null;
  // Новые виджеты, которых нет в сохранённом порядке, добавляются в конец.
  const order = saved ? [...saved, ...defaults.filter((id) => !saved.includes(id))] : [...defaults];
  const hidden = config?.hidden ?? [];
  return { custom: Boolean(saved) || hidden.length > 0, order, hidden };
}

export function readHomeLayout(design: HomeDesign): ResolvedHomeLayout {
  return resolveHomeLayout(parseHomeLayout(getString(HOME_LAYOUT_KEY)), design);
}

function save(order: HomeWidgetId[] | null, hidden: HomeWidgetId[]): void {
  setJson(HOME_LAYOUT_KEY, { version: HOME_LAYOUT_VERSION, order, hidden });
}

export function moveHomeWidget(design: HomeDesign, id: HomeWidgetId, delta: -1 | 1): void {
  const current = readHomeLayout(design);
  const from = current.order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= current.order.length) return;
  const order = [...current.order];
  [order[from], order[to]] = [order[to] as HomeWidgetId, order[from] as HomeWidgetId];
  save(order, current.hidden);
}

export function setHomeWidgetHidden(design: HomeDesign, id: HomeWidgetId, hidden: boolean): void {
  const current = readHomeLayout(design);
  const saved = parseHomeLayout(getString(HOME_LAYOUT_KEY));
  const next = hidden
    ? [...current.hidden.filter((x) => x !== id), id]
    : current.hidden.filter((x) => x !== id);
  save(saved?.order ? current.order : null, next);
}

export function resetHomeLayout(): void {
  save(null, []);
}

function subscribe(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener('sportsdesk-storage-changed', handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener('sportsdesk-storage-changed', handler);
    window.removeEventListener('storage', handler);
  };
}

export function useHomeLayout(design: HomeDesign): ResolvedHomeLayout {
  const raw = useSyncExternalStore(
    subscribe,
    () => getString(HOME_LAYOUT_KEY),
    () => null,
  );
  return useMemo(() => resolveHomeLayout(parseHomeLayout(raw), design), [raw, design]);
}
