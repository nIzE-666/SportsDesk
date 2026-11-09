import { useSyncExternalStore } from 'react';
import { getString, setJson } from '../football/storage';

/**
 * Общие настройки блока «Игры и атмосфера».
 *
 * Один главный выключатель и отдельные переключатели празднований, звуков и
 * фона. Звуки по умолчанию выключены и не включаются сами после обновления.
 * Значение версионировано и входит в резервную копию профиля.
 */

export const ATMOSPHERE_KEY = 'sportsdesk.view.atmosphere';
export const ATMOSPHERE_VERSION = 1;
export const ATMOSPHERE_CHANGED_EVENT = 'sportsdesk-atmosphere-changed';

export type MotionMode = 'system' | 'reduced' | 'full';

export interface AtmosphereSettings {
  version: number;
  /** Главный выключатель всего блока. */
  enabled: boolean;
  /** Визуальные празднования: конфетти гола, флаг финиша. */
  celebrations: boolean;
  /** Короткие сигналы: рог стадиона, радио. */
  sounds: boolean;
  /** Фоновый звук стадиона или двигателя. */
  ambient: boolean;
  /** Громкость 0…1. */
  volume: number;
  motion: MotionMode;
}

export const DEFAULT_ATMOSPHERE: AtmosphereSettings = {
  version: ATMOSPHERE_VERSION,
  enabled: true,
  celebrations: true,
  sounds: false,
  ambient: false,
  volume: 0.5,
  motion: 'system',
};

function isMotion(value: unknown): value is MotionMode {
  return value === 'system' || value === 'reduced' || value === 'full';
}

/** Разбирает сохранённое значение. null — значение не похоже на настройки атмосферы. */
export function parseAtmosphere(value: unknown): AtmosphereSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 1)
    return null;
  const flag = (key: keyof AtmosphereSettings) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : (DEFAULT_ATMOSPHERE[key] as boolean);
  const volume =
    typeof raw.volume === 'number' && Number.isFinite(raw.volume)
      ? Math.min(1, Math.max(0, raw.volume))
      : DEFAULT_ATMOSPHERE.volume;
  return {
    version: raw.version,
    enabled: flag('enabled'),
    celebrations: flag('celebrations'),
    sounds: flag('sounds'),
    ambient: flag('ambient'),
    volume,
    motion: isMotion(raw.motion) ? raw.motion : DEFAULT_ATMOSPHERE.motion,
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
  return settings.enabled && settings.celebrations;
}

export function soundsAllowed(settings: AtmosphereSettings = readAtmosphere()): boolean {
  return settings.enabled && settings.sounds && settings.volume > 0;
}
