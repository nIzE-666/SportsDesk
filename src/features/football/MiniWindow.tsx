import { useCallback, useEffect, useRef, useState } from 'react';
import { Pin, Radio, X } from 'lucide-react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import { getUserTimezone, formatDateTime } from './storage';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { loadLiveFeed, type LiveMatch } from './liveFeed';
import { SPOILER_MASK, spoilerKey, useSpoilerSet } from '../spoilers/spoilerStore';
import './mini.css';

/**
 * №7: мини-окно live-счёта. Работает в отдельном Tauri-окне (route #mini):
 * без рамки, поверх всех окон. Показывает live и ближайшие матчи
 * отслеживаемых команд; обновляется раз в 60 с и по сигналам Rust-поллера.
 */

type FlatMatch = LiveMatch;

const REFRESH_MS = 60_000;

function isLive(m: FlatMatch): boolean {
  return classifyMatchStatus(m.status, m.status_text) === 'live';
}

function score(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const t = String(v).trim();
  return t.length > 0 ? t : '—';
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
    <div className="mini-root">
      <header className="mini-top">
        <span className="mini-title">
          <Radio size={13} /> Live-мини
        </span>
        <span className="mini-updated muted">{updatedAt ? formatDateTime(updatedAt, tz) : ''}</span>
        <button className="mini-close" onClick={() => void close()} aria-label="Закрыть">
          <X size={13} />
        </button>
      </header>

      {error && (
        <p className="mini-error">
          {error}{' '}
          <button className="mini-retry" onClick={() => void load()}>
            Повторить
          </button>
        </p>
      )}

      <div className="mini-list">
        {shown.length === 0 && !error && (
          <div className="mini-empty">
            <Pin size={20} />
            <span>Сейчас нет матчей избранных клубов.</span>
          </div>
        )}
        {shown.map((m, i) => (
          <div key={`${m.home}-${m.away}-${i}`} className={`mini-row ${isLive(m) ? 'live' : ''}`}>
            <span className="mini-comp muted">{m.competition ?? ''}</span>
            <div className="mini-teams">
              <span className="mini-team">{m.home ?? '—'}</span>
              <b className="mini-score">
                {spoilers.has(spoilerKey('football', m.id))
                  ? SPOILER_MASK
                  : `${score(m.home_score)} : ${score(m.away_score)}`}
              </b>
              <span className="mini-team">{m.away ?? '—'}</span>
            </div>
            <span className="mini-status">
              {isLive(m) ? <i className="mini-live-dot" /> : null}
              {m.time ? formatDateTime(m.time, tz) : (m.status_text ?? '')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MiniWindow;
