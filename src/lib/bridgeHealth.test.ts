import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, rpc } from './bridge';
import { __resetForTest, getHealthSnapshot } from './resourceHealth';

beforeEach(() => {
  vi.useFakeTimers();
  __resetForTest();
});
afterEach(() => {
  __resetForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('data transport health boundary', () => {
  it('never retries a failed RPC command', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    await expect(rpc('kino_start_auth')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(getHealthSnapshot().failures).toEqual([]);
  });
  it('automatically replaces stale data and clears only its own failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            payload: [],
            source: 'pitch',
            fetchedAt: '2026-10-20T00:00:00Z',
            stale: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            payload: [],
            source: 'pitch',
            fetchedAt: '2026-10-21T00:00:00Z',
            stale: false,
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    expect((await api('pitch', 'leagues')).stale).toBe(true);
    expect(getHealthSnapshot().failures[0]?.fetchedAt).toBe('2026-10-20T00:00:00Z');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getHealthSnapshot().failures).toEqual([]);
  });
  it('preserves structured permanent API errors instead of converting them to a retryable string', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'MissingKey', message: 'Configure key', retryable: false },
        }),
        { status: 502 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(api('pitch', 'leagues')).rejects.toMatchObject({
      code: 'MissingKey',
      message: 'Configure key',
      retryable: false,
    });
    await vi.advanceTimersByTimeAsync(600000);
    await expect(api('pitch', 'leagues', { automatic: true })).rejects.toMatchObject({
      code: 'MissingKey',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
