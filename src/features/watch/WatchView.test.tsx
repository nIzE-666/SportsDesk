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
