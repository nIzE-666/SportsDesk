import { ExternalLink, Radio, RefreshCw, Star } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import TeamBadge from '../../components/TeamBadge';
import { api, openExternal } from '../../lib/bridge';
import { useViewState } from '../../lib/useViewState';
import { classifyMatchStatus, matchStateLabel } from '../../lib/sportsIdentity';
import { matchInvolvesFavorite, useFavorites } from './FavoritesProvider';
import { isPersonalLiveMatch } from './liveCompetitions';
import { formatDateTime, getUserTimezone } from './storage';

interface FlatSportScoreMatch {
  home?: string;
  away?: string;
  home_logo?: string;
  away_logo?: string;
  home_score?: string | number | null;
  away_score?: string | number | null;
  status?: string;
  status_text?: string;
  time?: string;
  competition?: string;
  url?: string;
}

type LiveFilter = 'all' | 'live' | 'finished' | 'favorites';

const REFRESH_MS = 60_000;

function normalizeScore(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : '—';
}

function isLiveMatch(m: FlatSportScoreMatch) {
  return classifyMatchStatus(m.status, m.status_text) === 'live';
}
function isFinishedMatch(m: FlatSportScoreMatch) {
  return classifyMatchStatus(m.status, m.status_text) === 'finished';
}

function extractMatches(payload: any): FlatSportScoreMatch[] {
  if (!payload || typeof payload !== 'object') return [];
  const list = Array.isArray(payload.matches)
    ? payload.matches
    : Array.isArray(payload)
      ? payload
      : [];
  return list.filter((m: unknown): m is FlatSportScoreMatch => {
    if (!m || typeof m !== 'object') return false;
    const obj = m as Record<string, unknown>;
    return typeof obj.home === 'string' || typeof obj.away === 'string';
  });
}

function validateExternalUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('/football/match/')) return null;
  return `https://sportscore.com${url}`;
}

function statusLabel(m: FlatSportScoreMatch) {
  return matchStateLabel(m.status, m.status_text);
}
function statusClass(m: FlatSportScoreMatch) {
  return isLiveMatch(m) ? 'chip live-chip' : 'chip';
}

export function LivePanel() {
  const timezone = getUserTimezone();
  const { favoriteTeamNames } = useFavorites();
  const [matches, setMatches] = useState<FlatSportScoreMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [filter, setFilter] = useViewState<LiveFilter>('football.live.filter', 'all', (v) =>
    ['all', 'live', 'finished', 'favorites'].includes(String(v)),
  );
  const mountedRef = useRef(true);
  const visibleRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async (automatic = false) => {
    setLoading(true);
    setError(null);
    try {
      const reply = await api('sportscore', 'matches/?sport=football&limit=50', { automatic });
      if (!mountedRef.current) return;
      setMatches(extractMatches(reply.payload));
      setFetchedAt(reply.fetchedAt ?? new Date().toISOString());
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'SportScore недоступен');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onVis = () => {
      visibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVis);
    // The Rust background poller nudges open live views after fresh data.
    const onBackgroundRefresh = () => {
      if (mountedRef.current) void load(true);
    };
    window.addEventListener('sportsdesk-live-refresh', onBackgroundRefresh);
    onVis();
    void load();
    timerRef.current = window.setInterval(() => {
      if (visibleRef.current) void load(true);
    }, REFRESH_MS);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('sportsdesk-live-refresh', onBackgroundRefresh);
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [load]);

  const personalMatches = matches.filter((m) => isPersonalLiveMatch(m, favoriteTeamNames));
  const favoriteList = personalMatches.filter((m) =>
    matchInvolvesFavorite(m.home, m.away, favoriteTeamNames),
  );
  const liveCount = personalMatches.filter((m) => isLiveMatch(m)).length;

  const visible = (() => {
    if (filter === 'live') return personalMatches.filter((m) => isLiveMatch(m));
    if (filter === 'finished') return personalMatches.filter((m) => isFinishedMatch(m));
    if (filter === 'favorites') return favoriteList;
    return personalMatches;
  })();

  return (
    <div className="live-view">
      <div className="dashboard-head">
        <div>
          <h1>
            <Radio size={18} /> SportScore — лента матчей
          </h1>
          <p className="muted small">
            Матчи ваших клубов и доступных турниров.{' '}
            {fetchedAt ? `Обновлено ${formatDateTime(fetchedAt, timezone)}.` : ''}
          </p>
        </div>
        <div className="dashboard-head-actions">
          <button className="ghost-btn" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> {loading ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="filters-bar panel">
        <div className="filter-group grow">
          <span className="muted small">Фильтр</span>
          <div className="segmented">
            {(['all', 'live', 'finished', 'favorites'] as const).map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f === 'all'
                  ? `Все (${personalMatches.length})`
                  : f === 'live'
                    ? `Live (${liveCount})`
                    : f === 'finished'
                      ? 'Завершённые'
                      : `Избранные (${favoriteList.length})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && matches.length === 0 && (
        <LoadingBlock label="Загрузка ленты SportScore…" rows={4} />
      )}
      {error && (
        <ErrorBlock
          title="Лента SportScore недоступна"
          message={error}
          onRetry={() => void load()}
        />
      )}
      {!loading && !error && visible.length === 0 && (
        <EmptyBlock
          title="Нет матчей в выбранном фильтре"
          message="Попробуйте другой фильтр или обновите ленту."
        />
      )}

      {visible.length > 0 && (
        <section className="panel">
          <ul className="live-flat-list">
            {visible.map((m, i) => {
              const url = validateExternalUrl(m.url);
              const favorite = matchInvolvesFavorite(m.home, m.away, favoriteTeamNames);
              const live = isLiveMatch(m);
              return (
                <li
                  key={m.url ?? `${m.home}-${m.away}-${i}`}
                  className={favorite ? 'live-flat favorite' : 'live-flat'}
                >
                  <div className="live-flat-comp muted small">{m.competition ?? 'Футбол'}</div>
                  <div className="live-flat-teams">
                    <span className="live-team">
                      <TeamBadge name={m.home ?? 'Команда'} imageUrl={m.home_logo} size={20} />
                      <span className="truncate">{m.home ?? '—'}</span>
                    </span>
                    <strong className="live-score">
                      {normalizeScore(m.home_score)} : {normalizeScore(m.away_score)}
                    </strong>
                    <span className="live-team right">
                      <span className="truncate">{m.away ?? '—'}</span>
                      <TeamBadge name={m.away ?? 'Команда'} imageUrl={m.away_logo} size={20} />
                    </span>
                  </div>
                  <div className="live-meta">
                    <span className={statusClass(m)}>{statusLabel(m)}</span>
                    {live && <span className="chip live-chip">LIVE</span>}
                    {favorite && (
                      <span className="chip fav-chip">
                        <Star size={10} /> Избранное
                      </span>
                    )}
                    {m.time && (
                      <span className="muted small">{formatDateTime(m.time, timezone)}</span>
                    )}
                    {url ? (
                      <button
                        className="link-btn"
                        onClick={() => void openExternal(url).catch(() => undefined)}
                        title="Открыть на SportScore"
                      >
                        Открыть <ExternalLink size={11} />
                      </button>
                    ) : (
                      <span className="muted tiny">нет ссылки на детали</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="source-foot muted small">
        <button
          className="link-btn"
          onClick={() => void openExternal('https://sportscore.com').catch(() => undefined)}
        >
          Powered by SportScore <ExternalLink size={12} />
        </button>
        · Лимит SportScore ~10 000 запросов в день на IP. Лента не является live-only; статусы и
        счета берутся из ответа провайдера.
      </div>
    </div>
  );
}
