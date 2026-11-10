import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { sourceLabels } from '../../lib/sourceLabels';
import { formatUpdatedAt, getUserTimezone } from '../football/storage';

interface SourceEntry {
  source: string;
  fetchedAt: string | null;
  stale: boolean;
  refreshing: boolean;
  refresh: (() => void) | null;
}
interface SourceRegistry {
  entries: Record<string, SourceEntry>;
  put: (id: string, entry: SourceEntry) => void;
  remove: (id: string) => void;
}
const Context = createContext<SourceRegistry | null>(null);
export function useSourceSummaryAvailable() {
  return useContext(Context) !== null;
}

export function SourceSummaryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, SourceEntry>>({});
  const put = useCallback(
    (id: string, entry: SourceEntry) => setEntries((old) => ({ ...old, [id]: entry })),
    [],
  );
  const remove = useCallback(
    (id: string) =>
      setEntries((old) => {
        if (!old[id]) return old;
        const next = { ...old };
        delete next[id];
        return next;
      }),
    [],
  );
  const value = useMemo(() => ({ entries, put, remove }), [entries, put, remove]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSourceRegistration(props: {
  source: string;
  fetchedAt: string | null;
  stale: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const registry = useContext(Context);
  const id = useId();
  const latest = useRef(props.onRefresh);
  latest.current = props.onRefresh;
  const put = registry?.put;
  const remove = registry?.remove;
  const hasRefresh = !!props.onRefresh;
  useEffect(() => {
    if (!put || !remove) return;
    put(id, {
      source: props.source,
      fetchedAt: props.fetchedAt,
      stale: props.stale,
      refreshing: !!props.refreshing,
      refresh: hasRefresh ? () => latest.current?.() : null,
    });
    return () => remove(id);
  }, [put, remove, id, props.source, props.fetchedAt, props.stale, props.refreshing, hasRefresh]);
  return !!registry;
}

export function SourceRefresh() {
  const entries = Object.values(useContext(Context)?.entries ?? {});
  const refreshable = entries.filter((entry) => entry.refresh);
  if (!refreshable.length) return null;
  const refreshing = refreshable.some((entry) => entry.refreshing);
  return (
    <button
      className="ghost-btn"
      type="button"
      disabled={refreshing}
      onClick={() => refreshable.forEach((entry) => entry.refresh?.())}
    >
      {refreshing ? 'Обновление…' : 'Обновить данные'}
    </button>
  );
}

export function SourceSummary() {
  const entries = Object.values(useContext(Context)?.entries ?? {});
  if (!entries.length) return null;
  const names = sourceLabels(entries.map((entry) => entry.source));
  const times = entries
    .map((entry) => entry.fetchedAt)
    .filter((time): time is string => !!time && Number.isFinite(Date.parse(time)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const oldest = times[0];
  const time =
    oldest && times.length === entries.length ? formatUpdatedAt(oldest, getUserTimezone()) : null;
  return (
    <div className="f1-sourcebar" role="status" aria-live="polite">
      <span>
        Данные: {names.join(', ')}
        {time ? ` · обновлено не ранее ${time}` : ''}
      </span>
      {entries.some((entry) => entry.stale) && (
        <span className="f1-pill warn">Есть устаревшие данные</span>
      )}
    </div>
  );
}
