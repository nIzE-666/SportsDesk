// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WatchView } from './WatchView';
import { rpc } from '../../lib/bridge';
import { readSearchIndex } from '../../lib/searchIndex';
vi.mock('../../lib/bridge', () => ({ rpc: vi.fn(), openExternal: vi.fn() }));
vi.mock('./WatchPlayer', () => ({
  PlayerPane: ({ channel }: { channel: { title: string } }) => (
    <div data-testid="player">{channel.title}</div>
  ),
}));
it('keeps the event context, remembers a preferred channel, and indexes only public channel labels', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  const channels = [
    { id: 7, title: 'Sky Sports F1', url: 'https://example.test/private-stream-token' },
    { id: 8, title: 'Football 1' },
  ];
  vi.mocked(rpc).mockImplementation(async (command) =>
    command === 'secret_status'
      ? { kino: true, pitch: true }
      : command === 'kino_channels'
        ? channels
        : {},
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <WatchView
          requestedChannelId={7}
          intent={{ sport: 'f1', key: 'f1:1', title: 'Гран-при Мехико' }}
        />,
      ),
    );
    expect(host.querySelector('[aria-label="Просмотр события"]')?.textContent).toContain(
      'Гран-при Мехико',
    );
    expect(host.querySelector('[data-testid=player]')?.textContent).toBe('Sky Sports F1');
    const check = host.querySelector<HTMLInputElement>('.channel-preference input')!;
    await act(async () => check.click());
    expect(JSON.parse(localStorage.getItem('sportsdesk.watch.preferred')!)).toEqual({ f1: 7 });
    expect(readSearchIndex().find((x) => x.key === 'channel:7')?.target).toEqual({
      kind: 'channel',
      id: 7,
    });
    expect(localStorage.getItem('sportsdesk.search.index')).not.toContain('private-stream-token');
    await act(async () => root.render(<WatchView requestedChannelId={8} />));
    expect(host.querySelector('[data-testid=player]')?.textContent).toBe('Football 1');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  }
});
it('keeps a requested channel through device authentication', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  vi.useFakeTimers();
  vi.mocked(rpc).mockImplementation(async (command) =>
    command === 'secret_status'
      ? { kino: false }
      : command === 'kino_begin_auth'
        ? { sessionId: '1' }
        : command === 'kino_start_auth'
          ? {
              code: 'test-device',
              userCode: 'TEST',
              verificationUri: 'https://example.test/activate',
              expiresIn: 300,
              interval: 2,
            }
          : command === 'kino_poll_auth'
            ? { authenticated: true }
            : command === 'kino_channels'
              ? [{ id: 7, title: 'Sky Sports F1' }]
              : {},
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WatchView requestedChannelId={7} />));
    expect(host.querySelector('.watch-root-signed-out')).not.toBeNull();
    const connect = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Подключить устройство'),
    )!;
    await act(async () => connect.click());
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(host.querySelector('[data-testid=player]')?.textContent).toBe('Sky Sports F1');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.useRealTimers();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!result) throw new Error(`Button not found: ${text}`);
  return result;
}

it('ignores a cancelled in-flight poll when a new attempt is already waiting', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.mocked(rpc).mockClear();
  const oldPoll = deferred<{ pending: boolean; authenticated: boolean }>();
  const newPoll = deferred<{ pending: boolean; authenticated: boolean }>();
  let nextId = 0;
  vi.mocked(rpc).mockImplementation(async (command, args) => {
    if (command === 'secret_status') return { kino: false };
    if (command === 'kino_begin_auth') return { sessionId: String(++nextId) };
    if (command === 'kino_start_auth')
      return {
        code: `code-${args?.sessionId}`,
        userCode: `CODE-${args?.sessionId}`,
        verificationUri: 'https://example.test',
        expiresIn: 30,
        interval: 2,
      };
    if (command === 'kino_poll_auth')
      return args?.sessionId === '1' ? oldPoll.promise : newPoll.promise;
    if (command === 'kino_channels') return [{ id: 7, title: 'Sky Sports F1' }];
    return { ok: true };
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WatchView />));
    await act(async () => button(host, 'Подключить устройство').click());
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await act(async () => button(host, 'Отменить').click());
    await act(async () => button(host, 'Подключить устройство').click());
    expect(host.textContent).toContain('CODE-2');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await act(async () => oldPoll.resolve({ pending: false, authenticated: true }));
    expect(host.textContent).toContain('CODE-2');
    expect(
      vi
        .mocked(rpc)
        .mock.calls.some(([name, args]) => name === 'kino_commit_auth' && args?.sessionId === '1'),
    ).toBe(false);
    await act(async () => newPoll.resolve({ pending: false, authenticated: true }));
    expect(
      vi
        .mocked(rpc)
        .mock.calls.some(([name, args]) => name === 'kino_commit_auth' && args?.sessionId === '2'),
    ).toBe(true);
    expect(host.textContent).toContain('Sky Sports F1');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});

it('cancels an expired in-flight poll and never commits its late response', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.mocked(rpc).mockClear();
  const poll = deferred<{ pending: boolean; authenticated: boolean }>();
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'secret_status') return { kino: false };
    if (command === 'kino_begin_auth') return { sessionId: 'expiry' };
    if (command === 'kino_start_auth')
      return {
        code: 'code',
        userCode: 'TEST',
        verificationUri: 'https://example.test',
        expiresIn: 3,
        interval: 2,
      };
    if (command === 'kino_poll_auth') return poll.promise;
    return { ok: true };
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WatchView />));
    await act(async () => button(host, 'Подключить устройство').click());
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(host.textContent).toContain('Срок действия кода истёк');
    await act(async () => poll.resolve({ pending: false, authenticated: true }));
    expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'kino_commit_auth')).toBe(false);
    expect(
      vi
        .mocked(rpc)
        .mock.calls.some(
          ([name, args]) => name === 'kino_cancel_auth' && args?.sessionId === 'expiry',
        ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});

it('cancels a commit in flight when the user stops waiting', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.mocked(rpc).mockClear();
  const commit = deferred<{ ok: boolean }>();
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'secret_status') return { kino: false };
    if (command === 'kino_begin_auth') return { sessionId: 'commit' };
    if (command === 'kino_start_auth')
      return {
        code: 'code',
        userCode: 'TEST',
        verificationUri: 'https://example.test',
        expiresIn: 30,
        interval: 2,
      };
    if (command === 'kino_poll_auth') return { authenticated: true, pending: false };
    if (command === 'kino_commit_auth') return commit.promise;
    return { ok: true };
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WatchView />));
    await act(async () => button(host, 'Подключить устройство').click());
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await act(async () => button(host, 'Отменить').click());
    await act(async () => commit.resolve({ ok: true }));
    expect(host.querySelector('.watch-root-signed-out')).not.toBeNull();
    expect(
      vi
        .mocked(rpc)
        .mock.calls.some(
          ([name, args]) => name === 'kino_cancel_auth' && args?.sessionId === 'commit',
        ),
    ).toBe(true);
    expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'kino_finish_auth')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});
