import { useLayoutEffect } from 'react';
import { viewState } from './viewState';

/** Restore after async content grows; stop restoring as soon as the user scrolls. */
export function usePageScroll(page: string) {
  useLayoutEffect(() => {
    const element = document.querySelector<HTMLElement>('main.content');
    if (!element) return;
    const key = `scroll.${page}`;
    const target = viewState.read(
      key,
      0,
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    );
    let restoring = target > 0,
      latest = target,
      frame = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      restoring = false;
      observer?.disconnect();
      if (timer) clearTimeout(timer);
    };
    const attempt = () => {
      if (!restoring) return;
      element.scrollTop = Math.min(
        target,
        Math.max(0, element.scrollHeight - element.clientHeight),
      );
      if (Math.abs(element.scrollTop - target) < 1) stop();
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(attempt);
          });
    element.scrollTop = 0;
    if (restoring) {
      observer?.observe(element.firstElementChild ?? element);
      frame = requestAnimationFrame(attempt);
      timer = setTimeout(stop, 10000);
    }
    const save = () => {
      if (!restoring) {
        latest = element.scrollTop;
        viewState.write(key, latest);
      }
    };
    const userIntent = () => {
      stop();
      save();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key))
        userIntent();
    };
    element.addEventListener('scroll', save, { passive: true });
    element.addEventListener('wheel', userIntent, { passive: true });
    element.addEventListener('touchstart', userIntent, { passive: true });
    element.addEventListener('pointerdown', userIntent, { passive: true });
    element.addEventListener('keydown', keyboard);
    return () => {
      // Content may already have shrunk during React's DOM commit.
      viewState.write(key, restoring ? target : latest);
      stop();
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', save);
      element.removeEventListener('wheel', userIntent);
      element.removeEventListener('touchstart', userIntent);
      element.removeEventListener('pointerdown', userIntent);
      element.removeEventListener('keydown', keyboard);
    };
  }, [page]);
}
