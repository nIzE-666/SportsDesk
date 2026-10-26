// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePollerSync } from './usePoller';
import { rpc } from '../../lib/bridge';
import { setString, STORAGE_KEYS } from './storage';
vi.mock('../../lib/bridge', () => ({
  isTauriRuntime: () => true,
  rpc: vi.fn(async (command: string) => (command === 'get_tray_mode' ? true : { ok: true })),
}));
let host: HTMLDivElement, root: Root;
function Probe() {
  usePollerSync();
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(rpc).mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it('sends one initial config and does not poll localStorage every five seconds', async () => {
  await act(async () => root.render(<Probe />));
  const before = vi.mocked(rpc).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(vi.mocked(rpc).mock.calls.length).toBe(before);
  expect(vi.mocked(rpc).mock.calls.filter(([name]) => name === 'set_poller_config')).toHaveLength(
    1,
  );
});
it('pushes notification changes through storage events and ignores unrelated appearance writes', async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => setString('sportsdesk.scheme', 'light'));
  expect(vi.mocked(rpc).mock.calls.filter(([name]) => name === 'set_poller_config')).toHaveLength(
    1,
  );
  await act(async () => setString(STORAGE_KEYS.notifications, '1'));
  const configs = vi.mocked(rpc).mock.calls.filter(([name]) => name === 'set_poller_config');
  expect(configs).toHaveLength(2);
  expect(configs[1]?.[1]).toMatchObject({ config: { enabled: true } });
});
