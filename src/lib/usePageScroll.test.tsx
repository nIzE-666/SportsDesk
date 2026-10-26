// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePageScroll } from './usePageScroll';
import { viewState } from './viewState';
let root: ReturnType<typeof createRoot>,
  host: HTMLDivElement,
  main: HTMLElement,
  height: number,
  resize: () => void;
function Screen({ page }: { page: string }) {
  usePageScroll(page);
  return <div>{page}</div>;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  viewState.reset();
  sessionStorage.clear();
  vi.useFakeTimers();
  host = document.createElement('div');
  main = document.createElement('main');
  main.className = 'content';
  main.append(host);
  document.body.append(main);
  root = createRoot(host);
  height = 2400;
  Object.defineProperties(main, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => 600 },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 1));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  main.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('restores list scroll after a detail page, retaining the last position before content shrinks', async () => {
  await act(async () => root.render(<Screen page="matches" />));
  main.scrollTop = 850;
  main.dispatchEvent(new Event('scroll'));
  main.scrollTop = 0;
  await act(async () => root.render(<Screen page="match.1" />));
  expect(main.scrollTop).toBe(0);
  await act(async () => root.render(<Screen page="matches" />));
  await vi.advanceTimersByTimeAsync(2);
  expect(main.scrollTop).toBe(850);
});
it('waits for asynchronous rows and stops if the user starts scrolling', async () => {
  viewState.write('scroll.matches', 900);
  height = 650;
  await act(async () => root.render(<Screen page="matches" />));
  await vi.advanceTimersByTimeAsync(2);
  expect(main.scrollTop).toBe(50);
  height = 2500;
  resize();
  await vi.advanceTimersByTimeAsync(2);
  expect(main.scrollTop).toBe(900);
  await act(async () => root.render(<Screen page="other" />));
  viewState.write('scroll.matches', 900);
  height = 650;
  await act(async () => root.render(<Screen page="matches" />));
  await vi.advanceTimersByTimeAsync(2);
  main.dispatchEvent(new Event('wheel'));
  height = 2500;
  resize();
  await vi.advanceTimersByTimeAsync(2);
  expect(main.scrollTop).toBe(50);
});
