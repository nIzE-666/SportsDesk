// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PlayerPane } from './WatchPlayer';

const hls = vi.hoisted(() => ({
  on: new Map<string, (event: string, data: unknown) => void>(),
  loadSource: vi.fn(),
  startLoad: vi.fn(),
  recoverMediaError: vi.fn(),
}));

vi.mock('hls.js', () => ({
  default: class Hls {
    static isSupported = () => true;
    static Events = {
      MANIFEST_PARSED: 'manifest',
      FRAG_BUFFERED: 'buffered',
      LEVEL_SWITCHED: 'level',
      ERROR: 'error',
    };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    on(event: string, callback: (event: string, data: unknown) => void) {
      hls.on.set(event, callback);
    }
    loadSource = hls.loadSource;
    startLoad = hls.startLoad;
    recoverMediaError = hls.recoverMediaError;
    attachMedia() {}
    destroy() {}
  },
}));

it('resets both the sound control and actual playback when a stream reloads', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const canPlay = vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (url: string) => (
    <PlayerPane
      channel={{ id: 1, title: 'Test', url }}
      onOpenSite={() => undefined}
      onOpenSitePage={() => undefined}
    />
  );
  try {
    await act(async () => root.render(render('https://example.test/one.m3u8')));
    const video = host.querySelector('video')!;
    await act(async () => video.dispatchEvent(new Event('canplay')));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Включить звук (M)"]')!.click(),
    );
    expect(video.muted).toBe(false);
    expect(host.querySelector('[aria-label="Выключить звук (M)"]')).not.toBeNull();

    await act(async () => root.render(render('https://example.test/two.m3u8')));
    expect(video.muted).toBe(true);
    expect(host.querySelector('[aria-label="Включить звук (M)"]')).not.toBeNull();
    await act(async () => video.dispatchEvent(new Event('canplay')));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Включить звук (M)"]')!.click(),
    );
    expect(video.muted).toBe(false);

    vi.useFakeTimers();
    for (const delay of [900, 1800]) {
      await act(async () => {
        video.dispatchEvent(new Event('error'));
        await vi.advanceTimersByTimeAsync(delay);
      });
    }
    await act(async () => video.dispatchEvent(new Event('error')));
    const retry = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Повторить'),
    )!;
    await act(async () => retry.click());
    expect(video.muted).toBe(true);
    expect(host.querySelector('[aria-label="Включить звук (M)"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    canPlay.mockRestore();
    pause.mockRestore();
    load.mockRestore();
    play.mockRestore();
    vi.useRealTimers();
  }
});

it('retries the manifest and recovers media without claiming the stream is ready early', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const canPlay = vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PlayerPane
          channel={{ id: 1, title: 'Test', url: 'https://example.test/live.m3u8' }}
          onOpenSite={() => undefined}
          onOpenSitePage={() => undefined}
        />,
      ),
    );
    await act(async () => vi.dynamicImportSettled());
    const error = hls.on.get('error')!;
    const video = host.querySelector('video')!;
    await act(async () => {
      error('error', { fatal: true, type: 'networkError' });
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(hls.loadSource).toHaveBeenCalledTimes(2);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Подключаем поток…');
    await act(async () => hls.on.get('manifest')!('manifest', { levels: [] }));
    expect(host.textContent).toContain('Подключаем поток…');
    await act(async () => video.dispatchEvent(new Event('canplay')));
    expect(host.textContent).not.toContain('Подключаем поток…');

    await act(async () => {
      error('error', { fatal: true, type: 'mediaError' });
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(hls.recoverMediaError).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Подключаем поток…');
    await act(async () => video.dispatchEvent(new Event('playing')));
    expect(host.textContent).not.toContain('Подключаем поток…');

    const toggle = host.querySelector<HTMLButtonElement>('button')!;
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    play.mockClear();
    await act(async () => toggle.dispatchEvent(space));
    expect(space.defaultPrevented).toBe(false);
    expect(play).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    canPlay.mockRestore();
    pause.mockRestore();
    load.mockRestore();
    play.mockRestore();
    vi.useRealTimers();
  }
});
