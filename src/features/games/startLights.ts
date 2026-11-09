import { useSyncExternalStore } from 'react';
import { getString, setJson } from '../football/storage';

/**
 * «Стартовые огни»: игра на реакцию. Правила и личные рекорды без интерфейса.
 *
 * Это игра, а не измерение реакции пилотов: время включает задержки экрана,
 * мыши или клавиатуры и системы. Сравнивать его стоит только со своими
 * попытками на том же устройстве. Сравнений с настоящими пилотами нет.
 */

export const START_LIGHTS_KEY = 'sportsdesk.view.games.startLights';
export const START_LIGHTS_VERSION = 1;
export const START_LIGHTS_CHANGED_EVENT = 'sportsdesk-start-lights-changed';

export const LIGHT_COUNT = 5;
/** Огни зажигаются по одному с этим шагом, мс. */
export const LIGHT_STEP_MS = 800;
/** После пятого огня они гаснут через случайное время из этого диапазона, мс. */
export const HOLD_MIN_MS = 200;
export const HOLD_MAX_MS = 3000;
/** Реакция быстрее считается угадыванием, а не ответом на сигнал. */
export const MIN_REACTION_MS = 100;
/** Если за это время нет нажатия, попытка заканчивается без времени. */
export const TOO_SLOW_MS = 2000;
/** Пауза после результата, когда нажатия не начинают новую попытку. */
export const RESULT_LOCK_MS = 600;
/** Игровая цель: просто ориентир для самого игрока. */
export const GOAL_MS = 250;
export const MAX_HISTORY = 20;

export type Outcome =
  | { kind: 'time'; ms: number }
  | { kind: 'false-start'; reason: 'early' | 'anticipation' }
  | { kind: 'too-slow' }
  | { kind: 'interrupted' };

/**
 * Нажатие после того, как огни погасли. `lightsOutAt` — момент кадра, в котором
 * огни погасли на экране; null — этот кадр ещё не показан, значит сигнал
 * нельзя было увидеть, и нажатие угадывает.
 */
export function classifyPress(pressAt: number, lightsOutAt: number | null): Outcome {
  if (lightsOutAt === null) return { kind: 'false-start', reason: 'anticipation' };
  const delta = pressAt - lightsOutAt;
  if (delta < MIN_REACTION_MS) return { kind: 'false-start', reason: 'anticipation' };
  if (delta > TOO_SLOW_MS) return { kind: 'too-slow' };
  return { kind: 'time', ms: Math.round(delta) };
}

/** Случайная задержка после пятого огня; random — число из [0, 1). */
export function holdDelay(random: number): number {
  const unit = Math.min(0.999999, Math.max(0, Number.isFinite(random) ? random : 0));
  return Math.round(HOLD_MIN_MS + unit * (HOLD_MAX_MS - HOLD_MIN_MS));
}

export interface Attempt {
  ms: number;
  at: string;
}

export interface StartLightsStats {
  version: number;
  /** Завершённые попытки: с временем, фальстартом или «не успели». Прерванные не считаются. */
  rounds: number;
  falseStarts: number;
  best: Attempt | null;
  /** Последние попытки со временем, новые в конце. */
  history: Attempt[];
}

export const EMPTY_START_LIGHTS: StartLightsStats = {
  version: START_LIGHTS_VERSION,
  rounds: 0,
  falseStarts: 0,
  best: null,
  history: [],
};

function parseAttempt(value: unknown): Attempt | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const ms = raw.ms;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  if (ms < MIN_REACTION_MS || ms > TOO_SLOW_MS) return null;
  if (typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) return null;
  return { ms: Math.round(ms), at: raw.at };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(1_000_000, Math.floor(value))
    : 0;
}

/** Разбирает сохранённое значение. null — значение не похоже на статистику игры. */
export function parseStartLights(value: unknown): StartLightsStats | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 1)
    return null;
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .map(parseAttempt)
    .filter((attempt): attempt is Attempt => attempt !== null)
    .slice(-MAX_HISTORY);
  // Рекорд хранится отдельно от истории (она обрезается), но не может быть хуже неё.
  const candidates = [parseAttempt(raw.best), ...history].filter(
    (attempt): attempt is Attempt => attempt !== null,
  );
  const best = candidates.reduce<Attempt | null>(
    (top, attempt) => (!top || attempt.ms < top.ms ? attempt : top),
    null,
  );
  return {
    version: raw.version,
    rounds: count(raw.rounds),
    falseStarts: count(raw.falseStarts),
    best,
    history,
  };
}

export function isValidStartLightsValue(value: string): boolean {
  try {
    return parseStartLights(JSON.parse(value)) !== null;
  } catch {
    return false;
  }
}

/** Среднее по последним `n` попыткам со временем. */
export function averageOfLast(history: Attempt[], n = 5): number | null {
  const recent = history.slice(-n);
  if (!recent.length) return null;
  return Math.round(recent.reduce((sum, attempt) => sum + attempt.ms, 0) / recent.length);
}

/** Применяет результат попытки к статистике. Прерванная попытка ничего не меняет. */
export function applyOutcome(
  stats: StartLightsStats,
  outcome: Outcome,
  at: string,
): { stats: StartLightsStats; personalBest: boolean } {
  if (outcome.kind === 'interrupted') return { stats, personalBest: false };
  const next: StartLightsStats = {
    ...stats,
    version: START_LIGHTS_VERSION,
    rounds: stats.rounds + 1,
    falseStarts: stats.falseStarts + (outcome.kind === 'false-start' ? 1 : 0),
  };
  let personalBest = false;
  if (outcome.kind === 'time') {
    const attempt: Attempt = { ms: outcome.ms, at };
    next.history = [...stats.history, attempt].slice(-MAX_HISTORY);
    if (!stats.best || attempt.ms < stats.best.ms) {
      next.best = attempt;
      personalBest = true;
    }
  }
  return { stats: next, personalBest };
}

let cachedRaw: string | null | undefined;
let cachedValue: StartLightsStats = EMPTY_START_LIGHTS;

export function readStartLights(): StartLightsStats {
  const raw = getString(START_LIGHTS_KEY);
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  let parsed: StartLightsStats | null = null;
  if (raw) {
    try {
      parsed = parseStartLights(JSON.parse(raw));
    } catch {
      parsed = null;
    }
  }
  cachedValue = parsed ?? EMPTY_START_LIGHTS;
  return cachedValue;
}

function save(stats: StartLightsStats): void {
  setJson(START_LIGHTS_KEY, stats);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(START_LIGHTS_CHANGED_EVENT));
}

/** Записывает результат попытки. personalBest — улучшен рекорд (или это первое время). */
export function recordStartLights(
  outcome: Outcome,
  at: string = new Date().toISOString(),
): { stats: StartLightsStats; personalBest: boolean } {
  const result = applyOutcome(readStartLights(), outcome, at);
  if (result.stats !== readStartLights()) save(result.stats);
  return { stats: readStartLights(), personalBest: result.personalBest };
}

export function resetStartLights(): void {
  save(EMPTY_START_LIGHTS);
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(START_LIGHTS_CHANGED_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(START_LIGHTS_CHANGED_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function useStartLights(): StartLightsStats {
  return useSyncExternalStore(subscribe, readStartLights, () => EMPTY_START_LIGHTS);
}
