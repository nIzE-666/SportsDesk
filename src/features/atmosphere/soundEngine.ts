import { getAudioContext } from './audioContext';
import { readAtmosphere, soundsAllowed } from './atmosphereStore';
import { getPlaybackContext } from './playbackContext';
import { isQuietNow } from './quietHours';

/**
 * Короткие сигналы блока атмосферы (рог гола, радио). Звуки синтезируются,
 * файлов нет. Ничего не звучит, пока пользователь сам не включил короткие
 * звуки в настройках. Фон — отдельно, в ambientEngine; общий у них только
 * AudioContext.
 */
let lastSignalAt = 0;
const SIGNAL_GAP_MS = 1500;

export interface SignalOptions {
  now?: number;
  /** Проверка из настроек: действие пользователя, тихие часы и видео не мешают. */
  preview?: boolean;
}

/**
 * Можно ли сейчас проиграть автоматический сигнал: звуки включены, окно
 * видимо, поверх эфира ничего не звучит и не идут тихие часы.
 */
export function shortSignalAllowed(options: SignalOptions = {}): boolean {
  if (!soundsAllowed()) return false;
  if (options.preview) return true;
  const { windowHidden, videoAudible } = getPlaybackContext();
  if (windowHidden || videoAudible) return false;
  return !isQuietNow(options.now);
}

/** Только для тестов. */
export function resetSoundEngineForTests(): void {
  lastSignalAt = 0;
}

function signalSlot(options: SignalOptions): number | null {
  const now = options.now ?? Date.now();
  if (!shortSignalAllowed({ ...options, now })) return null;
  if (!options.preview && now - lastSignalAt < SIGNAL_GAP_MS) return null;
  return now;
}

/** Короткий нейтральный радиосигнал: два тона. Возвращает true, если прозвучал. */
export function playRadioSignal(nowOrOptions: number | SignalOptions = Date.now()): boolean {
  const options = typeof nowOrOptions === 'number' ? { now: nowOrOptions } : nowOrOptions;
  const slot = signalSlot(options);
  if (slot === null) return false;
  const ac = getAudioContext();
  if (!ac) return false;
  lastSignalAt = slot;
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
  osc.onended = () => gain.disconnect();
  return true;
}

/** Рог стадиона: короткий и длинный гудок мажорным аккордом. */
export function playGoalHorn(options: SignalOptions = {}): boolean {
  const slot = signalSlot(options);
  if (slot === null) return false;
  const ac = getAudioContext();
  if (!ac) return false;
  lastSignalAt = slot;
  const peak = readAtmosphere().volume * 0.12;
  const t0 = ac.currentTime + 0.02;
  const tone = ac.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2200;
  tone.connect(ac.destination);
  const blast = (start: number, length: number): OscillatorNode[] => {
    const envelope = ac.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + 0.05);
    envelope.gain.setValueAtTime(peak, start + length - 0.12);
    envelope.gain.linearRampToValueAtTime(0, start + length);
    envelope.connect(tone);
    return [311.13, 392, 466.16].map((hz) => {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(hz * 0.96, start);
      osc.frequency.linearRampToValueAtTime(hz, start + 0.08);
      osc.connect(envelope);
      osc.start(start);
      osc.stop(start + length + 0.02);
      return osc;
    });
  };
  blast(t0, 0.28);
  const last = blast(t0 + 0.4, 1);
  const finale = last[last.length - 1];
  if (finale) finale.onended = () => tone.disconnect();
  return true;
}
