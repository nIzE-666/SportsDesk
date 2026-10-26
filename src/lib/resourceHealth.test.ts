import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resourceKey,
  getHealthSnapshot,
  subscribeHealth,
  retryFailedResources,
  recordFreshSuccess,
  recordStale,
  recordFailure,
  registerRetry,
  requestResource,
  __resetForTest,
  retainResource,
  setActiveSources,
} from './resourceHealth';
import { ApiError } from './apiError';

describe('resourceHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetForTest();
  });
  afterEach(() => {
    __resetForTest();
    vi.useRealTimers();
  });

  it('resourceKey formats as source:path', () => {
    expect(resourceKey('pitch', 'leagues')).toBe('pitch:leagues');
  });

  it('unrelated fresh success does not clear another resource failure', () => {
    recordStale('pitch', 'a', '2026-01-01T00:00:00Z');
    recordFreshSuccess('pitch', 'b', '2026-01-01T00:01:00Z');
    const snap = getHealthSnapshot();
    expect(snap.failures.map((f) => f.key)).toEqual(['pitch:a']);
    expect(snap.lastFetchedAt).toBe('2026-01-01T00:01:00Z');
  });

  it('retains last fetchedAt on failure', () => {
    recordStale('espn', 'x', '2026-02-02T10:00:00Z');
    recordFailure('espn', 'x');
    const snap = getHealthSnapshot();
    expect(snap.failures[0]).toEqual({ key: 'espn:x', fetchedAt: '2026-02-02T10:00:00Z' });
  });

  it('failure with no prior success has null fetchedAt', () => {
    recordFailure('jolpica', 'standings');
    expect(getHealthSnapshot().failures[0]).toEqual({ key: 'jolpica:standings', fetchedAt: null });
  });

  it('emits recovery event once on failed -> fresh transition, not on first success', () => {
    const seen: string[] = [];
    const w = globalThis as any;
    w.window = w.window ?? {};
    w.window.addEventListener = (type: string, fn: any) => {
      if (type === 'sportsdesk-data-recovered') w.__handler = fn;
    };
    w.window.dispatchEvent = (ev: any) => {
      seen.push(ev.type + ':' + (ev.detail && ev.detail.key));
      return true;
    };
    w.CustomEvent = class {
      type: string;
      detail: any;
      constructor(type: string, init?: any) {
        this.type = type;
        this.detail = init && init.detail;
      }
    };

    // First initial success: no recovery event.
    recordFreshSuccess('pitch', 'first', '2026-03-01T00:00:00Z');
    expect(seen).toHaveLength(0);

    // Failure then recovery: exactly one event.
    recordFailure('pitch', 'second');
    recordFreshSuccess('pitch', 'second', '2026-03-01T00:05:00Z');
    expect(seen).toEqual(['sportsdesk-data-recovered:pitch:second']);

    // Second recovery for same key after another failure: one more event.
    recordFailure('pitch', 'second');
    recordFreshSuccess('pitch', 'second', '2026-03-01T00:10:00Z');
    expect(seen).toHaveLength(2);

    delete (globalThis as any).window;
    delete (globalThis as any).CustomEvent;
  });

  it('snapshot identity is stable until actual state change', () => {
    const a = getHealthSnapshot();
    expect(getHealthSnapshot()).toBe(a);
    recordFailure('openf1', 'laps');
    const b = getHealthSnapshot();
    expect(b).not.toBe(a);
    expect(getHealthSnapshot()).toBe(b);
  });

  it('subscribe/unsubscribe works', () => {
    let calls = 0;
    const un = subscribeHealth(() => {
      calls += 1;
    });
    recordFailure('sportscore', 'live');
    expect(calls).toBe(1);
    un();
    recordFreshSuccess('sportscore', 'live', '2026-04-01T00:00:00Z');
    expect(calls).toBe(1);
  });

  it('bounded backoff retries with no concurrent duplicates and recovers', async () => {
    let calls = 0;
    const retry = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('still down');
      return { fetchedAt: '2026-05-01T00:00:10Z', stale: false };
    });
    recordFailure('pitch', 'flaky');
    registerRetry('pitch', 'flaky', retry);

    // First scheduled retry at 5s.
    await vi.advanceTimersByTimeAsync(5000);
    expect(retry).toHaveBeenCalledTimes(1);
    // Immediately trigger manual retry while first attempt already settled (not in flight).
    retryFailedResources();
    await vi.advanceTimersByTimeAsync(0);
    expect(retry).toHaveBeenCalledTimes(2);
    // No overlap: attempts are serialized per resource via inFlight guard.
    await vi.advanceTimersByTimeAsync(20000);
    expect(retry).toHaveBeenCalledTimes(3);
    expect(getHealthSnapshot().failures).toHaveLength(0);
    // After recovery, no further retries scheduled.
    await vi.advanceTimersByTimeAsync(60000);
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it('backoff follows 5,10,20,40,60s and stops after five automatic attempts', async () => {
    const retry = vi.fn(async () => {
      throw new Error('down');
    });
    recordFailure('espn', 'slow');
    registerRetry('espn', 'slow', retry);

    await vi.advanceTimersByTimeAsync(5000);
    expect(retry).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(retry).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(retry).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(40000);
    expect(retry).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60000);
    expect(retry).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60000);
    expect(retry).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(600000);
    expect(retry).toHaveBeenCalledTimes(5);
  });

  it.each([
    'MissingKey',
    'KeyUnreadable',
    'Unauthorized',
    'InvalidPath',
    'BadPayload',
    'NotFound',
    'TooLarge',
  ] as const)('never automatically retries permanent %s errors', async (code) => {
    const call = vi.fn(async () => {
      throw new ApiError(code);
    });
    registerRetry('pitch', code, call);
    await expect(requestResource('pitch', code, call)).rejects.toThrow();
    retryFailedResources({ manual: false });
    await vi.advanceTimersByTimeAsync(600000);
    expect(call).toHaveBeenCalledOnce();
    expect(getHealthSnapshot().autoRetryPending).toBe(false);
  });

  it.each(['Timeout', 'RateLimited', 'Upstream'] as const)(
    'retries transient %s errors',
    async (code) => {
      const call = vi.fn(async () => {
        throw new ApiError(code);
      });
      registerRetry('pitch', code, call);
      await expect(requestResource('pitch', code, call)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5000);
      expect(call).toHaveBeenCalledTimes(2);
    },
  );

  it('does not retry stale cached data when its failure is a permanent key error', async () => {
    const call = vi.fn(async () => ({
      fetchedAt: '2026-01-01T00:00:00Z',
      stale: true,
      failure: { code: 'MissingKey' as const, message: 'Configure key', retryable: false },
    }));
    registerRetry('pitch', 'cached', call);
    await requestResource('pitch', 'cached', call);
    await vi.advanceTimersByTimeAsync(600000);
    expect(call).toHaveBeenCalledOnce();
    expect(getHealthSnapshot().failures[0]?.code).toBe('MissingKey');
  });

  it('stops retrying and removes a closed resource from the banner when its last consumer leaves', async () => {
    const release = retainResource('openf1', 'laps');
    const call = vi.fn(async () => {
      throw new ApiError('Timeout');
    });
    registerRetry('openf1', 'laps', call);
    await expect(requestResource('openf1', 'laps', call)).rejects.toThrow();
    release();
    release();
    await vi.advanceTimersByTimeAsync(120000);
    expect(call).toHaveBeenCalledOnce();
    expect(getHealthSnapshot().failures).toHaveLength(0);
  });

  it('filters background sources out of the banner and automatic retries', async () => {
    const call = vi.fn(async () => {
      throw new ApiError('Upstream');
    });
    registerRetry('openf1', 'laps', call);
    recordFailure('openf1', 'laps');
    setActiveSources(['pitch']);
    await vi.advanceTimersByTimeAsync(120000);
    expect(call).not.toHaveBeenCalled();
    expect(getHealthSnapshot().failures).toHaveLength(0);
    setActiveSources(['openf1']);
    expect(getHealthSnapshot().failures).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledOnce();
  });

  it('at most 3 retry requests per cycle', async () => {
    const mk = () =>
      vi.fn(async () => {
        throw new Error('down');
      });
    const r1 = mk();
    const r2 = mk();
    const r3 = mk();
    const r4 = mk();
    recordFailure('pitch', 'r1');
    recordFailure('pitch', 'r2');
    recordFailure('pitch', 'r3');
    recordFailure('pitch', 'r4');
    registerRetry('pitch', 'r1', r1);
    registerRetry('pitch', 'r2', r2);
    registerRetry('pitch', 'r3', r3);
    registerRetry('pitch', 'r4', r4);

    retryFailedResources();
    await vi.advanceTimersByTimeAsync(0);
    const total =
      r1.mock.calls.length + r2.mock.calls.length + r3.mock.calls.length + r4.mock.calls.length;
    expect(total).toBeLessThanOrEqual(3);
  });

  it('foreground loads and manual retries share a pending request', async () => {
    let resolve!: (reply: { fetchedAt: string; stale: boolean }) => void;
    const call = vi.fn(
      () =>
        new Promise<{ fetchedAt: string; stale: boolean }>((r) => {
          resolve = r;
        }),
    );
    registerRetry('pitch', 'a', call);
    recordFailure('pitch', 'a');
    const foreground = requestResource('pitch', 'a', call);
    retryFailedResources();
    retryFailedResources();
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledTimes(1);
    expect(getHealthSnapshot().retrying).toBe(true);
    resolve({ fetchedAt: '2026-05-01T00:00:10Z', stale: false });
    await foreground;
    expect(getHealthSnapshot().retrying).toBe(false);
    expect(getHealthSnapshot().failures).toHaveLength(0);
  });

  it('later resources are retried even if the first three keep failing', async () => {
    const calls = Array.from({ length: 4 }, () =>
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    calls.forEach((call, i) => {
      registerRetry('pitch', String(i), call);
      recordFailure('pitch', String(i));
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls[3]).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls[3]).toHaveBeenCalledOnce();
  });

  it('publishes a new immutable snapshot when only the timestamp changes', () => {
    recordFreshSuccess('pitch', 'a', '2026-01-01T00:00:00Z');
    const previous = getHealthSnapshot();
    recordFreshSuccess('pitch', 'a', '2026-01-01T00:01:00Z');
    expect(previous.lastFetchedAt).toBe('2026-01-01T00:00:00Z');
    expect(getHealthSnapshot()).not.toBe(previous);
  });
});
