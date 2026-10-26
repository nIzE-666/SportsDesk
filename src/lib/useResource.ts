import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ApiReply, type Source } from './bridge';
import { useDataRecovery } from './useDataRecovery';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  fetchedAt: string | null;
  reload: () => void;
}

interface Options {
  enabled?: boolean;
  refreshMs?: number;
}

/**
 * Fetches a provider resource with explicit stale/error state.
 * Avoids the classic setState-after-unmount and out-of-order response races.
 */
export function useResource<T = any>(
  source: Source,
  path: string | null,
  options: Options = {},
): ResourceState<T> {
  const { enabled = true, refreshMs = 0 } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  useDataRecovery((key) => enabled && key === `${source}:${path}`, reload);

  useEffect(() => {
    if (!path || !enabled) return;
    const my = ++seq.current;
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      try {
        const reply: ApiReply = await api(source, path);
        if (cancelled || my !== seq.current) return;
        setData(reply.payload as T);
        setStale(Boolean(reply.stale));
        setFetchedAt(reply.fetchedAt);
        setError(null);
      } catch (err) {
        if (cancelled || my !== seq.current) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить данные.');
        setStale(true);
      } finally {
        if (!cancelled && my === seq.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [source, path, enabled, tick]);

  useEffect(() => {
    if (!refreshMs || !path || !enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, path, enabled]);

  return { data, loading, error, stale, fetchedAt, reload };
}
