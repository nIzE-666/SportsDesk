import type { AmbientKind } from './atmosphereStore';

/**
 * Фоновые звуки синтезируются прямо в приложении из шума и тонов Web Audio.
 * Готовых записей, сторонних файлов и лицензий нет: происхождение звука — этот
 * код. Голос стартует с нулевой громкостью, плавное включение, выключение и
 * переключение делает ambientEngine.
 */

export interface AmbientVoice {
  /** Выход голоса: подключается к общей шине фона, начинает с нулевой громкости. */
  output: GainNode;
  /** Останавливает источники и таймеры. Безопасно вызывать повторно. */
  dispose: () => void;
}

export type Random = () => number;
type NoiseColor = 'white' | 'pink' | 'brown';
type Timer = ReturnType<typeof setTimeout>;

const NOISE_SECONDS = 4;
const LOOP_FADE_SECONDS = 0.25;

function fillNoise(target: Float32Array, color: NoiseColor, random: Random): void {
  let last = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < target.length; i++) {
    const white = random() * 2 - 1;
    let value = white;
    if (color === 'pink') {
      // Фильтр Пола Келле для розового шума.
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      value = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    } else if (color === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      value = last * 3.5;
    }
    target[i] = Math.max(-1, Math.min(1, value));
  }
}

/** Шумовой буфер без щелчка на стыке петли: хвост плавно переходит в начало. */
export function createNoiseBuffer(
  ctx: BaseAudioContext,
  color: NoiseColor,
  random: Random = Math.random,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.round(rate * NOISE_SECONDS);
  const fade = Math.round(rate * LOOP_FADE_SECONDS);
  const raw = new Float32Array(length + fade);
  fillNoise(raw, color, random);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  data.set(raw.subarray(0, length));
  // Равная мощность: громкость в зоне стыка не проваливается.
  for (let i = 0; i < fade; i++) {
    const weight = i / fade;
    const mixed =
      (raw[i] ?? 0) * Math.sqrt(weight) + (raw[length + i] ?? 0) * Math.sqrt(1 - weight);
    data[i] = Math.max(-1, Math.min(1, mixed));
  }
  return buffer;
}

const noiseCache = new WeakMap<BaseAudioContext, Partial<Record<NoiseColor, AudioBuffer>>>();

function noise(ctx: BaseAudioContext, color: NoiseColor, random: Random): AudioBuffer {
  let byColor = noiseCache.get(ctx);
  if (!byColor) {
    byColor = {};
    noiseCache.set(ctx, byColor);
  }
  return (byColor[color] ??= createNoiseBuffer(ctx, color, random));
}

/** Небольшой помощник сборки графа: помнит источники и таймеры для остановки. */
class VoiceGraph {
  readonly output: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly timers = new Set<Timer>();
  private disposed = false;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly random: Random,
  ) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;
  }

  gain(value: number): GainNode {
    const node = this.ctx.createGain();
    node.gain.value = value;
    return node;
  }

  filter(type: BiquadFilterType, frequency: number, q = 1, gain = 0): BiquadFilterNode {
    const node = this.ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    node.gain.value = gain;
    return node;
  }

  oscillator(type: OscillatorType, frequency: number): OscillatorNode {
    const node = this.ctx.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.start();
    this.sources.push(node);
    return node;
  }

  /** Зацикленный шум; смещение старта делает слои непохожими друг на друга. */
  loop(buffer: AudioBuffer, offsetSeconds = 0): AudioBufferSourceNode {
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.start(0, offsetSeconds);
    this.sources.push(node);
    return node;
  }

  /** Медленная модуляция параметра синусом: depth добавляется к значению параметра. */
  lfo(target: AudioParam, hz: number, depth: number): void {
    const wave = this.oscillator('sine', hz);
    const amount = this.gain(depth);
    wave.connect(amount);
    amount.connect(target);
  }

  chain(...nodes: AudioNode[]): void {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i]?.connect(nodes[i + 1] as AudioNode);
  }

  after(ms: number, action: () => void): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed) action();
    }, ms);
    this.timers.add(timer);
  }

  /** Повторяет действие через случайные промежутки, пока голос жив. */
  every(minMs: number, maxMs: number, action: () => void): void {
    const next = () =>
      this.after(minMs + this.random() * (maxMs - minMs), () => {
        action();
        next();
      });
    next();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Источник уже остановлен.
      }
      source.disconnect();
    }
    this.output.disconnect();
  }
}

/** Стадион: гул трибун, низкий фон чаши и редкие волны эмоций. */
function buildStadium(g: VoiceGraph): void {
  const pink = noise(g.ctx, 'pink', g.random);
  const brown = noise(g.ctx, 'brown', g.random);
  const murmur = g.gain(0.34);
  g.chain(
    g.loop(pink),
    g.filter('highpass', 160),
    g.filter('lowpass', 2400),
    g.filter('peaking', 750, 0.8, 5),
    murmur,
    g.output,
  );
  g.lfo(murmur.gain, 0.11, 0.09);
  g.lfo(murmur.gain, 0.37, 0.05);
  g.chain(
    g.loop(brown, g.random() * NOISE_SECONDS),
    g.filter('lowpass', 180),
    g.gain(0.3),
    g.output,
  );
  const swell = g.gain(0);
  g.chain(
    g.loop(pink, g.random() * NOISE_SECONDS),
    g.filter('bandpass', 1100, 0.6),
    swell,
    g.output,
  );
  g.every(6000, 15000, () => {
    const t = g.ctx.currentTime;
    const peak = 0.16 + g.random() * 0.14;
    swell.gain.cancelScheduledValues(t);
    swell.gain.setValueAtTime(swell.gain.value, t);
    swell.gain.linearRampToValueAtTime(peak, t + 1.1 + g.random());
    swell.gain.linearRampToValueAtTime(0, t + 3.6 + g.random() * 1.5);
  });
}

/** Двигатель: ровный гул с «дыханием» оборотов и редкими проездами мимо. */
function buildEngine(g: VoiceGraph): void {
  const pitch = 140 + g.random() * 25;
  const layers = [
    { osc: g.oscillator('sawtooth', pitch), ratio: 1, level: 0.34 },
    { osc: g.oscillator('sawtooth', pitch * 2.006), ratio: 2.006, level: 0.14 },
    { osc: g.oscillator('square', pitch * 0.5), ratio: 0.5, level: 0.18 },
  ];
  const mix = g.gain(1);
  for (const layer of layers) {
    const send = g.gain(layer.level);
    g.chain(layer.osc, send, mix);
  }
  const body = g.gain(0.55);
  g.chain(mix, g.filter('lowpass', 1050, 1.1), g.filter('highpass', 70), body, g.output);
  // Лёгкая «грубость» мотора: быстрая слабая модуляция громкости.
  g.lfo(body.gain, 23, 0.04);
  // Тихое шипение турбины.
  g.chain(
    g.loop(noise(g.ctx, 'white', g.random)),
    g.filter('bandpass', 3200, 0.5),
    g.gain(0.025),
    g.output,
  );
  const setPitch = (hz: number, timeConstant: number) => {
    const t = g.ctx.currentTime;
    for (const layer of layers)
      layer.osc.frequency.setTargetAtTime(hz * layer.ratio, t, timeConstant);
  };
  g.every(3000, 7000, () => setPitch(pitch * (0.88 + g.random() * 0.5), 1.1));
  g.every(8000, 16000, () => {
    const t = g.ctx.currentTime;
    setPitch(pitch * 1.35, 0.5);
    body.gain.cancelScheduledValues(t);
    body.gain.setValueAtTime(body.gain.value, t);
    body.gain.linearRampToValueAtTime(0.85, t + 1.4);
    body.gain.linearRampToValueAtTime(0.55, t + 3.8);
    g.after(1800, () => setPitch(pitch, 0.7));
  });
}

export function createAmbientVoice(
  ctx: BaseAudioContext,
  kind: AmbientKind,
  random: Random = Math.random,
): AmbientVoice {
  const graph = new VoiceGraph(ctx, random);
  try {
    if (kind === 'engine') buildEngine(graph);
    else buildStadium(graph);
  } catch (error) {
    graph.dispose();
    throw error;
  }
  return { output: graph.output, dispose: () => graph.dispose() };
}
