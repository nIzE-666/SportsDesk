// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { rpc } from '../../lib/bridge';
import { SettingsView } from './SettingsView';

vi.mock('../../lib/bridge', () => ({ rpc: vi.fn(), openExternal: vi.fn(), notify: vi.fn() }));
vi.mock('./Updates', () => ({ UpdatePanel: () => null }));
vi.mock('./NotificationPreferences', () => ({ NotificationPreferences: () => null }));
vi.mock('./BackupPanel', () => ({ BackupPanel: () => null }));
vi.mock('./ShortcutControl', () => ({ ShortcutControl: () => null }));
vi.mock('./DiagnosticsPanel', () => ({ DiagnosticsPanel: () => null }));
vi.mock('../../components/DesignChooser', () => ({ DesignChooser: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label),
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

it('stops the Settings poll and ignores its late authorization response', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.mocked(rpc).mockClear();
  const poll = deferred<{ pending: boolean; authenticated: boolean }>();
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'secret_status') return { kino: false, pitch: false, kinoClient: true };
    if (command === 'kino_begin_auth') return { sessionId: 'settings' };
    if (command === 'kino_start_auth')
      return {
        code: 'code',
        userCode: 'TEST',
        verificationUri: 'https://example.test',
        expiresIn: 30,
        interval: 4,
      };
    if (command === 'kino_poll_auth') return poll.promise;
    return { ok: true };
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SettingsView category="watch" />));
    await act(async () => button(host, 'Войти по коду устройства').click());
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    await act(async () => button(host, 'Остановить ожидание').click());
    await act(async () => poll.resolve({ pending: false, authenticated: true }));
    expect(host.textContent).not.toContain('Kino авторизация подтверждена');
    expect(button(host, 'Войти по коду устройства')).not.toBeNull();
    expect(
      vi
        .mocked(rpc)
        .mock.calls.some(
          ([name, args]) => name === 'kino_cancel_auth' && args?.sessionId === 'settings',
        ),
    ).toBe(true);
    expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'kino_commit_auth')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});

it('cancels an attempt even if the Settings screen unmounts before its ID arrives', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(rpc).mockClear();
  const begin = deferred<{ sessionId: string }>();
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'secret_status') return { kino: false, pitch: false, kinoClient: true };
    if (command === 'kino_begin_auth') return begin.promise;
    return { ok: true };
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SettingsView category="watch" />));
  await act(async () => button(host, 'Войти по коду устройства').click());
  await act(async () => root.unmount());
  await act(async () => begin.resolve({ sessionId: 'late-begin' }));
  expect(
    vi
      .mocked(rpc)
      .mock.calls.some(
        ([name, args]) => name === 'kino_cancel_auth' && args?.sessionId === 'late-begin',
      ),
  ).toBe(true);
  expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'kino_start_auth')).toBe(false);
  host.remove();
});
