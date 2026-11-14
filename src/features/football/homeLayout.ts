import { useMemo, useSyncExternalStore } from 'react';
import { getString, setJson } from './storage';

/**
 * Расположение блоков главной. Ключ входит в резервную копию профиля (префикс view.).
 * Один ключ обслуживает старую футбольную главную и новый экран «Сегодня»: у каждого
 * экрана свой набор идентификаторов, поэтому сохранённый порядок не смешивается.
 */
export const HOME_LAYOUT_KEY = 'sportsdesk.view.home.layout';
export const HOME_LAYOUT_VERSION = 1;

/** Старая футбольная главная и новый экран «Сегодня». */
export type HomeLayoutScope = 'dashboard' | 'today';
export type HomeWidgetId =
  'insights' | 'calendar' | 'clubs' | 'editorial' | 'catchup' | 'live' | 'upcoming' | 'teams';
export type HomeDesign = 'classic' | 'broadcast';

export interface HomeWidgetMeta {
  id: HomeWidgetId;
  label: string;
  description: string;
  scope: HomeLayoutScope;
}

export const HOME_WIDGETS: readonly HomeWidgetMeta[] = [
  {
    id: 'insights',
    label: 'Сводка',
    description: 'Клубы под присмотром и ближайший матч',
    scope: 'dashboard',
  },
  {
    id: 'calendar',
    label: 'Экспорт в календарь',
    description: 'Выгрузка матчей в .ics',
    scope: 'dashboard',
  },
  {
    id: 'clubs',
    label: 'Ваши клубы',
    description: 'Плитки отслеживаемых команд',
    scope: 'dashboard',
  },
  {
    id: 'editorial',
    label: 'Расписание и ваши матчи',
    description: 'Расписание лиги, результаты и колонка избранного',
    scope: 'dashboard',
  },
  {
    id: 'catchup',
    label: 'Пока вас не было',
    description: 'Пропущенные результаты',
    scope: 'today',
  },
  { id: 'live', label: 'Сейчас', description: 'Идущие матчи', scope: 'today' },
  { id: 'upcoming', label: 'Ближайшее', description: 'Сегодня и завтра', scope: 'today' },
  {
    id: 'teams',
    label: 'Мои команды',
    description: 'Любимые клубы и команды Формулы-1',
    scope: 'today',
  },
];

const WIDGET_IDS: readonly string[] = HOME_WIDGETS.map((w) => w.id);

/** Стандартный порядок повторяет прежнюю раскладку каждого оформления. */
export const DEFAULT_HOME_ORDER: Readonly<Record<HomeDesign, readonly HomeWidgetId[]>> = {
  classic: ['insights', 'calendar', 'clubs', 'editorial'],
  broadcast: ['editorial', 'clubs', 'insights', 'calendar'],
};

/** Порядок блоков экрана «Сегодня»; от оформления не зависит. */
export const DEFAULT_TODAY_ORDER: readonly HomeWidgetId[] = [
  'catchup',
  'live',
  'upcoming',
  'teams',
];

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

function isWidgetIdForScope(value: unknown, scope: HomeLayoutScope): value is HomeWidgetId {
  return isWidgetId(value) && homeWidgetMeta(value).scope === scope;
}

function uniqueIds(value: unknown): HomeWidgetId[] {
  if (!Array.isArray(value)) return [];
  const out: HomeWidgetId[] = [];
  for (const item of value) if (isWidgetId(item) && !out.includes(item)) out.push(item);
  return out;
}

function scopeOrder(
  config: HomeLayoutConfig | null,
  scope: HomeLayoutScope,
): HomeWidgetId[] | null {
  const saved = config?.order?.filter((id) => isWidgetIdForScope(id, scope)) ?? [];
  return saved.length ? saved : null;
}

function scopeHidden(config: HomeLayoutConfig | null, scope: HomeLayoutScope): HomeWidgetId[] {
  return (config?.hidden ?? []).filter((id) => isWidgetIdForScope(id, scope));
}

export function homeWidgetMeta(id: HomeWidgetId): HomeWidgetMeta {
  return (
    HOME_WIDGETS.find((w) => w.id === id) ?? { id, label: id, description: '', scope: 'dashboard' }
  );
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
  scope: HomeLayoutScope = 'dashboard',
): ResolvedHomeLayout {
  const defaults = scope === 'today' ? DEFAULT_TODAY_ORDER : DEFAULT_HOME_ORDER[design];
  const saved = scopeOrder(config, scope);
  // Новые виджеты, которых нет в сохранённом порядке, добавляются в конец.
  const order = saved ? [...saved, ...defaults.filter((id) => !saved.includes(id))] : [...defaults];
  const hidden = scopeHidden(config, scope);
  return { custom: Boolean(saved) || hidden.length > 0, order, hidden };
}

export function readHomeLayout(
  design: HomeDesign,
  scope: HomeLayoutScope = 'dashboard',
): ResolvedHomeLayout {
  return resolveHomeLayout(parseHomeLayout(getString(HOME_LAYOUT_KEY)), design, scope);
}

/** Сохраняет порядок одного экрана, не теряя порядок и скрытые блоки другого. */
function saveScoped(
  scope: HomeLayoutScope,
  order: HomeWidgetId[] | null,
  hidden: HomeWidgetId[],
): void {
  const existing = parseHomeLayout(getString(HOME_LAYOUT_KEY));
  const otherOrder = existing?.order?.filter((id) => !isWidgetIdForScope(id, scope)) ?? [];
  const otherHidden = existing?.hidden?.filter((id) => !isWidgetIdForScope(id, scope)) ?? [];
  const nextOrder = order ? [...otherOrder, ...order] : otherOrder.length ? otherOrder : null;
  setJson(HOME_LAYOUT_KEY, {
    version: HOME_LAYOUT_VERSION,
    order: nextOrder,
    hidden: [...otherHidden, ...hidden],
  });
}

export function moveHomeWidget(
  design: HomeDesign,
  id: HomeWidgetId,
  delta: -1 | 1,
  scope: HomeLayoutScope = 'dashboard',
): void {
  const current = readHomeLayout(design, scope);
  const from = current.order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= current.order.length) return;
  const order = [...current.order];
  [order[from], order[to]] = [order[to] as HomeWidgetId, order[from] as HomeWidgetId];
  saveScoped(scope, order, current.hidden);
}

export function setHomeWidgetHidden(
  design: HomeDesign,
  id: HomeWidgetId,
  hidden: boolean,
  scope: HomeLayoutScope = 'dashboard',
): void {
  const current = readHomeLayout(design, scope);
  const saved = scopeOrder(parseHomeLayout(getString(HOME_LAYOUT_KEY)), scope);
  const next = hidden
    ? [...current.hidden.filter((x) => x !== id), id]
    : current.hidden.filter((x) => x !== id);
  saveScoped(scope, saved ? current.order : null, next);
}

export function resetHomeLayout(scope: HomeLayoutScope = 'dashboard'): void {
  const existing = parseHomeLayout(getString(HOME_LAYOUT_KEY));
  if (!existing) {
    saveScoped(scope, null, []);
    return;
  }
  const order = existing.order?.filter((id) => !isWidgetIdForScope(id, scope)) ?? [];
  const hidden = existing.hidden.filter((id) => !isWidgetIdForScope(id, scope));
  setJson(HOME_LAYOUT_KEY, {
    version: HOME_LAYOUT_VERSION,
    order: order.length ? order : null,
    hidden,
  });
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

export function useHomeLayout(
  design: HomeDesign,
  scope: HomeLayoutScope = 'dashboard',
): ResolvedHomeLayout {
  const raw = useSyncExternalStore(
    subscribe,
    () => getString(HOME_LAYOUT_KEY),
    () => null,
  );
  return useMemo(
    () => resolveHomeLayout(parseHomeLayout(raw), design, scope),
    [raw, design, scope],
  );
}
