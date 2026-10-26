// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectivityBanner } from './ConnectivityBanner';
import { __resetForTest, recordFailure, retainResource } from '../lib/resourceHealth';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  __resetForTest();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  __resetForTest();
  vi.restoreAllMocks();
});
it('does not carry an old OpenF1 error into football or settings', async () => {
  const release = retainResource('openf1', 'laps');
  recordFailure('openf1', 'laps');
  await act(async () => root.render(<ConnectivityBanner sources={['pitch']} />));
  expect(host.textContent).toBe('');
  await act(async () => root.render(<ConnectivityBanner sources={['openf1']} />));
  expect(host.textContent).toContain('Часть источников недоступна');
  await act(async () => release());
  expect(host.textContent).toBe('');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await act(async () => {
    root.render(<ConnectivityBanner sources={[]} />);
    window.dispatchEvent(new Event('offline'));
  });
  expect(host.textContent).toBe('');
});
