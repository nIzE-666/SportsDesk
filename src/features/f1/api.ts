import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiReply, Source } from '../../lib/bridge';
import { api } from '../../lib/bridge';
import { useDataRecovery } from '../../lib/useDataRecovery';
import { retainResource } from '../../lib/resourceHealth';

export interface F1Data<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  source: string;
  fetchedAt: string | null;
  stale: boolean;
  reload: () => void;
}

export type F1Source = Extract<Source, 'jolpica' | 'openf1'>;

const KNOWN_SOURCES: readonly F1Source[] = ['jolpica', 'openf1'];

interface UseApiResourceOptions {
  source?: F1Source;
  enabled?: boolean;
}

function resolveSource(value: string | undefined): F1Source {
  return value === 'openf1' ? 'openf1' : 'jolpica';
}

/**
 * Generic Jolpica / OpenF1 resource hook with abort-safe updates and
 * explicit refresh. The first argument is a local cache/resource key used
 * only for component-level bookkeeping; the actual upstream source is
 * passed through `options.source` and defaults to jolpica. Path must be
 * relative (no host/URL).
 */
export function useApiResource<T>(
  resourceKey: string,
  path: string | null,
  transform: (payload: unknown) => T,
  options?: UseApiResourceOptions | F1Source,
): F1Data<T> {
  const optionSource: F1Source | undefined =
    typeof options === 'string' ? options : options?.source;
  const enabled = typeof options === 'object' && options ? options.enabled !== false : true;
  const source: F1Source = resolveSource(optionSource);

  const [data, setData] = useState<T | null>(null);
  const key = `${source}:${path}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path && enabled);
  const [error, setError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string>(source);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);
  useEffect(
    () => (path && enabled ? retainResource(source, path) : undefined),
    [source, path, enabled],
  );

  const reload = useCallback(() => setTick((t) => t + 1), []);
  useDataRecovery((key) => enabled && key === `${source}:${path}`, reload);

  const transformRef = useRef(transform);
  transformRef.current = transform;

  useEffect(() => {
    if (!path || !enabled) {
      setLoading(false);
      setError(null);
      if (!path) {
        setData(null);
        setFetchedAt(null);
        setStale(false);
      }
      return;
    }
    if (!KNOWN_SOURCES.includes(source)) {
      setLoading(false);
      setError('Некорректный источник данных');
      return;
    }
    const id = ++reqId.current;
    setStatusKey(key);
    setLoading(true);
    setError(null);
    let cancelled = false;

    (async () => {
      try {
        const reply: ApiReply = await api(source, path);
        if (cancelled || id !== reqId.current) return;
        const parsed = transformRef.current(reply.payload);
        setData(parsed);
        setLoadedKey(key);
        setSourceName(reply.source || source);
        setFetchedAt(reply.fetchedAt || null);
        setStale(!!reply.stale);
      } catch (e) {
        if (cancelled || id !== reqId.current) return;
        const msg = e instanceof Error ? e.message : 'Не удалось получить данные';
        setError(msg);
        // Keep previous good data visible on failure (stale display).
        setStale(true);
      } finally {
        if (!cancelled && id === reqId.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // resourceKey intentionally not a dependency: it is a local label only.
  }, [source, path, enabled, tick]);

  const matches = loadedKey === key;
  const currentError = statusKey === key ? error : null;
  return {
    data: matches ? data : null,
    loading: loading || !!(path && enabled && !matches && !currentError),
    error: currentError,
    source: matches ? sourceName : source,
    fetchedAt: matches ? fetchedAt : null,
    stale: matches && stale,
    reload,
  };
}

export function extractMRData(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const mr = (payload as Record<string, unknown>).MRData;
  if (!mr || typeof mr !== 'object') return null;
  return mr as Record<string, unknown>;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
