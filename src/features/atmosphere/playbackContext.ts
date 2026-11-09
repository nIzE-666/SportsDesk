import { isTauriRuntime } from '../../lib/bridge';

/**
 * Что происходит вокруг звука: звучит ли видео трансляции и скрыто ли окно.
 * Фон и короткие сигналы спрашивают это, чтобы не накладываться на звук
 * эфира и не звучать из трея. Подписки на DOM и Tauri создаются только пока
 * есть подписчики.
 */

export interface PlaybackContext {
  videoAudible: boolean;
  windowHidden: boolean;
}

const audibleVideos = new Set<string>();
const listeners = new Set<() => void>();
/** Rust сообщил, что главное окно скрыто в трей или свёрнуто. */
let nativeHidden = false;
let snapshot: PlaybackContext = { videoAudible: false, windowHidden: false };
let detach: (() => void) | null = null;

function compute(): PlaybackContext {
  return {
    videoAudible: audibleVideos.size > 0,
    windowHidden: nativeHidden || (typeof document !== 'undefined' && document.hidden),
  };
}

/** Снимок с устойчивой ссылкой: меняется только вместе со значением. */
export function getPlaybackContext(): PlaybackContext {
  const next = compute();
  if (next.videoAudible !== snapshot.videoAudible || next.windowHidden !== snapshot.windowHidden) {
    snapshot = next;
  }
  return snapshot;
}

function publish(): void {
  const before = snapshot;
  if (getPlaybackContext() !== before) for (const listener of [...listeners]) listener();
}

/** Плеер сообщает, что его видео сейчас звучит (играет, не заглушено, громкость > 0). */
export function reportVideoAudible(id: string, audible: boolean): void {
  if (audible) audibleVideos.add(id);
  else audibleVideos.delete(id);
  publish();
}

function attach(): void {
  if (detach || typeof document === 'undefined') return;
  const onVisibility = () => publish();
  document.addEventListener('visibilitychange', onVisibility);
  let disposed = false;
  let off: (() => void) | undefined;
  if (isTauriRuntime()) {
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ visible?: boolean }>('sportsdesk://window-visibility', (event) => {
          nativeHidden = event.payload?.visible === false;
          publish();
        }),
      )
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch(() => undefined);
  }
  detach = () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibility);
    off?.();
    // Без подписчиков состояние окна не отслеживается: подписка всегда начинается
    // с действия пользователя в видимом окне.
    nativeHidden = false;
  };
}

export function subscribePlaybackContext(callback: () => void): () => void {
  listeners.add(callback);
  attach();
  return () => {
    listeners.delete(callback);
    if (!listeners.size) {
      detach?.();
      detach = null;
    }
  };
}

/** Только для тестов. */
export function resetPlaybackContextForTests(): void {
  audibleVideos.clear();
  listeners.clear();
  detach?.();
  detach = null;
  nativeHidden = false;
  snapshot = { videoAudible: false, windowHidden: false };
}
