import { useSyncExternalStore } from 'react';
import { isModuleOn } from '../../lib/modules';
import { getString, setJson } from '../football/storage';

/**
 * Настройки атмосферы: празднования, звуки и фон.
 *
 * Сам блок включается выключателем «Атмосфера» в «Настройках → Модули»
 * (`src/lib/modules.ts`). Поле `enabled` осталось от старого общего
 * выключателя «Игры и атмосфера»: оно читается при переходе и сохраняется в
 * резервной копии, но больше не управляет эффектами. Звуки по умолчанию
 * выключены и не включаются сами после обновления.
 */

export const ATMOSPHERE_KEY = 'sportsdesk.view.atmosphere';
export const ATMOSPHERE_VERSION = 1;
export const ATMOSPHERE_CHANGED_EVENT = 'sportsdesk-atmosphere-changed';

export type MotionMode = 'system' | 'reduced' | 'full';
/** Фоновые звуки: стадион и двигатель. */
export type AmbientKind = 'stadium' | 'engine';
/** Какой фон запускать: по виду спорта («auto») или всегда один и тот же. */
export type AmbientChoice = 'auto' | AmbientKind;
/** Что делать с фоном, пока играет видео со звуком. */
export type AmbientVideoPolicy = 'lower' | 'stop';
/** Что делать с фоном, когда окно скрыто в трей или свёрнуто. */
export type AmbientHiddenPolicy = 'stop' | 'keep';

export interface AtmosphereSettings {
  version: number;
  /** Старый общий выключатель; оставлен для чтения прежних профилей. */
  enabled: boolean;
  /** Визуальные празднования: конфетти гола, флаг финиша. */
  celebrations: boolean;
  /** Короткие сигналы: рог стадиона, радио. */
  sounds: boolean;
  /** Фоновый звук стадиона или двигателя: разрешает кнопку «Фон» в верхней панели. */
  ambient: boolean;
  /** Громкость коротких сигналов 0…1. */
  volume: number;
  motion: MotionMode;
  /** Какой фон запускать. */
  ambientKind: AmbientChoice;
  /** Отдельная громкость фона 0…1. */
  ambientVolume: number;
  ambientVideo: AmbientVideoPolicy;
  ambientHidden: AmbientHiddenPolicy;
}

export const DEFAULT_ATMOSPHERE: AtmosphereSettings = {
  version: ATMOSPHERE_VERSION,
  enabled: true,
  celebrations: true,
  sounds: false,
  ambient: false,
  volume: 0.5,
  motion: 'system',
  ambientKind: 'auto',
  ambientVolume: 0.4,
  ambientVideo: 'stop',
  ambientHidden: 'stop',
};

function isMotion(value: unknown): value is MotionMode {
  return value === 'system' || value === 'reduced' || value === 'full';
}

function clampUnit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/** Разбирает сохранённое значение. null — значение не похоже на настройки атмосферы. */
export function parseAtmosphere(value: unknown): AtmosphereSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 1)
    return null;
  const flag = (key: keyof AtmosphereSettings) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : (DEFAULT_ATMOSPHERE[key] as boolean);
  return {
    version: raw.version,
    enabled: flag('enabled'),
    celebrations: flag('celebrations'),
    sounds: flag('sounds'),
    ambient: flag('ambient'),
    volume: clampUnit(raw.volume, DEFAULT_ATMOSPHERE.volume),
    motion: isMotion(raw.motion) ? raw.motion : DEFAULT_ATMOSPHERE.motion,
    // Поля фона появились позже: в старых профилях их нет, берутся значения по умолчанию.
    ambientKind:
      raw.ambientKind === 'auto' || raw.ambientKind === 'stadium' || raw.ambientKind === 'engine'
        ? raw.ambientKind
        : DEFAULT_ATMOSPHERE.ambientKind,
    ambientVolume: clampUnit(raw.ambientVolume, DEFAULT_ATMOSPHERE.ambientVolume),
    ambientVideo:
      raw.ambientVideo === 'lower' || raw.ambientVideo === 'stop'
        ? raw.ambientVideo
        : DEFAULT_ATMOSPHERE.ambientVideo,
    ambientHidden:
      raw.ambientHidden === 'stop' || raw.ambientHidden === 'keep'
        ? raw.ambientHidden
        : DEFAULT_ATMOSPHERE.ambientHidden,
  };
}

export function isValidAtmosphereValue(value: string): boolean {
  try {
    return parseAtmosphere(JSON.parse(value)) !== null;
  } catch {
    return false;
  }
}

let cachedRaw: string | null | undefined;
let cachedValue: AtmosphereSettings = DEFAULT_ATMOSPHERE;

export function readAtmosphere(): AtmosphereSettings {
  const raw = getString(ATMOSPHERE_KEY);
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  let parsed: AtmosphereSettings | null = null;
  if (raw) {
    try {
      parsed = parseAtmosphere(JSON.parse(raw));
    } catch {
      parsed = null;
    }
  }
  cachedValue = parsed ?? DEFAULT_ATMOSPHERE;
  return cachedValue;
}

export function writeAtmosphere(
  patch: Partial<Omit<AtmosphereSettings, 'version'>>,
): AtmosphereSettings {
  const next = parseAtmosphere({ ...readAtmosphere(), ...patch, version: ATMOSPHERE_VERSION });
  setJson(ATMOSPHERE_KEY, next ?? DEFAULT_ATMOSPHERE);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ATMOSPHERE_CHANGED_EVENT));
  return readAtmosphere();
}

export function subscribeAtmosphere(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(ATMOSPHERE_CHANGED_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(ATMOSPHERE_CHANGED_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function useAtmosphere(): AtmosphereSettings {
  return useSyncExternalStore(subscribeAtmosphere, readAtmosphere, () => DEFAULT_ATMOSPHERE);
}

export function systemPrefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** true — нужно спокойное статичное представление без частиц и тряски. */
export function motionReduced(settings: AtmosphereSettings = readAtmosphere()): boolean {
  return (
    settings.motion === 'reduced' || (settings.motion === 'system' && systemPrefersReducedMotion())
  );
}

export function celebrationsAllowed(settings: AtmosphereSettings = readAtmosphere()): boolean {
  return isModuleOn('atmosphere') && settings.celebrations;
}

export function soundsAllowed(settings: AtmosphereSettings = readAtmosphere()): boolean {
  return isModuleOn('atmosphere') && settings.sounds && settings.volume > 0;
}

/** Фон разрешён: кнопка «Фон» доступна, но сам звук включает только пользователь. */
export function ambientAllowed(settings: AtmosphereSettings = readAtmosphere()): boolean {
  return isModuleOn('atmosphere') && settings.ambient && settings.ambientVolume > 0;
}
