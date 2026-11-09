// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PlayerPane } from './WatchPlayer';

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
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Включить звук (M)"]')!.click(),
    );
    expect(video.muted).toBe(false);
    expect(host.querySelector('[aria-label="Выключить звук (M)"]')).not.toBeNull();

    await act(async () => root.render(render('https://example.test/two.m3u8')));
    expect(video.muted).toBe(true);
    expect(host.querySelector('[aria-label="Включить звук (M)"]')).not.toBeNull();
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Включить звук (M)"]')!.click(),
    );
    expect(video.muted).toBe(false);

    await act(async () => {
      video.dispatchEvent(new Event('error'));
      video.dispatchEvent(new Event('error'));
      video.dispatchEvent(new Event('error'));
    });
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
  }
});
