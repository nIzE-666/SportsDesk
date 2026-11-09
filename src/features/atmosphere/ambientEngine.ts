import { useSyncExternalStore } from 'react';
import { AMBIENT_LEVEL, decideAmbient, resolveAmbientKind } from './ambientPolicy';
import type { AmbientStopReason } from './ambientPolicy';
import { createAmbientVoice, type AmbientVoice } from './ambientSynth';
import { getAudioContext } from './audioContext';
import { readAtmosphere, subscribeAtmosphere, type AmbientKind } from './atmosphereStore';
import { getPlaybackContext, subscribePlaybackContext } from './playbackContext';

/**
 * Фоновый звук (стадион или двигатель). Один экземпляр на окно: повторный
 * запуск и повторное открытие экрана не создают второй голос. Звук включает
 * только пользователь; выключение, смена звука и приглушение плавные.
 *
 * Фон не связан с ходом матча или гонки: «волны эмоций» случайны, поэтому он не
 * может раскрыть результат.
 */

export interface AmbientState {
  /** Что звучит сейчас; null — тишина. */
  kind: AmbientKind | null;
  /** Фон приглушён, потому что играет видео со звуком. */
  lowered: boolean;
  /** Почему фон не включился или остановился сам; null после ручной остановки. */
  stoppedBy: AmbientStopReason | null;
}

const IDLE: AmbientState = { kind: null, lowered: false, stoppedBy: null };
/** Постоянные времени сглаживания, секунды. */
const FADE_IN = 0.5;
const FADE_OUT = 0.25;
const LEVEL_CHANGE = 0.15;
/** Через сколько голос уходящего фона освобождается (запас на 6 постоянных). */
const RETIRE_MS = 1600;

interface Layer {
  kind: AmbientKind;
  voice: AmbientVoice;
}

type Timer = ReturnType<typeof setTimeout>;

let state: AmbientState = IDLE;
/** Пользователь включил фон и он должен звучать, пока позволяют правила. */
let wanted = false;
let sportHint: string | null = null;
let bus: GainNode | null = null;
let busContext: AudioContext | null = null;
let layer: Layer | null = null;
const retiring = new Map<Layer, Timer>();
let unwatch: (() => void) | null = null;
const listeners = new Set<() => void>();

function setState(next: AmbientState): void {
  if (
    next.kind === state.kind &&
    next.lowered === state.lowered &&
    next.stoppedBy === state.stoppedBy
  )
    return;
  state = next;
  for (const listener of [...listeners]) listener();
}

export function getAmbientState(): AmbientState {
  return state;
}

export function subscribeAmbient(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useAmbientState(): AmbientState {
  return useSyncExternalStore(subscribeAmbient, getAmbientState, () => IDLE);
}

function ramp(param: AudioParam, ac: AudioContext, value: number, timeConstant: number): void {
  const t = ac.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.setTargetAtTime(value, t, timeConstant);
}

function ensureBus(ac: AudioContext): GainNode {
  if (bus && busContext === ac) return bus;
  bus = ac.createGain();
  bus.gain.value = 0;
  bus.connect(ac.destination);
  busContext = ac;
  return bus;
}

function enter(ac: AudioContext, kind: AmbientKind, target: GainNode): Layer {
  const voice = createAmbientVoice(ac, kind);
  voice.output.connect(target);
  ramp(voice.output.gain, ac, 1, FADE_IN);
  return { kind, voice };
}

/** Голос плавно затихает и освобождается; повторный вызов безопасен. */
function retire(old: Layer): void {
  if (retiring.has(old)) return;
  if (busContext) ramp(old.voice.output.gain, busContext, 0, FADE_OUT);
  retiring.set(
    old,
    setTimeout(() => {
      retiring.delete(old);
      old.voice.dispose();
    }, RETIRE_MS),
  );
}

function dropLayer(): void {
  if (!layer) return;
  retire(layer);
  layer = null;
}

function unwatchAll(): void {
  const off = unwatch;
  unwatch = null;
  off?.();
}

/** Фон остановлен правилами, а не пользователем: причина остаётся в состоянии. */
function halt(reason: AmbientStopReason): void {
  wanted = false;
  dropLayer();
  unwatchAll();
  setState({ kind: null, lowered: false, stoppedBy: reason });
}

/** Приводит звук в соответствие с настройками, видео и состоянием окна. */
function sync(): void {
  if (!wanted) return;
  const settings = readAtmosphere();
  const decision = decideAmbient(settings, getPlaybackContext());
  if (!decision.play) return halt(decision.reason);
  const ac = getAudioContext();
  if (!ac) return halt('unsupported');
  const kind = resolveAmbientKind(settings.ambientKind, sportHint);
  try {
    const target = ensureBus(ac);
    if (layer && layer.kind !== kind) dropLayer();
    layer ??= enter(ac, kind, target);
    ramp(target.gain, ac, decision.gain * AMBIENT_LEVEL, LEVEL_CHANGE);
  } catch {
    return halt('unsupported');
  }
  setState({ kind, lowered: decision.lowered, stoppedBy: null });
}

function watch(): void {
  if (unwatch) return;
  const offSettings = subscribeAtmosphere(sync);
  const offContext = subscribePlaybackContext(sync);
  // Закрытие окна или завершение сеанса: фон не должен продолжать звучать.
  const onPageHide = () => hardStop();
  window.addEventListener('pagehide', onPageHide);
  unwatch = () => {
    offSettings();
    offContext();
    window.removeEventListener('pagehide', onPageHide);
  };
}

/** Включает фон. true — звучит; false — правила не позволили (см. stoppedBy). */
export function startAmbient(): boolean {
  wanted = true;
  watch();
  sync();
  return state.kind !== null;
}

/** Плавно выключает фон по просьбе пользователя. */
export function stopAmbient(): void {
  wanted = false;
  dropLayer();
  unwatchAll();
  setState(IDLE);
}

export function toggleAmbient(): boolean {
  if (state.kind) {
    stopAmbient();
    return false;
  }
  return startAmbient();
}

/**
 * Текущий вид спорта для режима «Автоматически». Если фон уже звучит и нужный
 * звук сменился, происходит мягкое переключение.
 */
export function setAmbientSportHint(sport: string | null): void {
  if (sportHint === sport) return;
  sportHint = sport;
  sync();
}

/** Мгновенная остановка при закрытии окна: ждать затухания нельзя. */
function hardStop(): void {
  wanted = false;
  unwatchAll();
  const current = layer;
  layer = null;
  current?.voice.dispose();
  for (const [old, timer] of retiring) {
    clearTimeout(timer);
    old.voice.dispose();
  }
  retiring.clear();
  setState(IDLE);
}

/** Только для тестов: полный сброс. */
export function resetAmbientForTests(): void {
  hardStop();
  bus = null;
  busContext = null;
  sportHint = null;
  state = IDLE;
  listeners.clear();
}
