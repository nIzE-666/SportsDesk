/**
 * Только для тестов: минимальная подделка Web Audio для jsdom. Считает живые
 * источники звука, чтобы тесты могли проверить «один экземпляр фона» и
 * освобождение ресурсов, и сразу применяет целевые значения параметров.
 */
export class FakeParam {
  value: number;
  readonly events: Array<{ type: string; value: number; time: number }> = [];
  constructor(value = 0) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'linear', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'target', value, time });
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', value: this.value, time });
    return this;
  }
}

class FakeNode {
  connections: unknown[] = [];
  connect<T>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }
  disconnect(): void {
    this.connections = [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  gain = new FakeParam(0);
}

export class FakeSource extends FakeNode {
  type = 'sine';
  frequency = new FakeParam(440);
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(): void {
    if (!this.started) throw new Error('InvalidStateError');
    this.stopped = true;
  }
}

class FakeBuffer {
  private readonly data: Float32Array;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  currentTime = 0;
  /** Малая частота дискретизации: шумовые буферы в тестах создаются мгновенно. */
  sampleRate = 8000;
  destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createOscillator(): FakeSource {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createBufferSource(): FakeSource {
    return this.createOscillator();
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(length, sampleRate);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  liveSources(): number {
    return this.sources.filter((source) => source.started && !source.stopped).length;
  }
}

export function installFakeAudio(): void {
  FakeAudioContext.instances = [];
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  });
}

export function removeFakeAudio(): void {
  FakeAudioContext.instances = [];
  Reflect.deleteProperty(window, 'AudioContext');
}

/** Единственный созданный контекст (или ошибка, если звук не запрашивался). */
export function theFakeContext(): FakeAudioContext {
  const [context] = FakeAudioContext.instances;
  if (!context) throw new Error('AudioContext was never created');
  return context;
}
