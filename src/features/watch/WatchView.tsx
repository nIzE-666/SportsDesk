import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Heart,
  History as HistoryIcon,
  LogOut,
  MonitorPlay,
  RefreshCw,
  Search,
  Signal,
  Tv,
  X,
  LayoutGrid,
  List,
} from 'lucide-react';
import { openExternal, rpc } from '../../lib/bridge';
import {
  Button,
  Badge,
  EmptyState,
  IconButton,
  Panel,
  PanelHeader,
  SegmentedControl,
  Skeleton,
} from '../../kit';
import type { WatchIntent } from '../../lib/watchIntent';
import { getJson, setJson, setString } from '../football/storage';
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
import { AuthDialog, LogoutConfirm } from './WatchAuth';
import { PlayerPane } from './WatchPlayer';
import { ChannelInfoPanel, ChannelItem } from './WatchChannels';
import {
  beginKinoAttempt,
  cancelKinoAttempt,
  finishKinoAttempt,
  isCurrentKinoAttempt,
  logoutKinoSession,
  settleKinoCancellations,
} from './kinoAuth';
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
  const authGeneration = useRef(0);
  const authAttempt = useRef<Promise<string> | null>(null);
  const countdownTimer = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);

  const [channels, setChannels] = useState<KinoChannel[]>([]);
  const channelsGeneration = useRef(0);
  const [channelsState, setChannelsState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'sport' | 'favorites'>('all');
  const [favorites, setFavorites] = useState<Set<number>>(() => readFavorites());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
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
    <Panel className="watch-event-panel" aria-label="Просмотр события">
      <PanelHeader
        title={intent.title}
        action={
          preferred[intent.sport] && channels.some((c) => c.id === preferred[intent.sport]) ? (
            <Button onClick={() => setSelectedId(preferred[intent.sport]!)}>
              Открыть мой канал
            </Button>
          ) : undefined
        }
      />
      <p className="watch-muted">Выберите канал и проверьте, идёт ли трансляция.</p>
    </Panel>
  ) : null;

  useEffect(() => {
    setString('sportsdesk.watch.view', viewMode);
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

  const abandonAuth = useCallback(() => {
    authGeneration.current += 1;
    clearAuthTimers();
    const attempt = authAttempt.current;
    authAttempt.current = null;
    const cancellation = attempt ? cancelKinoAttempt(attempt) : Promise.resolve();
    void cancellation.catch(() => undefined);
    return cancellation;
  }, [clearAuthTimers]);

  const loadStatus = useCallback(async () => {
    setAccount({ kind: 'loading' });
    try {
      await settleKinoCancellations();
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
      abandonAuth();
    };
  }, [loadStatus, abandonAuth]);

  // Load channels once signed in.
  const loadChannels = useCallback(async () => {
    const generation = ++channelsGeneration.current;
    setChannelsState('loading');
    setChannelsError(null);
    try {
      const list = await rpc<KinoChannel[]>('kino_channels');
      if (channelsGeneration.current !== generation) return;
      if (!Array.isArray(list)) throw new Error('Некорректный ответ сервиса.');
      setChannels(list.filter((c) => c && typeof c.id === 'number' && typeof c.title === 'string'));
      setChannelsState('ready');
    } catch (e) {
      if (channelsGeneration.current !== generation) return;
      setChannelsError(cleanError(e));
      setChannelsState('error');
    }
  }, []);

  useEffect(() => {
    if (account.kind === 'signed-in') {
      void loadChannels();
    } else {
      channelsGeneration.current += 1;
      setChannels([]);
      setChannelsState('idle');
    }
    return () => {
      channelsGeneration.current += 1;
    };
  }, [account.kind, loadChannels]);

  const openSite = (url: string) => {
    openExternal(url).catch(() => undefined);
  };

  const cancelAuth = useCallback(() => {
    const cancellation = abandonAuth();
    const generation = authGeneration.current;
    setAuthOpen(false);
    setAuthPhase({ kind: 'idle' });
    void cancellation.catch((e) => {
      if (generation === authGeneration.current)
        setAuthPhase({ kind: 'error', message: cleanError(e) });
    });
  }, [abandonAuth]);

  const startAuth = useCallback(async () => {
    abandonAuth();
    const generation = authGeneration.current;
    const attempt = beginKinoAttempt(() => {
      abandonAuth();
      setAuthPhase({ kind: 'idle' });
    });
    authAttempt.current = attempt;
    setAuthPhase({ kind: 'starting' });
    let start: DeviceAuthStart;
    let sessionId: string;
    const current = () => authGeneration.current === generation && isCurrentKinoAttempt(attempt);
    try {
      sessionId = await attempt;
      if (!current()) return;
      start = await rpc<DeviceAuthStart>('kino_start_auth', { sessionId });
      if (!current()) return;
      if (!start || typeof start.userCode !== 'string' || typeof start.code !== 'string') {
        throw new Error('Сервис вернул некорректные данные входа.');
      }
    } catch (e) {
      if (!current()) return;
      abandonAuth();
      setAuthPhase({ kind: 'error', message: cleanError(e) });
      return;
    }

    const expiresIn =
      Number.isFinite(start.expiresIn) && start.expiresIn > 0 ? start.expiresIn : 300;
    const interval = Math.max(
      2,
      Number.isFinite(start.interval) && start.interval > 0 ? start.interval : 5,
    );
    const deadline = Date.now() + expiresIn * 1000;
    const expire = () => {
      if (!current()) return;
      abandonAuth();
      setAuthPhase({ kind: 'error', message: 'Срок действия кода истёк. Запросите новый.' });
    };
    const valid = () => {
      if (!current()) return false;
      if (Date.now() >= deadline) {
        expire();
        return false;
      }
      return true;
    };

    setAuthPhase({ kind: 'waiting', data: start, remaining: expiresIn });

    countdownTimer.current = window.setInterval(() => {
      if (!valid()) return;
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      setAuthPhase((p) => (p.kind === 'waiting' ? { ...p, remaining } : p));
    }, 1000);

    const schedulePoll = (delayMs: number) => {
      if (!valid()) return;
      pollTimer.current = window.setTimeout(async () => {
        if (!valid()) return;
        try {
          const result = await rpc<DeviceAuthPoll>('kino_poll_auth', { sessionId });
          if (!valid()) return;
          if (result?.authenticated) {
            await rpc('kino_commit_auth', { sessionId });
            if (!valid()) return;
            clearAuthTimers();
            authAttempt.current = null;
            authGeneration.current += 1;
            finishKinoAttempt(sessionId, attempt);
            setAuthPhase({ kind: 'idle' });
            setAuthOpen(false);
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
          if (!valid()) return;
          const message = cleanError(e);
          if (/ист[ёе]к|отклон/i.test(message)) {
            abandonAuth();
            setAuthPhase({ kind: 'error', message });
            return;
          }
          // Network failures can be retried while the code remains valid.
          schedulePoll(Math.min(interval * 2000, 15000));
        }
      }, delayMs);
    };

    schedulePoll(interval * 1000);
  }, [abandonAuth, clearAuthTimers]);

  const toggleFavorite = useCallback((id: number) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFavorites(next);
      return next;
    });
  }, []);

  const visibleChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (filter === 'favorites' && !favorites.has(c.id)) return false;
      if (filter === 'sport' && !looksLikeSport(c.title)) return false;
      return !q || c.title.toLowerCase().includes(q);
    });
  }, [channels, query, filter, favorites]);

  const favoriteChannels = useMemo(
    () => channels.filter((c) => favorites.has(c.id)),
    [channels, favorites],
  );

  // Favourites come first, then the channels opened last, then the rest;
  // every channel appears in one group only.
  const groups = useMemo(() => {
    if (filter === 'favorites')
      return [
        {
          id: 'favorites',
          label: 'Избранное',
          icon: <Heart size={12} aria-hidden fill="currentColor" />,
          items: visibleChannels,
        },
      ];
    const favoriteIds = new Set(favorites);
    const recentIdsSet = new Set(recentIds);
    const recent = visibleChannels.filter((c) => !favoriteIds.has(c.id) && recentIdsSet.has(c.id));
    const rest = visibleChannels.filter((c) => !favoriteIds.has(c.id) && !recentIdsSet.has(c.id));
    return [
      {
        id: 'favorites',
        label: 'Избранное',
        icon: <Heart size={12} aria-hidden fill="currentColor" />,
        items: visibleChannels.filter((c) => favoriteIds.has(c.id)),
      },
      {
        id: 'recent',
        label: 'Недавние',
        icon: <HistoryIcon size={12} aria-hidden />,
        items: recent,
      },
      {
        id: 'all',
        label: 'Все каналы',
        icon: <Tv size={12} aria-hidden />,
        items: rest,
      },
    ].filter((group) => group.items.length > 0);
  }, [visibleChannels, favorites, recentIds, filter]);

  const filterItems = useMemo(
    () => [
      { id: 'all', label: 'Все' },
      { id: 'sport', label: 'Спорт' },
      ...(favoriteChannels.length > 0 ? [{ id: 'favorites', label: 'Избранное' }] : []),
    ],
    [favoriteChannels.length],
  );

  // Removing the last favourite while its filter is on returns to all channels.
  useEffect(() => {
    if (filter === 'favorites' && favoriteChannels.length === 0) setFilter('all');
  }, [filter, favoriteChannels.length]);

  const selected = useMemo(
    () => channels.find((c) => c.id === selectedId) ?? null,
    [channels, selectedId],
  );

  const clearFilters = () => {
    setQuery('');
    setFilter('all');
  };

  const doLogout = useCallback(async () => {
    abandonAuth();
    setLogoutBusy(true);
    try {
      await logoutKinoSession();
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
  }, [abandonAuth]);

  // ------------------------------------------------------------------ render

  if (account.kind === 'loading') {
    return (
      <div className="watch-root">
        <div className="watch-center-state">
          <Skeleton className="watch-center-skeleton" />
          <span className="watch-muted" role="status">
            Проверяем аккаунт…
          </span>
        </div>
      </div>
    );
  }

  if (account.kind === 'error') {
    return (
      <div className="watch-root">
        <div className="watch-center-state">
          <EmptyState
            tone="error"
            title="Не удалось проверить аккаунт"
            icon={<AlertTriangle size={20} aria-hidden />}
            message={account.message}
            action={
              <Button
                variant="primary"
                icon={<RefreshCw size={15} aria-hidden />}
                onClick={() => void loadStatus()}
              >
                Повторить
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (account.kind === 'signed-out') {
    return (
      <div className="watch-root watch-root-signed-out">
        {contextPanel}
        <div className="watch-signedout-stage">
          <EmptyState
            className="watch-signedout-empty"
            icon={<MonitorPlay size={20} aria-hidden />}
            title="Kino"
            message="Подключите аккаунт по коду устройства, без пароля."
            action={
              <Button
                variant="primary"
                icon={<Signal size={16} aria-hidden />}
                onClick={() => {
                  setAuthOpen(true);
                  void startAuth();
                }}
              >
                Подключить устройство
              </Button>
            }
          />
          <div className="watch-browser-fallback">
            <span className="watch-muted">Без входа в приложение</span>
            <div className="watch-fallback-links">
              <Button
                variant="quiet"
                icon={<ExternalLink size={13} aria-hidden />}
                onClick={() => openSite('https://kino.watch/tv/view/okkofootball')}
              >
                OKKO Football
              </Button>
              <Button
                variant="quiet"
                icon={<ExternalLink size={13} aria-hidden />}
                onClick={() => openSite('https://kino.watch/tv/view/skysportsf1')}
              >
                Sky Sports F1
              </Button>
              <Button
                variant="quiet"
                icon={<ExternalLink size={13} aria-hidden />}
                onClick={() => openSite('https://kino.watch/tv/view/matchtv')}
              >
                Матч ТВ
              </Button>
            </div>
          </div>
        </div>
        <AuthDialog
          open={authOpen}
          phase={authPhase}
          onClose={cancelAuth}
          onStart={() => void startAuth()}
          onCancel={cancelAuth}
          onOpenSite={openSite}
        />
      </div>
    );
  }

  // signed-in
  return (
    <div className="watch-root">
      <header className="watch-topbar">
        <div className="watch-topbar-left">
          <Badge>
            <Tv size={16} aria-hidden /> Kino
          </Badge>
          <Badge>
            <CheckCircle2 size={14} aria-hidden /> Аккаунт подключён
          </Badge>
        </div>
        <div className="watch-topbar-right">
          <Button
            small
            icon={<RefreshCw size={14} aria-hidden />}
            busy={channelsState === 'loading'}
            onClick={() => void loadChannels()}
          >
            Обновить
          </Button>
          <Button small icon={<LogOut size={14} aria-hidden />} onClick={() => setShowLogout(true)}>
            Выйти
          </Button>
        </div>
      </header>

      <div className="watch-layout">
        <aside className="watch-rail" aria-label="Каналы">
          <h2 className="visually-hidden">Каналы</h2>

          {channelsState === 'ready' && channels.length > 0 && (
            <>
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
                  <IconButton
                    small
                    className="watch-search-clear"
                    icon={<X size={14} aria-hidden />}
                    aria-label="Очистить поиск"
                    onClick={() => setQuery('')}
                  />
                )}
              </div>

              <div className="watch-filter-row">
                <SegmentedControl
                  ariaLabel="Фильтр каналов"
                  value={filter}
                  onChange={(id) => setFilter(id as 'all' | 'sport' | 'favorites')}
                  items={filterItems}
                />
                {visibleChannels.length > 0 && (
                  <span className="watch-view-toggle" role="group" aria-label="Вид каналов">
                    <IconButton
                      small
                      icon={<LayoutGrid size={14} aria-hidden />}
                      aria-label="Сетка каналов"
                      aria-pressed={viewMode === 'grid'}
                      onClick={() => setViewMode('grid')}
                    />
                    <IconButton
                      small
                      icon={<List size={14} aria-hidden />}
                      aria-label="Список каналов"
                      aria-pressed={viewMode === 'list'}
                      onClick={() => setViewMode('list')}
                    />
                  </span>
                )}
              </div>
            </>
          )}

          <div className="watch-rail-list-wrap">
            {channelsState === 'loading' && (
              <div className="watch-rail-state" role="status">
                <Skeleton />
                <Skeleton />
                <span className="watch-muted">Загружаем каналы…</span>
              </div>
            )}
            {channelsState === 'error' && (
              <div className="watch-rail-state">
                <EmptyState
                  tone="error"
                  title="Каналы не загрузились"
                  icon={<AlertTriangle size={20} aria-hidden />}
                  message={channelsError ?? 'Не удалось получить каналы.'}
                  action={
                    <Button
                      small
                      icon={<RefreshCw size={14} aria-hidden />}
                      onClick={() => void loadChannels()}
                    >
                      Повторить
                    </Button>
                  }
                />
              </div>
            )}
            {channelsState === 'ready' && channels.length === 0 && (
              <div className="watch-rail-state">
                <EmptyState message="В каталоге нет каналов." />
              </div>
            )}
            {channelsState === 'ready' && channels.length > 0 && visibleChannels.length === 0 && (
              <div className="watch-rail-state">
                <EmptyState
                  message={query ? 'Ничего не найдено.' : 'Нет каналов в этом фильтре.'}
                  action={
                    <Button small onClick={clearFilters}>
                      {query ? 'Сбросить поиск' : 'Показать все'}
                    </Button>
                  }
                />
              </div>
            )}
            {channelsState === 'ready' && visibleChannels.length > 0 && (
              <div className={`watch-catalog watch-catalog--${viewMode}`}>
                {groups.map((group) => (
                  <section
                    className="watch-group"
                    key={group.id}
                    aria-labelledby={`watch-group-${group.id}`}
                  >
                    <h3 className="watch-group-title" id={`watch-group-${group.id}`}>
                      {group.icon}
                      {group.label}
                    </h3>
                    <ul className="watch-channel-list">
                      {group.items.map((c) => (
                        <ChannelItem
                          key={c.id}
                          channel={c}
                          active={c.id === selectedId}
                          favorite={favorites.has(c.id)}
                          layout={viewMode === 'grid' ? 'tile' : 'row'}
                          onSelect={() => selectChannel(c.id)}
                          onToggleFavorite={() => toggleFavorite(c.id)}
                        />
                      ))}
                    </ul>
                  </section>
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
          ) : channelsState === 'ready' ? (
            <ChannelInfoPanel
              channelsCount={channels.length}
              favoritesCount={favoriteChannels.length}
            />
          ) : channelsState === 'loading' ? (
            <div className="watch-center-state" aria-hidden>
              <Skeleton className="watch-center-skeleton" />
              <Skeleton className="watch-center-skeleton" />
            </div>
          ) : null}
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
