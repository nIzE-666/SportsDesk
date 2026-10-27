import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Heart,
  Loader2,
  LogOut,
  MonitorPlay,
  RefreshCw,
  Search,
  Tv,
  X,
  LayoutGrid,
  List,
  History as HistoryIcon,
} from 'lucide-react';
import { openExternal, rpc } from '../../lib/bridge';
import type { WatchIntent } from '../../lib/watchIntent';
import { getJson, setJson } from '../football/storage';
import { rememberSearchItems } from '../../lib/searchIndex';

import type {
  KinoChannel,
  AuthPhase,
  SecretStatus,
  DeviceAuthStart,
  DeviceAuthPoll,
} from './watchShared';
import {
  cleanError,
  siteUrlForChannel,
  looksLikeSport,
  readRecent,
  writeRecent,
  readFavorites,
  writeFavorites,
} from './watchShared';
import { SplitAuthPanel, LogoutConfirm } from './WatchAuth';
import { PlayerPane } from './WatchPlayer';
import { ChannelListItem, ChannelTile, ChannelInfoPanel } from './WatchChannels';
import './watch.css';
type AccountState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in' }
  | { kind: 'error'; message: string };
export function WatchView({
  intent,
  requestedChannelId,
}: { intent?: WatchIntent; requestedChannelId?: number } = {}) {
  const [account, setAccount] = useState<AccountState>({ kind: 'loading' });
  const [authPhase, setAuthPhase] = useState<AuthPhase>({ kind: 'idle' });
  const pollAbort = useRef(false);
  const countdownTimer = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);

  const [channels, setChannels] = useState<KinoChannel[]>([]);
  const [channelsState, setChannelsState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'sport'>('all');
  const [favorites, setFavorites] = useState<Set<number>>(() => readFavorites());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showLogout, setShowLogout] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  // №10: вид каналов (сетка картиночек / список) и недавние.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('sportsdesk.watch.view') === 'list' ? 'list' : 'grid',
  );
  const [recentIds, setRecentIds] = useState<number[]>(() => readRecent());
  const [preferred, setPreferred] = useState<Record<string, number>>(() => {
    const data = getJson<unknown>('sportsdesk.watch.preferred', {});
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, number>)
      : {};
  });
  useEffect(() => {
    setQuery('');
    setFilter(intent ? 'sport' : 'all');
    setSelectedId(requestedChannelId ?? null);
  }, [intent?.key, requestedChannelId]);
  useEffect(() => {
    rememberSearchItems(
      channels.map((c) => ({
        key: `channel:${c.id}`,
        title: c.title,
        subtitle: 'ТВ-канал',
        target: { kind: 'channel', id: c.id },
      })),
    );
  }, [channels]);
  const savePreferred = (checked: boolean) => {
    if (!intent || !selectedId) return;
    const next = { ...preferred };
    if (checked) next[intent.sport] = selectedId;
    else delete next[intent.sport];
    setPreferred(next);
    setJson('sportsdesk.watch.preferred', next);
  };
  const contextPanel = intent ? (
    <section className="panel watch-event-context" aria-label="Просмотр события">
      <div>
        <h2>{intent.title}</h2>
        <p>
          Выберите канал для этого события. Программа передач не подключена — наличие трансляции
          нужно проверить на канале.
        </p>
      </div>
      {preferred[intent.sport] && channels.some((c) => c.id === preferred[intent.sport]) && (
        <button className="ghost-btn" onClick={() => setSelectedId(preferred[intent.sport]!)}>
          Открыть мой канал
        </button>
      )}
    </section>
  ) : null;

  useEffect(() => {
    localStorage.setItem('sportsdesk.watch.view', viewMode);
  }, [viewMode]);

  // Выбор канала попадает в «недавние» (уникальные, максимум 6).
  const selectChannel = useCallback((id: number) => {
    setSelectedId(id);
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 6);
      writeRecent(next);
      return next;
    });
  }, []);

  const clearAuthTimers = useCallback(() => {
    if (countdownTimer.current !== null) {
      window.clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setAccount({ kind: 'loading' });
    try {
      const status = await rpc<SecretStatus>('secret_status');
      if (status?.kino) setAccount({ kind: 'signed-in' });
      else setAccount({ kind: 'signed-out' });
    } catch (e) {
      setAccount({ kind: 'error', message: cleanError(e) });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    return () => {
      clearAuthTimers();
      pollAbort.current = true;
    };
  }, [loadStatus, clearAuthTimers]);

  // Load channels once signed in.
  const loadChannels = useCallback(async () => {
    setChannelsState('loading');
    setChannelsError(null);
    try {
      const list = await rpc<KinoChannel[]>('kino_channels');
      if (!Array.isArray(list)) throw new Error('Некорректный ответ сервиса.');
      setChannels(list.filter((c) => c && typeof c.id === 'number' && typeof c.title === 'string'));
      setChannelsState('ready');
    } catch (e) {
      setChannelsError(cleanError(e));
      setChannelsState('error');
    }
  }, []);

  useEffect(() => {
    if (account.kind === 'signed-in') {
      void loadChannels();
    } else {
      setChannels([]);
      setChannelsState('idle');
    }
  }, [account.kind, loadChannels]);

  const openSite = (url: string) => {
    openExternal(url).catch(() => undefined);
  };

  const cancelAuth = useCallback(() => {
    pollAbort.current = true;
    clearAuthTimers();
    setAuthPhase({ kind: 'idle' });
  }, [clearAuthTimers]);

  const startAuth = useCallback(async () => {
    pollAbort.current = false;
    clearAuthTimers();
    setAuthPhase({ kind: 'starting' });
    let start: DeviceAuthStart;
    try {
      start = await rpc<DeviceAuthStart>('kino_start_auth');
      if (!start || typeof start.userCode !== 'string' || typeof start.code !== 'string') {
        throw new Error('Сервис вернул некорректные данные входа.');
      }
    } catch (e) {
      setAuthPhase({ kind: 'error', message: cleanError(e) });
      return;
    }

    const expiresIn =
      Number.isFinite(start.expiresIn) && start.expiresIn > 0 ? start.expiresIn : 300;
    const interval = Math.max(
      2,
      Number.isFinite(start.interval) && start.interval > 0 ? start.interval : 5,
    );
    let remaining = expiresIn;

    setAuthPhase({ kind: 'waiting', data: start, remaining });

    countdownTimer.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearAuthTimers();
        if (!pollAbort.current) {
          setAuthPhase({ kind: 'error', message: 'Срок действия кода истёк. Запросите новый.' });
        }
        return;
      }
      setAuthPhase((p) => (p.kind === 'waiting' ? { ...p, remaining } : p));
    }, 1000);

    const schedulePoll = (delayMs: number) => {
      if (pollAbort.current) return;
      pollTimer.current = window.setTimeout(async () => {
        if (pollAbort.current) return;
        try {
          const result = await rpc<DeviceAuthPoll>('kino_poll_auth', { code: start.code });
          if (pollAbort.current) return;
          if (result?.authenticated) {
            clearAuthTimers();
            setAuthPhase({ kind: 'idle' });
            setAccount({ kind: 'signed-in' });
            return;
          }
          if (result?.pending) {
            schedulePoll(interval * 1000);
            return;
          }
          // Not pending, not authenticated: treat as still waiting briefly.
          schedulePoll(interval * 1000);
        } catch (e) {
          // Recoverable poll failure — retry a few times then surface error.
          schedulePoll(Math.min(interval * 2000, 15000));
        }
      }, delayMs);
    };

    schedulePoll(interval * 1000);
  }, [clearAuthTimers]);

  const toggleFavorite = useCallback((id: number) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFavorites(next);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (filter === 'sport' && !looksLikeSport(c.title)) return false;
      if (!q) return true;
      return c.title.toLowerCase().includes(q);
    });
  }, [channels, query, filter]);

  const favoriteChannels = useMemo(
    () => channels.filter((c) => favorites.has(c.id)),
    [channels, favorites],
  );

  const recentChannels = useMemo(
    () =>
      recentIds
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is KinoChannel => Boolean(c)),
    [channels, recentIds],
  );

  const selected = useMemo(
    () => channels.find((c) => c.id === selectedId) ?? null,
    [channels, selectedId],
  );

  const doLogout = useCallback(async () => {
    setLogoutBusy(true);
    try {
      await rpc<{ ok: boolean }>('kino_logout');
      setShowLogout(false);
      setChannels([]);
      setSelectedId(null);
      setAccount({ kind: 'signed-out' });
    } catch (e) {
      setShowLogout(false);
      setAccount({ kind: 'error', message: cleanError(e) });
    } finally {
      setLogoutBusy(false);
    }
  }, []);

  // ------------------------------------------------------------------ render

  if (account.kind === 'loading') {
    return (
      <div className="watch-root">
        <div className="watch-center-state">
          <Loader2 size={28} className="watch-spin" aria-hidden />
          <span className="watch-muted">Проверяем аккаунт…</span>
        </div>
      </div>
    );
  }

  if (account.kind === 'error') {
    return (
      <div className="watch-root">
        <div className="watch-center-state">
          <AlertTriangle size={28} aria-hidden />
          <span>{account.message}</span>
          <button
            type="button"
            className="watch-btn watch-btn-primary"
            onClick={() => void loadStatus()}
          >
            <RefreshCw size={15} aria-hidden /> Повторить
          </button>
        </div>
      </div>
    );
  }

  if (account.kind === 'signed-out') {
    return (
      <div className="watch-root watch-root-signed-out">
        {contextPanel}
        <div className="watch-signedout-stage">
          <div className="watch-signedout-hero">
            <span className="watch-hero-icon">
              <MonitorPlay size={30} aria-hidden />
            </span>
            <h1>Kino Live</h1>
            <p className="watch-muted">
              Просмотр ТВ-каналов через ваш аккаунт Kino. Подключите устройство один раз — токены
              хранятся защищённо на этом компьютере и не попадают в интерфейс.
            </p>
          </div>
          <SplitAuthPanel
            phase={authPhase}
            onStart={() => void startAuth()}
            onCancel={cancelAuth}
            onOpenSite={openSite}
          />
          <div className="watch-browser-fallback">
            <span className="watch-muted">Быстрый доступ без входа в приложении:</span>
            <div className="watch-fallback-links">
              <button
                type="button"
                className="watch-link-btn"
                onClick={() => openSite('https://kino.watch/tv/view/okkofootball')}
              >
                <ExternalLink size={13} aria-hidden /> OKKO Football
              </button>
              <button
                type="button"
                className="watch-link-btn"
                onClick={() => openSite('https://kino.watch/tv/view/skysportsf1')}
              >
                <ExternalLink size={13} aria-hidden /> Sky Sports F1
              </button>
              <button
                type="button"
                className="watch-link-btn"
                onClick={() => openSite('https://kino.watch/tv/view/matchtv')}
              >
                <ExternalLink size={13} aria-hidden /> Матч ТВ
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // signed-in
  return (
    <div className="watch-root">
      <header className="watch-topbar">
        <div className="watch-topbar-left">
          <span className="watch-brand-badge">
            <Tv size={16} aria-hidden /> Kino
          </span>
          <span className="watch-account-pill">
            <CheckCircle2 size={14} aria-hidden /> Аккаунт подключён
          </span>
        </div>
        <div className="watch-topbar-right">
          <button
            type="button"
            className="watch-btn watch-btn-ghost watch-btn-sm"
            onClick={() => void loadChannels()}
            disabled={channelsState === 'loading'}
          >
            {channelsState === 'loading' ? (
              <Loader2 size={14} className="watch-spin" aria-hidden />
            ) : (
              <RefreshCw size={14} aria-hidden />
            )}
            Обновить
          </button>
          <button
            type="button"
            className="watch-btn watch-btn-ghost watch-btn-sm"
            onClick={() => setShowLogout(true)}
          >
            <LogOut size={14} aria-hidden /> Выйти
          </button>
        </div>
      </header>

      <div className="watch-layout">
        <aside className="watch-rail" aria-label="Каналы">
          <div className="watch-rail-search">
            <Search size={15} aria-hidden className="watch-search-icon" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск канала…"
              aria-label="Поиск канала"
            />
            {query && (
              <button
                type="button"
                className="watch-search-clear"
                onClick={() => setQuery('')}
                aria-label="Очистить поиск"
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </div>

          <div className="watch-filter-row" role="tablist" aria-label="Фильтр каналов">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={`watch-filter-btn${filter === 'all' ? ' is-active' : ''}`}
              onClick={() => setFilter('all')}
            >
              Все
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'sport'}
              className={`watch-filter-btn${filter === 'sport' ? ' is-active' : ''}`}
              onClick={() => setFilter('sport')}
            >
              Спорт
            </button>
            <span className="watch-view-toggle" role="group" aria-label="Вид каналов">
              <button
                type="button"
                className={`watch-filter-btn${viewMode === 'grid' ? ' is-active' : ''}`}
                onClick={() => setViewMode('grid')}
                aria-label="Сетка каналов"
                title="Сетка"
              >
                <LayoutGrid size={13} aria-hidden />
              </button>
              <button
                type="button"
                className={`watch-filter-btn${viewMode === 'list' ? ' is-active' : ''}`}
                onClick={() => setViewMode('list')}
                aria-label="Список каналов"
                title="Список"
              >
                <List size={13} aria-hidden />
              </button>
            </span>
          </div>

          {recentChannels.length > 0 && (
            <div className="watch-fav-bar">
              <span className="watch-fav-bar-label">
                <HistoryIcon size={12} aria-hidden /> Недавние
              </span>
              <div className="watch-fav-bar-chips">
                {recentChannels.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`watch-fav-chip${selectedId === c.id ? ' is-active' : ''}`}
                    onClick={() => selectChannel(c.id)}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {favoriteChannels.length > 0 && (
            <div className="watch-fav-bar">
              <span className="watch-fav-bar-label">
                <Heart size={12} aria-hidden fill="currentColor" /> Избранное
              </span>
              <div className="watch-fav-bar-chips">
                {favoriteChannels.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`watch-fav-chip${selectedId === c.id ? ' is-active' : ''}`}
                    onClick={() => selectChannel(c.id)}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="watch-rail-list-wrap">
            {channelsState === 'loading' && (
              <div className="watch-rail-state">
                <Loader2 size={18} className="watch-spin" aria-hidden />
                <span className="watch-muted">Загружаем каналы…</span>
              </div>
            )}
            {channelsState === 'error' && (
              <div className="watch-rail-state">
                <AlertTriangle size={18} aria-hidden />
                <span>{channelsError ?? 'Не удалось получить каналы.'}</span>
                <button
                  type="button"
                  className="watch-btn watch-btn-ghost watch-btn-sm"
                  onClick={() => void loadChannels()}
                >
                  <RefreshCw size={14} aria-hidden /> Повторить
                </button>
              </div>
            )}
            {channelsState === 'ready' && filtered.length === 0 && (
              <div className="watch-rail-state">
                <span className="watch-muted">Ничего не найдено.</span>
              </div>
            )}
            {channelsState === 'ready' && filtered.length > 0 && viewMode === 'list' && (
              <ul className="watch-channel-list">
                {filtered.map((c) => (
                  <ChannelListItem
                    key={c.id}
                    channel={c}
                    active={c.id === selectedId}
                    favorite={favorites.has(c.id)}
                    onSelect={() => selectChannel(c.id)}
                    onToggleFavorite={() => toggleFavorite(c.id)}
                  />
                ))}
              </ul>
            )}
            {channelsState === 'ready' && filtered.length > 0 && viewMode === 'grid' && (
              <div className="watch-channel-grid">
                {filtered.map((c) => (
                  <ChannelTile
                    key={c.id}
                    channel={c}
                    active={c.id === selectedId}
                    favorite={favorites.has(c.id)}
                    onSelect={() => selectChannel(c.id)}
                    onToggleFavorite={() => toggleFavorite(c.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="watch-stage">
          {contextPanel}
          {requestedChannelId &&
            channelsState === 'ready' &&
            !channels.some((c) => c.id === requestedChannelId) && (
              <p role="status" className="watch-muted">
                Этот канал больше недоступен в каталоге. Выберите другой.
              </p>
            )}
          {intent && selected && (
            <label className="channel-preference">
              <input
                type="checkbox"
                checked={preferred[intent.sport] === selected.id}
                onChange={(e) => savePreferred(e.target.checked)}
              />
              Предпочитаемый канал для {intent.sport === 'f1' ? 'Формулы 1' : 'футбола'}
            </label>
          )}
          {selected ? (
            <PlayerPane
              key={selected.id}
              channel={selected}
              onOpenSite={() => undefined}
              onOpenSitePage={() => openSite(siteUrlForChannel(selected))}
            />
          ) : (
            <ChannelInfoPanel
              channelsCount={channels.length}
              favoritesCount={favoriteChannels.length}
            />
          )}
        </main>
      </div>

      {showLogout && (
        <LogoutConfirm
          onCancel={() => setShowLogout(false)}
          onConfirm={() => void doLogout()}
          busy={logoutBusy}
        />
      )}
    </div>
  );
}

// Shown before a channel is picked — real account/channel counts only, no fake stats.
