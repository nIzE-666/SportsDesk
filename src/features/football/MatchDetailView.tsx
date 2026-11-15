import { classifyMatchStatus, matchStateLabel } from '../../lib/sportsIdentity';
import { ArrowLeft, Radio } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SectionBoundary } from '../../components/SectionBoundary';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import TeamBadge from '../../components/TeamBadge';
import { SourceLine } from '../../components/SourceLine';
import { api, isTauriRuntime, rpc } from '../../lib/bridge';
import { useModules } from '../../lib/modules';
import { useViewState } from '../../lib/useViewState';
import { retainResource } from '../../lib/resourceHealth';
import { WatchEventButton } from '../../lib/watchIntent';
import { MatchPlayersComparison, PlayersTab } from './MatchPlayers';
import './matchStats.css';
import { MatchStatsTab } from './MatchStatsTab';
import { MatchLineups } from './MatchLineups';
import { MatchAnalysis } from './MatchAnalysis';
import { TacticsBoard } from '../tactics/TacticsBoard';
import { DiaryMarkButton } from '../diary/DiaryMarkButton';
import { footballDiaryEvent } from '../diary/diaryModel';
import { HiddenScore, SpoilerGate } from '../spoilers/SpoilerGate';
import { SpoilerToggle } from '../spoilers/SpoilerToggle';
import { PredictionPanel } from '../games/PredictionPanel';
import '../spoilers/spoilers.css';
import { formatHumanDateTime } from '../../lib/humanDate';
import { formatUpdatedAt, getUserTimezone } from './storage';
import type {
  EventsPayload,
  LineupsPayload,
  MatchDetail,
  MatchEvent,
  MatchSummary,
  PlayerMatchEntry,
  StatGroup,
  StatsPayload,
} from './types';
export { FavoritePlayersPanel } from './MatchPlayers';

interface Loaded {
  detail: MatchDetail | null;
  players: PlayerMatchEntry[];
  lineups: LineupsPayload | null;
  stats: StatsPayload | null;
  events: EventsPayload | null;
}

type TabKey = 'overview' | 'events' | 'lineups' | 'stats' | 'players' | 'analysis' | 'tactics';

const EMPTY: Loaded = { detail: null, players: [], lineups: null, stats: null, events: null };
const matchStatusLabel = matchStateLabel;

/**
 * Cell keys that are additive counting stats. Only these are mathematically
 * meaningful when normalised per 90 minutes. Ratios/scores/minutes must be
 * shown raw because dividing them by minutes inverts their semantics.
 */
function isPlayerEntry(value: unknown): value is PlayerMatchEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const player = v.player as Record<string, unknown> | undefined;
  return Boolean(
    player &&
    typeof player.id === 'string' &&
    typeof player.name === 'string' &&
    Array.isArray(v.stats),
  );
}

function normalizePlayersPayload(payload: any): PlayerMatchEntry[] {
  if (Array.isArray(payload)) return payload.filter(isPlayerEntry);
  if (payload && Array.isArray(payload.players)) return payload.players.filter(isPlayerEntry);
  return [];
}

export function MatchDetailView({
  matchId,
  seasonMatches = [],
  onOpenMatch,
  onBack,
}: {
  matchId: string;
  seasonMatches?: MatchSummary[];
  onOpenMatch?: (id: string) => void;
  /** Local competition screens keep their own way back; the route match uses the header. */
  onBack?: () => void;
}) {
  const modules = useModules();
  const timezone = getUserTimezone();
  const [tab, setTab] = useViewState<TabKey>(`match.${matchId}.tab`, 'overview', (v) =>
    ['overview', 'events', 'lineups', 'stats', 'players', 'analysis', 'tactics'].includes(
      String(v),
    ),
  );
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [refreshingDetail, setRefreshingDetail] = useState(false);
  const [optionalErrors, setOptionalErrors] = useState<Partial<Record<TabKey, string>>>({});
  const [optionalLoading, setOptionalLoading] = useState<Partial<Record<TabKey, boolean>>>({});
  const [sources, setSources] = useState<
    Record<string, { fetchedAt: string | null; stale: boolean }>
  >({});
  const [analysisSource, setAnalysisSource] = useState<{
    fetchedAt: string | null;
    stale: boolean;
  } | null>(null);
  const updateAnalysisSource = useCallback(
    (status: { fetchedAt: string | null; stale: boolean }) => setAnalysisSource(status),
    [],
  );
  const reqRef = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    const release = ['', '/players', '/lineups', '/stats', '/events'].map((suffix) =>
      retainResource('pitch', `matches/${matchId}${suffix}`),
    );
    return () => release.forEach((stop) => stop());
  }, [matchId]);

  const loadOptional = useCallback(
    async (key: 'players' | 'lineups' | 'stats' | 'events', automatic = false) => {
      const requestId = reqRef.current;
      const map: Record<'players' | 'lineups' | 'stats' | 'events', string> = {
        players: `matches/${matchId}/players`,
        lineups: `matches/${matchId}/lineups`,
        stats: `matches/${matchId}/stats`,
        events: `matches/${matchId}/events`,
      };
      setOptionalLoading((prev) => ({ ...prev, [key]: true }));
      try {
        const reply = await api('pitch', map[key], { automatic });
        if (!mounted.current || requestId !== reqRef.current) return;
        setSources((prev) => ({
          ...prev,
          [key]: { fetchedAt: reply.fetchedAt ?? null, stale: reply.stale },
        }));
        const payload = reply.payload?.data ?? reply.payload;
        setLoaded((prev) => {
          if (key === 'players') return { ...prev, players: normalizePlayersPayload(payload) };
          if (key === 'lineups')
            return { ...prev, lineups: (payload ?? null) as LineupsPayload | null };
          if (key === 'stats') return { ...prev, stats: (payload ?? null) as StatsPayload | null };
          return { ...prev, events: (payload ?? null) as EventsPayload | null };
        });
        setOptionalErrors((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } catch (e) {
        if (!mounted.current || requestId !== reqRef.current) return;
        setSources((prev) =>
          prev[key] ? { ...prev, [key]: { ...prev[key]!, stale: true } } : prev,
        );
        setOptionalErrors((prev) => ({
          ...prev,
          [key]: e instanceof Error ? e.message : 'Нет данных',
        }));
      } finally {
        if (mounted.current && requestId === reqRef.current)
          setOptionalLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [matchId],
  );

  useEffect(() => {
    const reqId = ++reqRef.current;
    mounted.current = true;
    setLoaded(EMPTY);
    setError(null);
    setLoading(true);
    setRefreshingDetail(false);
    setOptionalErrors({});
    setSources({});
    setAnalysisSource(null);
    setOptionalLoading({ events: true, lineups: true, players: true, stats: true });

    void (async () => {
      try {
        const detailReply = await api('pitch', `matches/${matchId}`);
        if (reqRef.current !== reqId) return;
        const detail = (detailReply.payload?.data ?? detailReply.payload) as MatchDetail | null;
        if (!detail || !detail.home_team || !detail.away_team) throw new Error('Матч не найден');
        setSources((prev) => ({
          ...prev,
          detail: { fetchedAt: detailReply.fetchedAt ?? null, stale: detailReply.stale },
        }));
        setLoaded((prev) => ({ ...prev, detail }));
        setLoading(false);
        // Bounded concurrency: events + lineups first, then players + stats.
        await Promise.all([loadOptional('events'), loadOptional('lineups')]);
        if (reqRef.current !== reqId) return;
        await Promise.all([loadOptional('players'), loadOptional('stats')]);
      } catch (e) {
        if (reqRef.current !== reqId) return;
        setError(e instanceof Error ? e.message : 'Не удалось загрузить матч');
        setLoading(false);
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, [matchId, loadOptional, retry]);

  // Живой центр матча: пока матч открыт, Rust опрашивает его каждые 60 с и
  // присылает sportsdesk://match-update при изменениях — обновляем экран.
  const [liveTick, setLiveTick] = useState(0);
  const [manualTick, setManualTick] = useState(0);
  const lastManualTick = useRef(0);
  const [liveAt, setLiveAt] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauriRuntime()) return; // dev-браузер: обычная загрузка без слежения
    let stop: (() => void) | null = null;
    let active = true;

    // Рефреш без сброса state: тихо перезагружаем деталь и события.
    const softRefresh = () => {
      setLiveTick((n) => n + 1);
    };

    void (async () => {
      try {
        await rpc('watch_match', { matchId });
        const mod = await import('@tauri-apps/api/event');
        const un = await mod.listen<{ matchId: string; fetchedAt: string }>(
          'sportsdesk://match-update',
          (e) => {
            if (!active || e.payload?.matchId !== matchId) return;
            setLiveAt(e.payload.fetchedAt ?? null);
            softRefresh();
          },
        );
        if (!active) {
          un();
          return;
        }
        stop = un;
      } catch {
        /* watch недоступен: остаётся статичная страница */
      }
    })();

    return () => {
      active = false;
      stop?.();
      void rpc('unwatch_match').catch(() => undefined);
    };
  }, [matchId]);

  // Тихий рефреш: деталь + события, без спиннеров и сброса вкладки.
  useEffect(() => {
    if (liveTick === 0 && manualTick === 0) return;
    let active = true;
    const requestId = reqRef.current;
    const automatic = manualTick === lastManualTick.current;
    lastManualTick.current = manualTick;
    void loadOptional('events', automatic).catch(() => undefined);
    if (!automatic || tab === 'stats') void loadOptional('stats', automatic);
    if (!automatic || tab === 'players') void loadOptional('players', automatic);
    if (!automatic || tab === 'lineups' || tab === 'tactics') {
      void loadOptional('lineups', automatic);
      if (automatic && tab === 'lineups') void loadOptional('players', automatic);
    }
    setRefreshingDetail(true);
    void (async () => {
      try {
        const reply = await api('pitch', `matches/${matchId}`, { automatic });
        const detail = (reply.payload?.data ?? reply.payload) as MatchDetail | null;
        if (detail && detail.home_team && detail.away_team) {
          if (!active || !mounted.current || requestId !== reqRef.current) return;
          setSources((prev) => ({
            ...prev,
            detail: { fetchedAt: reply.fetchedAt ?? null, stale: reply.stale },
          }));
          setLoaded((prev) => (prev.detail?.id === detail.id ? { ...prev, detail } : prev));
        }
      } catch {
        if (active && mounted.current && requestId === reqRef.current) {
          setSources((prev) =>
            prev.detail ? { ...prev, detail: { ...prev.detail, stale: true } } : prev,
          );
        }
      } finally {
        if (active && mounted.current && requestId === reqRef.current) setRefreshingDetail(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [liveTick, manualTick, matchId, loadOptional, tab]);

  const detail = loaded.detail;
  const tacticsOn = modules.tactics;
  // Сохранённая вкладка «Мои схемы» не открывается, пока тактическая доска выключена.
  const activeTab: TabKey = tab === 'tactics' && !tacticsOn ? 'overview' : tab;
  const sourceEntries = [
    ...Object.values(sources),
    ...(activeTab === 'analysis' && analysisSource ? [analysisSource] : []),
  ];
  const datedSources = sourceEntries
    .map((source) => source.fetchedAt)
    .filter((date): date is string => !!date && Number.isFinite(Date.parse(date)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const oldestSource = datedSources.length === sourceEntries.length ? datedSources[0] : null;

  if (loading) {
    return (
      <div className="match-detail">
        {onBack && (
          <button className="ghost-btn" onClick={onBack}>
            <ArrowLeft size={14} /> Назад
          </button>
        )}
        <LoadingBlock label="Загрузка матча и составов…" rows={5} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="match-detail">
        {onBack && (
          <button className="ghost-btn" onClick={onBack}>
            <ArrowLeft size={14} /> Назад
          </button>
        )}
        <ErrorBlock
          title="Матч недоступен"
          message={error ?? 'Пустой ответ'}
          onRetry={() => setRetry((value) => value + 1)}
        />
      </div>
    );
  }

  return (
    <div className="match-detail">
      <div className="md-topbar">
        {onBack && (
          <button className="ghost-btn" onClick={onBack}>
            <ArrowLeft size={14} /> Назад
          </button>
        )}
        <div className="muted small">
          {[detail.league?.name, detail.season].filter(Boolean).join(' · ')}
        </div>
        <button
          className="ghost-btn"
          disabled={refreshingDetail || Object.values(optionalLoading).some(Boolean)}
          onClick={() => setManualTick((value) => value + 1)}
        >
          Обновить данные
        </button>
      </div>

      <div className="md-header panel">
        <div className="md-team">
          <TeamBadge name={detail.home_team.name} imageUrl={detail.home_team.image_url} size={52} />
          <span>{detail.home_team.name}</span>
        </div>
        <div className="md-center">
          <strong className="md-score">
            <HiddenScore kind="football" id={detail.id}>
              {detail.score_home ?? '—'} : {detail.score_away ?? '—'}
            </HiddenScore>
          </strong>
          <span className="chip">{matchStatusLabel(detail.status)}</span>
          {classifyMatchStatus(detail.status) === 'live' && isTauriRuntime() && (
            <span className="chip live-watch-chip">
              <Radio size={10} className="watch-spin-slow" /> следим{' '}
              {liveAt ? `· обновлено ${formatUpdatedAt(liveAt, timezone)}` : '· автообновление'}
            </span>
          )}
          <span className="muted small">
            {formatHumanDateTime(detail.time_utc ?? detail.date, timezone)}
          </span>
        </div>
        <div className="md-team right">
          <span>{detail.away_team.name}</span>
          <TeamBadge name={detail.away_team.name} imageUrl={detail.away_team.image_url} size={52} />
        </div>
      </div>

      {hasMetadata(detail) && (
        <div className="md-meta-strip">
          <MatchMetadata detail={detail} />
        </div>
      )}
      <div className="md-actions">
        <WatchEventButton
          intent={{
            sport: 'football',
            key: `match:${detail.id}`,
            title: `${detail.home_team.name} — ${detail.away_team.name}`,
          }}
        />
        <DiaryMarkButton event={footballDiaryEvent(detail)} />
        <PredictionPanel key={detail.id} detail={detail} compact />
        <SpoilerToggle
          kind="football"
          id={detail.id}
          label={`${detail.home_team.name} — ${detail.away_team.name}`}
          eventTime={detail.time_utc ?? detail.date}
          compact
        />
      </div>
      <div className="md-tabs" role="tablist" aria-label="Разделы матча">
        {(['overview', 'events', 'lineups', 'stats', 'players', 'analysis', 'tactics'] as const)
          .filter((k) => k !== 'tactics' || tacticsOn)
          .map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={activeTab === k}
              className={activeTab === k ? 'active' : ''}
              onClick={() => setTab(k)}
            >
              {k === 'overview'
                ? 'Сводка'
                : k === 'events'
                  ? 'События'
                  : k === 'lineups'
                    ? 'Поле и оценки'
                    : k === 'stats'
                      ? 'Статистика'
                      : k === 'players'
                        ? 'Игроки'
                        : k === 'analysis'
                          ? 'Разбор матча'
                          : 'Мои схемы'}
            </button>
          ))}
      </div>

      <SpoilerGate
        kind="football"
        id={detail.id}
        bypass={classifyMatchStatus(detail.status) === 'scheduled'}
      >
        <SectionBoundary resetKey={`${matchId}.${activeTab}`} name="Вкладка матча">
          {activeTab !== 'overview' &&
          optionalLoading[activeTab] &&
          ((activeTab === 'stats' && !loaded.stats) ||
            (activeTab === 'lineups' && !loaded.lineups) ||
            (activeTab === 'players' && !loaded.players.length) ||
            (activeTab === 'events' && !loaded.events)) ? (
            <LoadingBlock
              label={
                activeTab === 'lineups'
                  ? 'Загружаем составы и расстановку…'
                  : activeTab === 'stats'
                    ? 'Загружаем статистику матча…'
                    : activeTab === 'players'
                      ? 'Загружаем показатели игроков…'
                      : 'Загружаем события матча…'
              }
              rows={3}
            />
          ) : (
            <>
              {activeTab === 'tactics' && tacticsOn && (
                <TacticsBoard
                  key={matchId}
                  detail={detail}
                  payload={loaded.lineups}
                  loading={optionalLoading.lineups}
                  error={optionalErrors.lineups}
                />
              )}
              {activeTab === 'analysis' && (
                <MatchAnalysis
                  key={matchId}
                  detail={detail}
                  liveTick={liveTick}
                  refreshToken={manualTick}
                  onSourceStatus={updateAnalysisSource}
                />
              )}
              {activeTab === 'overview' && (
                <Overview
                  detail={detail}
                  events={loaded.events}
                  stats={loaded.stats}
                  timezone={timezone}
                />
              )}
              {activeTab === 'events' && (
                <EventsTab payload={loaded.events} error={optionalErrors.events} detail={detail} />
              )}
              {activeTab === 'lineups' && (
                <MatchLineups
                  detail={detail}
                  payload={loaded.lineups}
                  entries={loaded.players}
                  error={optionalErrors.lineups}
                  playersError={optionalErrors.players}
                  playersLoading={optionalLoading.players}
                  onOpenTactics={tacticsOn ? () => setTab('tactics') : undefined}
                />
              )}
              {activeTab === 'stats' && (
                <MatchStatsTab
                  payload={loaded.stats}
                  error={optionalErrors.stats}
                  detail={detail}
                />
              )}
              {activeTab === 'players' && (
                <PlayersTab
                  key={matchId}
                  entries={loaded.players}
                  error={optionalErrors.players}
                  detail={detail}
                  seasonMatches={seasonMatches}
                  onOpenMatch={onOpenMatch}
                />
              )}
            </>
          )}
        </SectionBoundary>
        <SectionBoundary resetKey={`${matchId}.comparison`} name="Сравнение игроков">
          <MatchPlayersComparison detail={detail} entries={loaded.players} />
        </SectionBoundary>
      </SpoilerGate>
      <SourceLine
        role="status"
        sources={['pitch']}
        fetchedAt={oldestSource}
        oldest
        stale={sourceEntries.some((source) => source.stale)}
        timezone={timezone}
      />
    </div>
  );
}

function hasMetadata(detail: MatchDetail) {
  return !!(detail.round_name || detail.stadium || detail.referee);
}

/** Тур или стадия, стадион и арбитр. Дата не повторяется: она уже стоит рядом со счётом. */
function MatchMetadata({ detail }: { detail: MatchDetail }) {
  const round = detail.round_name
    ? ((
        {
          final: 'Финал',
          '1/2': 'Полуфинал',
          '1/4': 'Четвертьфинал',
          '1/8': '1/8 финала',
          '1/16': 'Стыковые матчи',
        } as Record<string, string>
      )[detail.round_name.toLowerCase()] ?? `Тур ${detail.round_name}`)
    : null;
  return (
    <>
      {round && <span className="muted small">{round}</span>}
      {detail.stadium && <span className="muted small">{detail.stadium}</span>}
      {detail.referee && <span className="muted small">Арбитр: {detail.referee}</span>}
    </>
  );
}

function Overview({
  detail,
  events,
  stats,
  timezone,
}: {
  detail: MatchDetail;
  events: EventsPayload | null;
  stats: StatsPayload | null;
  timezone: string;
}) {
  const eventsList = events?.events ?? [];
  const goals = eventsList.filter((e) => e.event_type === 'goal');
  const cards = eventsList.filter(
    (e) => e.event_type === 'yellowcard' || e.event_type === 'redcard',
  );
  const allPeriod = stats?.periods?.find((p) => p.period === 'All');
  const allGroups: StatGroup[] = allPeriod?.groups ?? [];

  const summaryLines: string[] = [];
  if (detail.status === 'finished') {
    summaryLines.push(
      `${detail.home_team.name} — ${detail.away_team.name}, счёт ${detail.score_home ?? '—'}:${detail.score_away ?? '—'}.`,
    );
    if (goals.length > 0) {
      summaryLines.push(
        'Голы: ' +
          goals
            .map(
              (g) =>
                `${g.minute}′ ${g.player?.name ?? '—'}${g.is_penalty ? ' (пен.)' : ''}${g.is_own_goal ? ' (авт.)' : ''}`,
            )
            .join(', ') +
          '.',
      );
    } else if (events?.events) {
      summaryLines.push('Голы не указаны.');
    } else {
      summaryLines.push('События матча пока недоступны.');
    }
    if (cards.length > 0) {
      summaryLines.push(
        'Карточки: ' +
          cards
            .map(
              (c) =>
                `${c.minute}′ ${c.player?.name ?? '—'} (${c.event_type === 'yellowcard' ? 'жёлтая' : 'красная'})`,
            )
            .join(', ') +
          '.',
      );
    }
    const fouls = allGroups.flatMap((g) => g.items).find((i) => i.key === 'fouls');
    if (fouls) {
      summaryLines.push(`Фолы: ${fouls.home} — ${fouls.away}.`);
    }
  } else {
    summaryLines.push(
      `Начало ${formatHumanDateTime(detail.time_utc ?? detail.date, timezone)} · ${matchStatusLabel(detail.status)}.`,
    );
  }

  return (
    <div className="md-overview">
      <section className="panel">
        <div className="section-title">
          <h2>Сводка матча</h2>
        </div>
        {summaryLines.map((line, i) => (
          <p key={i} className="summary-p">
            {line}
          </p>
        ))}
      </section>

      {goals.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <h2>Хронология голов</h2>
          </div>
          <ul className="timeline">
            {goals.map((g, i) => (
              <li key={i}>
                <span className="t-min">{g.minute}′</span>
                <span className="t-team">
                  {g.team_id === detail.home_team.id
                    ? detail.home_team.name
                    : detail.away_team.name}
                </span>
                <span>{g.player?.name ?? '—'}</span>
                {g.is_penalty && <span className="chip">пенальти</span>}
                {g.is_own_goal && <span className="chip">автогол</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EventsTab({
  payload,
  error,
  detail,
}: {
  payload: EventsPayload | null;
  error?: string;
  detail: MatchDetail;
}) {
  if (error) return <EmptyBlock title="События недоступны" message={error} />;
  if (!payload?.events || payload.events.length === 0)
    return <EmptyBlock title="Лента событий пуста" />;
  return (
    <div className="panel">
      <ul className="event-list">
        {payload.events.map((ev, i) => (
          <EventRow key={i} ev={ev} detail={detail} />
        ))}
      </ul>
    </div>
  );
}

function EventRow({ ev, detail }: { ev: MatchEvent; detail: MatchDetail }) {
  return (
    <li className={`event-row ${ev.event_type}`}>
      <span className="event-min">
        {ev.minute}
        {ev.minute_added ? `+${ev.minute_added}` : ''}′
      </span>
      <span className="event-type">{labelEvent(ev.event_type)}</span>
      <span className="event-team">
        {ev.team_id === detail.home_team.id
          ? detail.home_team.name
          : ev.team_id === detail.away_team.id
            ? detail.away_team.name
            : '—'}
      </span>
      <span className="event-player">{ev.player?.name ?? '—'}</span>
      {ev.event_type === 'goal' && (
        <span className="event-score muted">
          {ev.score_home ?? '—'}:{ev.score_away ?? '—'}
        </span>
      )}
    </li>
  );
}

function labelEvent(type: string): string {
  const map: Record<string, string> = {
    goal: 'Гол',
    yellowcard: 'Жёлтая',
    redcard: 'Красная',
    substitution: 'Замена',
    penalty: 'Пенальти',
    own_goal: 'Автогол',
  };
  return map[type] ?? type;
}
