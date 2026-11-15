import { useCallback, useEffect, useRef, useState } from 'react';
import { Pin, Radio, WifiOff, X } from 'lucide-react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import { formatHumanDateTime } from '../../lib/humanDate';
import { getUserTimezone, formatUpdatedAt } from './storage';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { Button, EmptyState, IconButton, MatchRow, type MatchRowStatus } from '../../kit';
import { loadLiveFeed, minuteLabel, type LiveMatch } from './liveFeed';
import { spoilerKey, useSpoilerSet } from '../spoilers/spoilerStore';
import './mini.css';

/**
 * №7: мини-окно live-счёта. Работает в отдельном Tauri-окне (route #mini):
 * без рамки, поверх всех окон. Показывает live и ближайшие матчи
 * отслеживаемых команд; обновляется раз в 60 с и по сигналам Rust-поллера.
 */

type FlatMatch = LiveMatch;

const REFRESH_MS = 60_000;

function rowStatus(m: FlatMatch): MatchRowStatus {
  const state = classifyMatchStatus(m.status, m.status_text);
  if (state === 'live') return 'live';
  if (state === 'finished') return 'finished';
  if (state === 'postponed') return 'postponed';
  return 'scheduled';
}

/** The narrow window shows the clock first and the human day below it. */
function shortKickOff(value: string, timeZone: string): { time: string; note: string | null } {
  const full = formatHumanDateTime(value, timeZone);
  const relative = /^(сегодня|завтра|вчера) (\d{2}:\d{2})$/u.exec(full);
  if (relative) return { time: relative[2]!, note: relative[1]! };
  const lastComma = full.lastIndexOf(', ');
  if (lastComma === -1) return { time: full, note: null };
  return { time: full.slice(lastComma + 2), note: full.slice(0, lastComma) };
}

export function MiniWindow() {
  const [matches, setMatches] = useState<FlatMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const mounted = useRef(true);
  // Список «без спойлеров» общий с главным окном через localStorage.
  const spoilers = useSpoilerSet();

  const load = useCallback(async (automatic = false) => {
    try {
      const reply = await loadLiveFeed(automatic);
      if (!mounted.current) return;
      const list = reply.matches;
      setMatches(list.filter((m) => m && (m.home || m.away)));
      setError(
        reply.stale
          ? 'Показаны сохранённые данные. ' + (reply.failure?.message ?? 'Нет связи с источником.')
          : null,
      );
      setUpdatedAt(reply.fetchedAt ?? new Date().toISOString());
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : 'Нет данных');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    let stop: (() => void) | undefined;
    if (isTauriRuntime())
      void import('@tauri-apps/api/event').then(async (mod) => {
        const off = await mod.listen('sportsdesk://live-feed', () => void load());
        if (mounted.current) stop = off;
        else off();
      });
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    // Rust-поллер обновил данные в фоне — подтягиваем сразу.
    const onPing = () => void load();
    window.addEventListener('sportsdesk-live-refresh', onPing);
    return () => {
      mounted.current = false;
      stop?.();
      window.clearInterval(timer);
      window.removeEventListener('sportsdesk-live-refresh', onPing);
    };
  }, [load]);

  const tz = getUserTimezone();
  const shown = matches
    .filter((m) => classifyMatchStatus(m.status, m.status_text) !== 'cancelled')
    .slice(0, 12);

  const close = async () => {
    if (isTauriRuntime()) {
      try {
        await rpc('close_mini_window');
        return;
      } catch {
        /* fallthrough */
      }
    }
    window.close();
  };

  return (
    <div className="mini-root app-root">
      <header className="mini-top">
        <span className="mini-title">
          <Radio size={13} aria-hidden /> Live-мини
        </span>
        <span className="mini-updated muted">
          {updatedAt ? formatUpdatedAt(updatedAt, tz) : ''}
        </span>
        <IconButton
          small
          onClick={() => void close()}
          aria-label="Закрыть"
          icon={<X size={13} aria-hidden />}
        />
      </header>

      {error && (
        <EmptyState
          className="mini-error"
          tone="error"
          compact
          icon={<WifiOff size={20} aria-hidden />}
          message={error}
          action={
            <Button variant="quiet" small onClick={() => void load()}>
              Повторить
            </Button>
          }
        />
      )}

      <div className="mini-list">
        {shown.length === 0 && !error && (
          <EmptyState
            compact
            icon={<Pin size={20} aria-hidden />}
            message="Сейчас нет матчей избранных клубов."
          />
        )}
        {shown.map((m, i) => {
          const status = rowStatus(m);
          const kickOff = status === 'scheduled' && m.time ? shortKickOff(m.time, tz) : null;
          return (
            <MatchRow
              key={`${m.home}-${m.away}-${i}`}
              size="compact"
              competition={m.competition ?? undefined}
              home={{ name: m.home ?? '—' }}
              away={{ name: m.away ?? '—' }}
              time={
                kickOff
                  ? kickOff.time
                  : m.time
                    ? formatHumanDateTime(m.time, tz)
                    : (m.status_text ?? null)
              }
              timeNote={kickOff?.note ?? undefined}
              status={status}
              minute={status === 'live' ? minuteLabel(m.status_text ?? null) : null}
              score={{ home: m.home_score ?? null, away: m.away_score ?? null }}
              hideScore={spoilers.has(spoilerKey('football', m.id))}
            />
          );
        })}
      </div>
    </div>
  );
}

export default MiniWindow;
