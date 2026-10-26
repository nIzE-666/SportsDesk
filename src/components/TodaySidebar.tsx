import { useEffect, useMemo, useState } from 'react';
import { Clock3, Flag, Goal } from 'lucide-react';
import { loadLiveFeed, type LiveFeed } from '../features/football/liveFeed';
import { getUserTimezone } from '../features/football/storage';
import { useApiResource } from '../features/f1/api';
import { parseSchedule } from '../features/f1/parsing';
import { weekendSchedule } from '../features/f1/weekendSchedule';
import { racePresentation } from '../features/f1/calendarModel';
import { useNow } from '../lib/useNow';
import { asApiError } from '../lib/apiError';
import { classifyMatchStatus } from '../lib/sportsIdentity';
interface Props {
  onMatch: (id: string) => void;
  onWeekend: (season: string, round: string) => void;
}
export function TodaySidebar({ onMatch, onWeekend }: Props) {
  const now = useNow(),
    tz = getUserTimezone();
  const year = new Intl.DateTimeFormat('en', { timeZone: tz, year: 'numeric' }).format(now);
  const schedule = useApiResource(`sidebar.${year}`, `${year}.json?limit=100`, parseSchedule);
  const [feed, setFeed] = useState<LiveFeed | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true,
      attempts = 0,
      blocked = false,
      running = false;
    const load = async () => {
      if (blocked || running) return;
      running = true;
      try {
        const value = await loadLiveFeed(true);
        if (active) {
          setFeed(value);
          setError(!!value.failure);
          attempts = 0;
        }
      } catch (e) {
        if (active) setError(true);
        if (!asApiError(e).retryable || ++attempts >= 5) blocked = true;
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    let stop: (() => void) | undefined;
    void import('../lib/bridge').then(async ({ isTauriRuntime }) => {
      if (!isTauriRuntime()) return;
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen('sportsdesk://live-feed', () => void load());
      if (active) stop = off;
      else off();
    });
    return () => {
      active = false;
      clearInterval(timer);
      stop?.();
    };
  }, []);
  const events = useMemo(() => {
    const football = (feed?.matches ?? [])
      .filter((m) => ['scheduled', 'live'].includes(classifyMatchStatus(m.status, m.status_text)))
      .flatMap((m) => {
        const start = m.time ? Date.parse(m.time) : NaN;
        return Number.isFinite(start) &&
          (start > now || classifyMatchStatus(m.status, m.status_text) === 'live')
          ? [
              {
                id: m.id,
                start,
                kind: 'football' as const,
                title: `${m.home} — ${m.away}`,
                live: classifyMatchStatus(m.status, m.status_text) === 'live',
                open: () => onMatch(m.id),
              },
            ]
          : [];
      });
    const f1 = (schedule.data?.races ?? []).flatMap((r) =>
      weekendSchedule(r)
        .filter((s) => s.start && s.start.getTime() > now)
        .map((s) => ({
          id: `${r.season}:${r.round}:${s.id}`,
          start: s.start!.getTime(),
          kind: 'f1' as const,
          title: `${racePresentation(r).title} · ${s.label}`,
          live: false,
          open: () => onWeekend(r.season, r.round),
        })),
    );
    return [...football, ...f1]
      .sort((a, b) => Number(b.live) - Number(a.live) || a.start - b.start)
      .slice(0, 3);
  }, [feed, schedule.data, now, onMatch, onWeekend]);
  const clock = (start: number) =>
    new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(start);
  const countdown = (start: number) => {
    const minutes = Math.ceil((start - now) / 60000);
    return minutes < 60
      ? `через ${minutes} мин.`
      : minutes < 1440
        ? `через ${Math.floor(minutes / 60)} ч ${minutes % 60} мин.`
        : `через ${Math.floor(minutes / 1440)} дн.`;
  };
  return (
    <section className="sidebar-today" aria-label="Ближайшие события">
      <h2>
        <Clock3 size={14} />
        Сегодня и дальше
      </h2>
      {events.map((e) => (
        <button key={e.id} onClick={e.open} title={e.title}>
          <span className="today-kind">
            {e.kind === 'f1' ? <Flag size={12} /> : <Goal size={12} />}{' '}
            {e.live ? 'Матч идёт' : countdown(e.start)}
          </span>
          <strong>{e.title}</strong>
          <small>{clock(e.start)}</small>
        </button>
      ))}
      {!events.length && (
        <p className="muted">
          {schedule.loading && !feed ? 'Загружаем расписание…' : 'Ближайших событий пока нет.'}
        </p>
      )}
      {(error || feed?.stale) && (
        <p className="muted">Есть сохранённые данные. Источник временно недоступен.</p>
      )}
    </section>
  );
}
