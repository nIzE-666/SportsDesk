import { readAtmosphere, soundsAllowed } from './atmosphereStore';

/**
 * Единый звуковой движок блока атмосферы. Звуки синтезируются, файлов нет.
 * Ничего не звучит, пока пользователь сам не включил звуки в настройках.
 */
let ctx: AudioContext | null = null;
let lastSignalAt = 0;
const SIGNAL_GAP_MS = 1500;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  ctx ??= new window.AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Короткий нейтральный радиосигнал: два тона. Возвращает true, если прозвучал. */
export function playRadioSignal(now = Date.now()): boolean {
  if (!soundsAllowed() || document.hidden) return false;
  if (now - lastSignalAt < SIGNAL_GAP_MS) return false;
  const ac = audioContext();
  if (!ac) return false;
  lastSignalAt = now;
  const peak = readAtmosphere().volume * 0.25;
  const t = ac.currentTime;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.01);
  gain.gain.setValueAtTime(peak, t + 0.12);
  gain.gain.linearRampToValueAtTime(0, t + 0.16);
  gain.gain.setValueAtTime(0, t + 0.2);
  gain.gain.linearRampToValueAtTime(peak, t + 0.21);
  gain.gain.linearRampToValueAtTime(0, t + 0.3);
  gain.connect(ac.destination);
  const osc = ac.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.setValueAtTime(900, t + 0.2);
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + 0.32);
  return true;
}

/** Остановить всё (видео, выключение звуков, тихие часы). */
export function stopAllSounds(): void {
  if (ctx && ctx.state === 'running') void ctx.suspend();
}
