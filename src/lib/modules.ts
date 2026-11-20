import { useSyncExternalStore } from 'react';
import { getString, setJson } from '../features/football/storage';
import { CUP_COMPETITIONS } from '../features/ucl/cupMetadata';
import { LEAGUES } from './navigationMetadata';

/**
 * Выключатели возможностей (план U2.9, раздел 3.6).
 *
 * Один ключ профиля хранит только сами выключатели; настройки звука остаются
 * в старом ключе `sportsdesk.view.atmosphere`. Выключение ничего не удаляет:
 * записи дневника, схемы и прогнозы остаются в профиле.
 */

export const MODULES_KEY = 'sportsdesk.modules';
export const MODULES_VERSION = 1;
export const MODULES_CHANGED_EVENT = 'sportsdesk-modules-changed';

/** Старый общий выключатель «Игры и атмосфера»: только для чтения при переходе. */
const LEGACY_ATMOSPHERE_KEY = 'sportsdesk.view.atmosphere';

export type CoreModuleId =
  'home' | 'watch' | 'europe' | 'predictions' | 'games' | 'atmosphere' | 'diary' | 'tactics';
type LeagueId = (typeof LEAGUES)[number]['id'];
export type LeagueModuleId = `league.${LeagueId}`;
export type ModuleId = CoreModuleId | LeagueModuleId;
export type ModulesState = Record<ModuleId, boolean>;

export interface CoreModuleDefinition {
  id: CoreModuleId;
  label: string;
  /** Что исчезает при выключении — одна короткая фраза. */
  description: string;
}

export const CORE_MODULES: readonly CoreModuleDefinition[] = [
  {
    id: 'home',
    label: 'Главное',
    description: '',
  },
  {
    id: 'watch',
    label: 'Просмотр',
    description: 'Раздел «Смотреть» и кнопки',
  },
  {
    id: 'europe',
    label: 'Еврокубки и сборные',
    description: '',
  },
  {
    id: 'predictions',
    label: 'Прогнозы',
    description: '«Мой прогноз», «Угадай счёт»',
  },
  {
    id: 'games',
    label: 'Игры',
    description: '«Стартовые огни» и мини-игры',
  },
  {
    id: 'atmosphere',
    label: 'Атмосфера',
    description: 'Конфетти, радио, фоновый звук',
  },
  {
    id: 'diary',
    label: 'Дневник',
    description: 'Отметка «Просмотрено»',
  },
  {
    id: 'tactics',
    label: 'Тактическая доска',
    description: 'Схемы, «На доску»',
  },
];

export function leagueModuleId(leagueId: string): LeagueModuleId {
  return `league.${leagueId}` as LeagueModuleId;
}

export interface LeagueModuleDefinition {
  id: LeagueModuleId;
  leagueId: LeagueId;
  label: string;
}

export const LEAGUE_MODULES: readonly LeagueModuleDefinition[] = LEAGUES.map((league) => ({
  id: leagueModuleId(league.id),
  leagueId: league.id,
  label: league.label,
}));

const leagueDefaults = Object.fromEntries(
  LEAGUE_MODULES.map((module) => [module.id, true]),
) as Record<LeagueModuleId, boolean>;

export const DEFAULT_MODULES: ModulesState = {
  home: true,
  watch: true,
  europe: true,
  predictions: true,
  games: true,
  atmosphere: true,
  diary: true,
  tactics: true,
  ...leagueDefaults,
};

export function isModuleId(value: unknown): value is ModuleId {
  return (
    typeof value === 'string' &&
    (CORE_MODULES.some((module) => module.id === value) ||
      LEAGUE_MODULES.some((module) => module.id === value))
  );
}

/**
 * Разбирает сохранённое значение. null — значение не похоже на выключатели:
 * вызывающий код берёт значения по умолчанию. Неизвестные id пропускаются.
 */
export function parseModules(value: unknown): ModulesState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 1)
    return null;
  if (!raw.modules || typeof raw.modules !== 'object' || Array.isArray(raw.modules)) return null;
  const result: ModulesState = { ...DEFAULT_MODULES };
  for (const [id, enabled] of Object.entries(raw.modules as Record<string, unknown>)) {
    if (!isModuleId(id)) continue;
    if (typeof enabled !== 'boolean') return null;
    result[id] = enabled;
  }
  return result;
}

export function isValidModulesValue(value: string): boolean {
  try {
    return parseModules(JSON.parse(value)) !== null;
  } catch {
    return false;
  }
}

/** Старый выключатель: null — ключа нет или он повреждён. */
function legacyCombinedEnabled(): boolean | null {
  const raw = getString(LEGACY_ATMOSPHERE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    return parsed && typeof parsed.enabled === 'boolean' ? parsed.enabled : null;
  } catch {
    return null;
  }
}

let cachedRaw: string | null | undefined;
let cachedValue: ModulesState = DEFAULT_MODULES;

export function readModules(): ModulesState {
  const raw = getString(MODULES_KEY);
  const legacy = getString(LEGACY_ATMOSPHERE_KEY);
  const cacheKey = `${raw === null ? 'absent' : 'present'}\u0000${raw ?? ''}\u0000${legacy ?? ''}`;
  if (cacheKey === cachedRaw) return cachedValue;
  cachedRaw = cacheKey;
  let parsed: ModulesState | null = null;
  if (raw) {
    try {
      parsed = parseModules(JSON.parse(raw));
    } catch {
      parsed = null;
    }
  }
  if (parsed) {
    cachedValue = parsed;
    return cachedValue;
  }
  cachedValue = { ...DEFAULT_MODULES };
  // Переход со старой версии: общего выключателя больше нет, но если его
  // выключали, игры и атмосфера остаются выключенными. Звуковые настройки
  // берутся из старого ключа без изменений.
  if (raw === null && legacyCombinedEnabled() === false) {
    cachedValue.games = false;
    cachedValue.atmosphere = false;
  }
  return cachedValue;
}

export function writeModules(patch: Partial<Record<ModuleId, boolean>>): ModulesState {
  const next = { ...readModules() };
  for (const [id, enabled] of Object.entries(patch)) {
    if (isModuleId(id) && typeof enabled === 'boolean') next[id] = enabled;
  }
  setJson(MODULES_KEY, { version: MODULES_VERSION, modules: next });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MODULES_CHANGED_EVENT));
  return readModules();
}

export function setModule(id: ModuleId, enabled: boolean): ModulesState {
  return writeModules({ [id]: enabled });
}

export function isModuleOn(id: ModuleId): boolean {
  return readModules()[id];
}

export function subscribeModules(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const events = [MODULES_CHANGED_EVENT, 'sportsdesk-storage-changed', 'storage'];
  for (const event of events) window.addEventListener(event, callback);
  return () => {
    for (const event of events) window.removeEventListener(event, callback);
  };
}

export function useModules(): ModulesState {
  return useSyncExternalStore(subscribeModules, readModules, () => DEFAULT_MODULES);
}

/**
 * Виден ли турнир. Еврокубки и сборные скрываются одним выключателем, каждая
 * лига — своим. Неизвестный id не скрывается: чужие данные не прячем.
 */
export function isCompetitionVisible(competitionId: string): boolean {
  return isCompetitionVisibleWith(competitionId, readModules());
}

/** Same rule against a snapshot, for lists that already subscribe to modules. */
export function isCompetitionVisibleWith(competitionId: string, modules: ModulesState): boolean {
  const league = LEAGUES.find((item) => item.id === competitionId);
  if (league) return modules[leagueModuleId(league.id)];
  if (CUP_COMPETITIONS.some((item) => item.id === competitionId)) return modules.europe;
  return true;
}
