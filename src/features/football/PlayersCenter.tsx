import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Star, X } from 'lucide-react';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import { fetchTeamHistory, type HistoryMatch } from './history';
import { fetchPlayerSeasonStats, type PlayerSeasonStats } from './playerAnalytics';
import { statLabel } from './statLabels';
import { PersonAvatar } from '../../components/PersonAvatar';
import { SourceLine } from '../../components/SourceLine';
import { useViewState } from '../../lib/useViewState';
import { ClubPlayers } from './ClubPlayers';
import { SavedPlayerProfile } from './SavedPlayerProfile';
import type { UseFootballResult } from './useFootballData';
import type { FavoritePlayer, MatchSummary, TeamRef } from './types';
import { useFavorites } from './FavoritesProvider';
import './players.css';

/**
 * №6: Единый центр игроков — cross-league. Любимые игроки со всех лиг;
 * сезонная статистика собирается по матчам команды из ЛОКАЛЬНОЙ ИСТОРИИ
 * (все загруженные лиги), а не только текущего турнира; два игрока можно
 * сравнить бок о бок.
 */

function historyToSummary(m: HistoryMatch): MatchSummary {
  return {
    id: m.id,
    status: m.status,
    home_team: { id: m.homeId, name: m.homeName } as TeamRef,
    away_team: { id: m.awayId, name: m.awayName } as TeamRef,
    score_home: m.homeScore >= 0 ? m.homeScore : null,
    score_away: m.awayScore >= 0 ? m.awayScore : null,
    date: m.date,
    time_utc: undefined,
  };
}

interface PlayerCard {
  player: FavoritePlayer;
  stats: PlayerSeasonStats | null;
  busy: boolean;
  error: string | null;
  retry: () => void;
}

function usePlayerSeason(
  player: FavoritePlayer | null,
  loadedMatches: MatchSummary[],
): Omit<PlayerCard, 'player'> {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const [state, setState] = useState<{
    pid: string;
    tid: string;
    matches: MatchSummary[];
    attempt: number;
    stats: PlayerSeasonStats | null;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const pid = player?.id;
  const tid = player?.teamId;

  useEffect(() => {
    if (!pid || !tid) return;
    let active = true;
    const key = { pid, tid, matches: loadedMatches, attempt };
    setState({ ...key, busy: true, error: null, stats: null });
    void (async () => {
      try {
        // Матчи команды во ВСЕХ лигах из локальной истории.
        const history = await fetchTeamHistory(tid, true);
        if (!active) return;
        const byId = new Map(history.map((m) => [m.id, historyToSummary(m)]));
        for (const m of loadedMatches) byId.set(m.id, m);
        const matches = [...byId.values()];
        if (matches.length === 0) {
          throw new Error('Матчей команды в истории ещё нет — откройте её лигу хотя бы раз.');
        }
        const result = await fetchPlayerSeasonStats(pid, tid, matches);
        if (active) setState({ ...key, stats: result, busy: false, error: null });
      } catch (e) {
        if (active)
          setState({
            ...key,
            stats: null,
            busy: false,
            error: e instanceof Error ? e.message : 'Статистика недоступна.',
          });
      }
    })();
    return () => {
      active = false;
    };
  }, [pid, tid, loadedMatches, attempt]);

  const current =
    state &&
    state.pid === pid &&
    state.tid === tid &&
    state.matches === loadedMatches &&
    state.attempt === attempt
      ? state
      : null;
  return {
    stats: current?.stats ?? null,
    busy: current?.busy ?? Boolean(pid && tid),
    error: current?.error ?? null,
    retry,
  };
}

function PlayerCardView({
  player,
  onCompare,
  compareSlot,
  comparisonFull,
  matches,
  onOpen,
  onRemove,
}: {
  player: FavoritePlayer;
  onCompare: () => void;
  compareSlot: 1 | 2 | null;
  comparisonFull: boolean;
  matches: MatchSummary[];
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { stats, busy, error, retry } = usePlayerSeason(player, matches);
  return (
    <section className="panel pc-card">
      <div className="pc-head">
        <button
          className="player-photo-button"
          onClick={onOpen}
          aria-label={`Статистика: ${player.name}`}
        >
          <PersonAvatar name={player.name} src={player.imageUrl} size={52} />
        </button>
        <div className="pc-title">
          <button className="player-name-button" onClick={onOpen}>
            <strong>{player.name}</strong>
            <small>Профиль и статистика →</small>
          </button>
          <span className="muted small">{player.teamName ?? '—'}</span>
        </div>
        <button
          className="player-favorite active"
          aria-label={`Убрать из избранного: ${player.name}`}
          onClick={onRemove}
        >
          <Star size={16} fill="currentColor" />
        </button>
      </div>

      <div className="pc-scope">
        <strong>
          {stats
            ? `Сводка по ${stats.available} ${stats.available % 10 === 1 && stats.available % 100 !== 11 ? 'матчу' : 'матчам'} с данными`
            : 'Сводка по загруженным матчам'}
        </strong>
        <span>Суммы и средние показатели по матчам команды. Это не статистика одной встречи.</span>
      </div>

      {busy && <LoadingBlock label="Собираем статистику по всем лигам…" rows={2} />}
      {error && <ErrorBlock title="Статистика недоступна" message={error} onRetry={retry} />}
      {stats && stats.metrics.length === 0 && !busy && (
        <p className="muted small">Провайдер не вернул показатели игрока в матчах истории.</p>
      )}
      {stats && stats.metrics.length > 0 && (
        <div className="pc-metrics">
          {stats.metrics.slice(0, 8).map((m) => (
            <div className="pc-metric" key={m.key}>
              <span className="muted small">{statLabel(m.key, m.label)}</span>
              <strong>
                {m.value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                {m.kind === 'fraction' ? '%' : ''}
              </strong>
              <small className="muted">{m.matches} матч.</small>
            </div>
          ))}
        </div>
      )}
      {stats && (
        <p className="muted small pc-foot">
          {stats.minutes} известных минут · проверено {stats.scanned} из {stats.totalCandidates}{' '}
          матчей
          {stats.failed ? ` · ${stats.failed} ответов недоступно` : ''}
        </p>
      )}
      {player.matchLabel && (
        <p className="pc-origin muted small">
          Сохранён из матча: <span>{player.matchLabel}</span>
        </p>
      )}
      <div className="pc-actions">
        <button className="ghost-btn" onClick={onOpen}>
          Открыть профиль
        </button>
        <button
          className={`ghost-btn ${compareSlot ? 'active' : ''}`}
          onClick={onCompare}
          aria-pressed={!!compareSlot}
          aria-label={`${compareSlot ? 'Убрать из сравнения' : 'Сравнить'}: ${player.name}`}
          disabled={!compareSlot && comparisonFull}
          title={
            !compareSlot && comparisonFull
              ? 'Сначала уберите одного игрока из сравнения'
              : compareSlot
                ? 'Убрать игрока из сравнения'
                : 'Добавить игрока в сравнение'
          }
        >
          <ArrowLeftRight size={14} /> {compareSlot ? 'В сравнении · убрать' : 'Сравнить'}
        </button>
      </div>
    </section>
  );
}

function ComparisonRow({
  label,
  a,
  b,
  percent,
}: {
  label: string;
  a: number | null;
  b: number | null;
  percent: boolean;
}) {
  const winner = a !== null && b !== null && a !== b ? (a > b ? 'a' : 'b') : null;
  return (
    <div className="pc-compare-row">
      <strong className={winner === 'a' ? 'pc-win' : ''}>
        {a?.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ?? '—'}
        {percent && a !== null ? '%' : ''}
      </strong>
      <span className="muted small">{label}</span>
      <strong className={winner === 'b' ? 'pc-win' : ''}>
        {b?.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ?? '—'}
        {percent && b !== null ? '%' : ''}
      </strong>
    </div>
  );
}

function ComparePanel({ a, b, onClose }: { a: PlayerCard; b: PlayerCard; onClose: () => void }) {
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of [...(a.stats?.metrics ?? []), ...(b.stats?.metrics ?? [])]) {
      if (!map.has(m.key)) map.set(m.key, statLabel(m.key, m.label));
    }
    return Array.from(map.entries()).slice(0, 12);
  }, [a.stats, b.stats]);

  return (
    <section className="panel pc-compare">
      <div className="section-title">
        <h2>
          <ArrowLeftRight size={15} /> {a.player.name} и {b.player.name}
        </h2>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть сравнение">
          <X size={16} />
        </button>
      </div>
      <p className="muted small">
        Показатели по загруженным матчам команд. Количество матчей может различаться.
      </p>
      {(a.busy || b.busy) && <LoadingBlock label="Собираем данные для сравнения…" rows={2} />}
      {a.error && (
        <ErrorBlock title={`Нет данных: ${a.player.name}`} message={a.error} onRetry={a.retry} />
      )}
      {b.error && (
        <ErrorBlock title={`Нет данных: ${b.player.name}`} message={b.error} onRetry={b.retry} />
      )}
      <div className="pc-compare-head">
        <span>
          {a.player.name}
          <small>
            {a.stats
              ? `Матчей с данными: ${a.stats.available}`
              : a.error
                ? 'Данные недоступны'
                : 'Загружаем данные'}
          </small>
        </span>
        <span className="muted small">показатель</span>
        <span>
          {b.player.name}
          <small>
            {b.stats
              ? `Матчей с данными: ${b.stats.available}`
              : b.error
                ? 'Данные недоступны'
                : 'Загружаем данные'}
          </small>
        </span>
      </div>
      {labels.map(([key, label]) => (
        <ComparisonRow
          key={key}
          label={label}
          percent={
            a.stats?.metrics.find((m) => m.key === key)?.kind === 'fraction' ||
            b.stats?.metrics.find((m) => m.key === key)?.kind === 'fraction'
          }
          a={a.stats?.metrics.find((m) => m.key === key)?.value ?? null}
          b={b.stats?.metrics.find((m) => m.key === key)?.value ?? null}
        />
      ))}
      {labels.length === 0 && !a.busy && !b.busy && !a.error && !b.error && (
        <p className="muted small">Провайдер не вернул показатели для сравнения.</p>
      )}
    </section>
  );
}

function ComparisonPicker({
  players,
  a,
  b,
  onPick,
  onClear,
}: {
  players: FavoritePlayer[];
  a: FavoritePlayer | null;
  b: FavoritePlayer | null;
  onPick: (side: 0 | 1, id: string) => void;
  onClear: () => void;
}) {
  const count = Number(!!a) + Number(!!b);
  return (
    <section className="panel pc-picker" aria-label="Выбор игроков для сравнения">
      <div className="section-title">
        <h2>
          <ArrowLeftRight size={16} /> Сравнение игроков
        </h2>
        {count > 0 && (
          <button className="ghost-btn" onClick={onClear}>
            Сбросить выбор
          </button>
        )}
      </div>
      <p className="muted small" role="status">
        {players.length < 2
          ? 'Для сравнения добавьте ещё одного футболиста в избранное: выберите клуб ниже и нажмите звёздочку у игрока.'
          : count === 0
            ? 'Выберите двух футболистов здесь или нажмите «Сравнить» на их карточках.'
            : count === 1
              ? 'Один игрок выбран. Выберите второго футболиста — ниже появится сравнение.'
              : 'Оба игрока выбраны. Сравнение показано ниже; для замены измените выбор в списке.'}
      </p>
      <div className="pc-picker-grid">
        {([a, b] as const).map((player, side) => (
          <div className="pc-picker-slot" key={side}>
            {player && <PersonAvatar name={player.name} src={player.imageUrl} size={44} />}
            <label>
              <span>{side === 0 ? 'Первый игрок' : 'Второй игрок'}</span>
              <select
                aria-label={`${side === 0 ? 'Первый' : 'Второй'} игрок для сравнения`}
                value={player?.id ?? ''}
                onChange={(e) => onPick(side as 0 | 1, e.target.value)}
              >
                <option value="">Выберите игрока</option>
                {players
                  .filter((p) => p.id !== (side === 0 ? b?.id : a?.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.teamName ?? 'Клуб не указан'}
                    </option>
                  ))}
              </select>
            </label>
            {player && (
              <button
                className="icon-button"
                aria-label={`Убрать из сравнения: ${player.name}`}
                onClick={() => onPick(side as 0 | 1, '')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function useCard(player: FavoritePlayer | null, matches: MatchSummary[]): PlayerCard {
  const { stats, busy, error, retry } = usePlayerSeason(player, matches);
  return useMemo(
    () => ({
      player: (player ?? { id: '', name: '—', savedAt: '' }) as FavoritePlayer,
      stats,
      busy,
      error,
      retry,
    }),
    [player, stats, busy, error, retry],
  );
}

export function PlayersCenter({
  data,
  onOpenMatch,
}: {
  data: UseFootballResult;
  onOpenMatch: (id: string) => void;
}) {
  const { favoritePlayers, togglePlayer } = useFavorites();
  const [slotAId, setSlotAId] = useViewState<string | null>(
    'players.compare.a',
    null,
    (v) => v === null || typeof v === 'string',
  );
  const [slotBId, setSlotBId] = useViewState<string | null>(
    'players.compare.b',
    null,
    (v) => v === null || typeof v === 'string',
  );
  const slotA = favoritePlayers.find((p) => p.id === slotAId) ?? null;
  const slotB = favoritePlayers.find((p) => p.id === slotBId && p.id !== slotAId) ?? null;

  const cardA = useCard(slotA, data.allMatches);
  const cardB = useCard(slotB, data.allMatches);
  const [clubId, setClubId] = useViewState<string>(
    'players.club',
    '',
    (v) => typeof v === 'string',
  );
  const [selectedId, setSelectedId] = useViewState<string | null>(
    'players.selected',
    null,
    (v) => v === null || typeof v === 'string',
  );
  const selected = favoritePlayers.find((p) => p.id === selectedId);
  const [requestedPlayer] = useViewState<FavoritePlayer | null>('players.requested', null);
  const profilePlayer = selected ?? (requestedPlayer?.id === selectedId ? requestedPlayer : null);
  const club = data.teams.find((t) => t.id === clubId);

  const shown = favoritePlayers;

  const setSlot = (p: FavoritePlayer) => {
    if (slotA?.id === p.id) {
      setSlotAId(null);
      return;
    }
    if (slotB?.id === p.id) {
      setSlotBId(null);
      return;
    }
    if (!slotA) {
      setSlotAId(p.id);
      return;
    }
    if (!slotB) setSlotBId(p.id);
  };
  const clearComparison = () => {
    setSlotAId(null);
    setSlotBId(null);
  };

  if (profilePlayer)
    return (
      <SavedPlayerProfile
        key={profilePlayer.id}
        player={profilePlayer}
        matches={data.allMatches}
        onOpenMatch={onOpenMatch}
        onBack={() => setSelectedId(null)}
      />
    );

  return (
    <div className="players-view">
      <div className="dashboard-head">
        <div>
          <h1>Игроки</h1>
          <p className="muted small">Избранные футболисты и сравнение.</p>
        </div>
      </div>

      <h2>Избранные игроки · {shown.length}</h2>
      {shown.length > 0 && (
        <ComparisonPicker
          players={shown}
          a={slotA}
          b={slotB}
          onClear={clearComparison}
          onPick={(side, id) => {
            if (
              id &&
              (!favoritePlayers.some((p) => p.id === id) ||
                id === (side === 0 ? slotB?.id : slotA?.id))
            )
              return;
            (side === 0 ? setSlotAId : setSlotBId)(id || null);
          }}
        />
      )}
      {slotA && slotB && <ComparePanel a={cardA} b={cardB} onClose={clearComparison} />}

      {shown.length === 0 && (
        <EmptyBlock
          title="Избранных игроков пока нет"
          message="Выберите клуб ниже и отметьте игроков звёздочкой."
        />
      )}

      <div className="pc-grid">
        {shown.map((p) => (
          <PlayerCardView
            key={p.id}
            player={p}
            matches={data.allMatches}
            onOpen={() => setSelectedId(p.id)}
            onRemove={() => {
              togglePlayer(p);
              if (slotA?.id === p.id) setSlotAId(null);
              if (slotB?.id === p.id) setSlotBId(null);
              if (selectedId === p.id) setSelectedId(null);
            }}
            onCompare={() => setSlot(p)}
            compareSlot={slotA?.id === p.id ? 1 : slotB?.id === p.id ? 2 : null}
            comparisonFull={!!slotA && !!slotB}
          />
        ))}
      </div>

      <section className="panel player-directory">
        <h2>Найти игрока</h2>
        {!data.teams.length && (data.matchesLoading || data.leaguesLoading) && (
          <LoadingBlock label="Загружаем каталог клубов…" rows={1} />
        )}
        {!data.teams.length && data.matchesError && (
          <ErrorBlock
            title="Каталог клубов недоступен"
            message={data.matchesError}
            onRetry={data.reload}
          />
        )}
        <label>
          Клуб{' '}
          <select
            aria-label="Клуб для выбора игроков"
            value={clubId}
            onChange={(e) => {
              setClubId(e.target.value);
              setSelectedId(null);
            }}
          >
            <option value="">Выберите клуб</option>
            {data.leagues.map((l) => (
              <optgroup key={l.id} label={l.name}>
                {data.teams
                  .filter((t) => t.leagueId === l.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </section>
      {club && (
        <ClubPlayers
          key={club.id}
          team={club}
          matches={data.allMatches}
          onOpenMatch={onOpenMatch}
        />
      )}
      <SourceLine sources={['pitch']} fetchedAt={data.fetchedAt} stale={data.stale} />
    </div>
  );
}

export default PlayersCenter;
