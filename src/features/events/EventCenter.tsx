import { useEffect, useState } from 'react';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import { Badge, Button, SegmentedControl } from '../../kit';
import { formatHumanDateTime } from '../../lib/humanDate';
import { getUserTimezone } from '../football/storage';
import { CatchUpPanel } from './CatchUpPanel';
import { spoilerSafeBody, useSpoilerSet } from '../spoilers/spoilerStore';
import { eventFilterChoices, filterEvents, type EventFilter } from './eventFilters';
import { notifyEventsChanged } from './unreadEvents';
const FILTER_LABELS: Record<Exclude<EventFilter, 'unread'>, string> = {
  all: 'Все',
  football: 'Футбол',
  f1: 'Формула 1',
};
export interface SportsEvent {
  id: string;
  sport: 'football' | 'f1';
  kind: string;
  title: string;
  body: string;
  occurredAt: number;
  read: boolean;
  matchId?: string;
  leagueId?: string;
  season?: string;
  round?: string;
}
export function EventCenter({ onOpen }: { onOpen: (event: SportsEvent) => void }) {
  const [events, setEvents] = useState<SportsEvent[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [filter, setFilter] = useState<EventFilter>('all'),
    [tick, setTick] = useState(0),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    setError('');
    void rpc<SportsEvent[]>('event_center_list')
      .then((data) => {
        if (
          !Array.isArray(data) ||
          data.some(
            (e) =>
              !e ||
              typeof e.id !== 'string' ||
              !['football', 'f1'].includes(e.sport) ||
              typeof e.title !== 'string' ||
              typeof e.body !== 'string' ||
              typeof e.read !== 'boolean' ||
              !Number.isFinite(e.occurredAt) ||
              Math.abs(e.occurredAt) > 8.64e15,
          )
        )
          throw new Error('Получен некорректный список событий.');
        if (active)
          setEvents((previous) =>
            data.map((e) =>
              previous.some((p) => p.id === e.id && p.read) ? { ...e, read: true } : e,
            ),
          );
      })
      .catch((e) => {
        if (active) setError(e.message ?? 'Не удалось загрузить события.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tick]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true,
      stop: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const off = await listen('sportsdesk://events-changed', () => setTick((n) => n + 1));
        if (active) stop = off;
        else off();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  const acknowledge = async (ids: string[]) => {
    if (!ids.length || saving) return false;
    setSaving(true);
    try {
      await rpc('event_center_mark_read', { ids });
      setEvents((prev) => prev.map((e) => (ids.includes(e.id) ? { ...e, read: true } : e)));
      notifyEventsChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отметить прочитанное.');
      return false;
    } finally {
      setSaving(false);
    }
  };
  const spoilers = useSpoilerSet();
  const choices = eventFilterChoices(events, filter),
    shown = filterEvents(events, filter),
    unread = events.filter((e) => !e.read);
  return (
    <div className="event-center">
      <div className="section-heading">
        <h2 className="screen-title">
          <Bell size={24} aria-hidden="true" /> Центр событий
        </h2>
        <Button
          small
          variant="quiet"
          icon={<RefreshCw size={15} aria-hidden="true" />}
          onClick={() => setTick((n) => n + 1)}
        >
          Обновить
        </Button>
      </div>
      <p className="muted">События за последние 30 дней, пока приложение запущено.</p>
      <CatchUpPanel
        refreshKey={tick}
        onOpen={(e) => {
          void acknowledge([e.id]);
          onOpen(e);
        }}
      />
      {(choices.length > 0 || unread.length > 0) && (
        <div className="event-toolbar">
          {choices.length > 0 && (
            <SegmentedControl
              ariaLabel="Фильтр событий"
              value={filter}
              onChange={(id) => setFilter(id as EventFilter)}
              items={choices.map((id) => ({
                id,
                label: id === 'unread' ? `Непрочитанные · ${unread.length}` : FILTER_LABELS[id],
              }))}
            />
          )}
          {unread.length > 0 && (
            <Button
              small
              variant="quiet"
              icon={<CheckCheck size={15} aria-hidden="true" />}
              disabled={saving}
              onClick={() => void acknowledge(unread.map((e) => e.id))}
            >
              Прочитать все
            </Button>
          )}
        </div>
      )}
      {!isTauriRuntime() && (
        <p className="muted small">
          В браузерном режиме фоновый сбор событий недоступен. В приложении события собираются также
          при сворачивании в трей.
        </p>
      )}
      {error && (
        <ErrorBlock
          title="Не удалось обновить события"
          message={error}
          onRetry={() => setTick((n) => n + 1)}
        />
      )}
      {loading && <LoadingBlock label="Загружаем события…" rows={3} />}
      {!loading && !events.length && !error && (
        <EmptyBlock
          title="Пока нет событий"
          message="Здесь появятся события избранных команд и напоминания Формулы 1."
        />
      )}
      {!loading && !!events.length && !shown.length && !error && (
        <EmptyBlock title={filter === 'unread' ? 'Всё прочитано' : 'Таких событий нет'}>
          <Button small onClick={() => setFilter('all')}>
            Показать все события
          </Button>
        </EmptyBlock>
      )}
      <div className="event-list">
        {shown.map((e) => (
          <article className={`panel event-entry ${e.read ? '' : 'unread'}`} key={e.id}>
            <div>
              <Badge>
                {e.sport === 'f1' ? 'Формула 1' : 'Футбол'}
                {!e.read ? ' · Новое' : ''}
              </Badge>
              <time dateTime={new Date(e.occurredAt).toISOString()}>
                {formatHumanDateTime(e.occurredAt, getUserTimezone())}
              </time>
            </div>
            <h2>{e.title}</h2>
            <p>{spoilerSafeBody(spoilers, e)}</p>
            <div className="event-actions">
              {(e.matchId || (e.season && e.round)) && (
                <Button
                  small
                  onClick={() => {
                    void acknowledge([e.id]);
                    onOpen(e);
                  }}
                >
                  {e.sport === 'f1' ? 'Открыть уикенд' : 'Открыть матч'}
                </Button>
              )}
              {!e.read && (
                <Button
                  small
                  variant="quiet"
                  disabled={saving}
                  onClick={() => void acknowledge([e.id])}
                >
                  Отметить прочитанным
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
