import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import { formatDateTime, getUserTimezone } from '../football/storage';
import type { SportsEvent } from './EventCenter';
import { spoilerSafeBody, useSpoilerSet } from '../spoilers/spoilerStore';

export interface CatchUpSummary {
  from: number;
  to: number;
  truncated: boolean;
  footballIncomplete: boolean;
  f1Incomplete: boolean;
  items: SportsEvent[];
}

const validTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 8.64e15;

/** Проверяет ответ catchup_summary. Некорректная сводка не показывается. */
export function parseCatchUpSummary(value: unknown): CatchUpSummary | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  if (
    !validTime(s.from) ||
    !validTime(s.to) ||
    typeof s.truncated !== 'boolean' ||
    typeof s.footballIncomplete !== 'boolean' ||
    typeof s.f1Incomplete !== 'boolean' ||
    !Array.isArray(s.items)
  )
    return null;
  const items = s.items.filter(
    (e): e is SportsEvent =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as SportsEvent).id === 'string' &&
      ['football', 'f1'].includes((e as SportsEvent).sport) &&
      typeof (e as SportsEvent).title === 'string' &&
      typeof (e as SportsEvent).body === 'string' &&
      validTime((e as SportsEvent).occurredAt),
  );
  if (items.length !== s.items.length) return null;
  return {
    from: s.from,
    to: s.to,
    truncated: s.truncated,
    footballIncomplete: s.footballIncomplete,
    f1Incomplete: s.f1Incomplete,
    items,
  };
}

const when = (ms: number) => formatDateTime(new Date(ms).toISOString(), getUserTimezone());

export function CatchUpPanel({
  refreshKey = 0,
  onOpen,
}: {
  refreshKey?: number;
  onOpen?: (event: SportsEvent) => void;
}) {
  const [summary, setSummary] = useState<CatchUpSummary | null>(null),
    [tick, setTick] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void rpc<unknown>('catchup_summary')
      .then((data) => {
        if (active) setSummary(parseCatchUpSummary(data));
      })
      .catch(() => {
        if (active) setSummary(null);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, tick]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true,
      stop: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const off = await listen('sportsdesk://catchup-changed', () => setTick((n) => n + 1));
        if (active) stop = off;
        else off();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  const spoilers = useSpoilerSet();
  if (!summary || (!summary.items.length && !summary.footballIncomplete && !summary.f1Incomplete))
    return null;
  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await rpc('catchup_dismiss');
      setSummary(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось скрыть сводку.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel catchup-panel" aria-label="Пока вас не было">
      <div className="section-heading">
        <h2>
          <History size={20} /> Пока вас не было
        </h2>
        <button className="ghost-btn" disabled={busy} onClick={() => void dismiss()}>
          Скрыть
        </button>
      </div>
      <p className="muted small">
        {when(summary.from)} — {when(summary.to)}
      </p>
      {summary.truncated && (
        <p className="muted small">Показаны только последние 72 часа отсутствия.</p>
      )}
      {summary.footballIncomplete && (
        <p className="muted small">
          Футбол: часть данных не загрузилась — список может быть неполным. Догрузим при следующей
          проверке.
        </p>
      )}
      {summary.f1Incomplete && (
        <p className="muted small">Формула 1: итоги некоторых сессий ещё недоступны.</p>
      )}
      {error && <p className="muted small">{error}</p>}
      {summary.items.length > 0 && (
        <ul className="catchup-list">
          {summary.items.map((e) => (
            <li key={e.id}>
              <span className="chip">{e.sport === 'f1' ? 'Формула 1' : 'Футбол'}</span>{' '}
              <time dateTime={new Date(e.occurredAt).toISOString()}>{when(e.occurredAt)}</time>
              <div>
                <b>{e.title}</b> · {spoilerSafeBody(spoilers, e)}
              </div>
              {onOpen && (e.matchId || (e.season && e.round)) && (
                <button className="text-link" onClick={() => onOpen(e)}>
                  {e.sport === 'f1' ? 'Открыть уикенд' : 'Открыть матч'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
