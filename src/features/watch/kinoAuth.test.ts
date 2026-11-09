import { expect, it, vi } from 'vitest';
import { rpc } from '../../lib/bridge';
import { beginKinoAttempt, cancelKinoAttempt } from './kinoAuth';

vi.mock('../../lib/bridge', () => ({ rpc: vi.fn() }));

it('orders cancellation after an unfinished begin and before the next begin', async () => {
  let resolveBegin!: (value: { sessionId: string }) => void;
  const firstResponse = new Promise<{ sessionId: string }>((resolve) => {
    resolveBegin = resolve;
  });
  let count = 0;
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'kino_begin_auth') return ++count === 1 ? firstResponse : { sessionId: 'two' };
    return { ok: true };
  });
  const first = beginKinoAttempt(() => undefined);
  const cancellation = cancelKinoAttempt(first);
  const second = beginKinoAttempt(() => undefined);
  await vi.waitFor(() => expect(vi.mocked(rpc)).toHaveBeenCalledWith('kino_begin_auth'));
  expect(vi.mocked(rpc).mock.calls.map(([name]) => name)).toEqual(['kino_begin_auth']);
  resolveBegin({ sessionId: 'one' });
  await cancellation;
  expect(await second).toBe('two');
  expect(vi.mocked(rpc).mock.calls.map(([name]) => name)).toEqual([
    'kino_begin_auth',
    'kino_cancel_auth',
    'kino_begin_auth',
  ]);
  expect(vi.mocked(rpc)).toHaveBeenCalledWith('kino_cancel_auth', { sessionId: 'one' });
  await cancelKinoAttempt(second);
});

it('retries a failed cancellation before allowing another begin', async () => {
  vi.mocked(rpc).mockClear();
  let cancellations = 0;
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'kino_begin_auth') return { sessionId: 'retry' };
    if (command === 'kino_cancel_auth' && ++cancellations === 1) throw new Error('bridge failed');
    return { ok: true };
  });
  const first = beginKinoAttempt(() => undefined);
  await first;
  await expect(cancelKinoAttempt(first)).rejects.toThrow('bridge failed');
  const next = beginKinoAttempt(() => undefined);
  await next;
  expect(vi.mocked(rpc).mock.calls.map(([name]) => name)).toEqual([
    'kino_begin_auth',
    'kino_cancel_auth',
    'kino_cancel_auth',
    'kino_begin_auth',
  ]);
  await cancelKinoAttempt(next);
});
