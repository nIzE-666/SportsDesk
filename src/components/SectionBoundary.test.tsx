// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SectionBoundary } from './SectionBoundary';
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it('contains a failed screen while navigation remains usable, then retries locally', async () => {
  let fail = true;
  function Screen() {
    if (fail) throw new Error('private diagnostic');
    return <p>Данные восстановлены</p>;
  }
  await act(async () =>
    root.render(
      <>
        <nav>Футбол · Формула 1</nav>
        <SectionBoundary resetKey="match">
          <Screen />
        </SectionBoundary>
      </>,
    ),
  );
  expect(host.textContent).toContain('Футбол · Формула 1');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('private diagnostic');
  fail = false;
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(host.textContent).toContain('Данные восстановлены');
});
it('clears the failed state when the user opens a different section', async () => {
  function Broken() {
    throw new Error('failed');
    return null;
  }
  await act(async () =>
    root.render(
      <SectionBoundary resetKey="football">
        <Broken />
      </SectionBoundary>,
    ),
  );
  await act(async () =>
    root.render(
      <SectionBoundary resetKey="f1">
        <p>Календарь F1</p>
      </SectionBoundary>,
    ),
  );
  expect(host.textContent).toContain('Календарь F1');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
