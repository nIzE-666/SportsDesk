/**
 * Один общий AudioContext на окно: короткие сигналы и фон используют его
 * вместе, поэтому нет нескольких несогласованных звуковых дорожек.
 * Контекст создаётся лениво — только когда звук действительно понадобился.
 */
let context: AudioContext | null = null;

type AudioContextConstructor = new () => AudioContext;

export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!context) {
    const Constructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (typeof Constructor !== 'function') return null;
    try {
      context = new Constructor();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

/** Только для тестов: забыть созданный контекст. */
export function resetAudioContextForTests(): void {
  context = null;
}
