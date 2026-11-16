import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChevronRight, Star, X } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Panel,
  PanelHeader,
  SearchSelect,
  Skeleton,
  type SearchSelectOption,
} from '../../kit';
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
 * (все загруженные лиги); два игрока можно сравнить бок о бок.
 */

const CLUB_PREFIX = 'club:';
const PLAYER_PREFIX = 'player:';

/** Metrics where a smaller number is better; every other metric is better when larger. */
const LOWER_IS_BETTER = new Set([
  'fouls',
  'red_cards',
  'yellow_cards',
  'yellow_red_cards',
  'redcard',
  'yellowcard',
  'dispossessed',
  'own_goals',
  'penalties_conceded',
  'penalties_missed',
  'errors_led_to_goal',
  'errors_lead_to_shot',
  'goals_conceded',
  'shots_off_target',
  'shotsofftarget',
  'offsides',
  'dribbled_past',
  'duel_lost',
  'big_chance_missed_title',
]);

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

function formatNumber(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function metricText(value: number | null, percent: boolean): string {
  return value === null ? '—' : `${formatNumber(value)}${percent ? '%' : ''}`;
}

function FavoritePlayerRow({
  player,
  onOpen,
  onRemove,
  onCompare,
  compareSlot,
  comparisonFull,
  canCompare,
}: {
  player: FavoritePlayer;
  onOpen: () => void;
  onRemove: () => void;
  onCompare: () => void;
  compareSlot: 1 | 2 | null;
  comparisonFull: boolean;
  canCompare: boolean;
}) {
  const compareLabel = compareSlot ? 'В сравнении · убрать' : 'Сравнить';
  return (
    <li className="players-favorites__row">
      <Button
        variant="quiet"
        className="players-favorites__open"
        onClick={onOpen}
        aria-label={`Профиль и статистика: ${player.name}`}
      >
        <PersonAvatar name={player.name} src={player.imageUrl} size={32} />
        <span className="players-favorites__text">
          <strong>{player.name}</strong>
          <small>{player.teamName ?? 'Клуб не указан'}</small>
        </span>
        <ChevronRight size={15} aria-hidden="true" />
      </Button>
      {canCompare && (
        <Button
          small
          variant="quiet"
          className="players-favorites__compare"
          aria-pressed={compareSlot !== null}
          aria-label={`${compareLabel}: ${player.name}`}
          title={
            compareSlot
              ? 'Убрать игрока из сравнения'
              : comparisonFull
                ? 'Сначала уберите одного игрока из сравнения'
                : 'Добавить игрока в сравнение'
          }
          disabled={!compareSlot && comparisonFull}
          onClick={onCompare}
          icon={<ArrowLeftRight size={14} aria-hidden="true" />}
        >
          {compareLabel}
        </Button>
      )}
      <IconButton
        aria-label={`Убрать из избранного: ${player.name}`}
        aria-pressed
        onClick={onRemove}
        icon={<Star size={16} fill="currentColor" aria-hidden="true" />}
      />
    </li>
  );
}

function FavoritePlayersPanel({
  players,
  onOpen,
  onRemove,
  onCompare,
  compareSlot,
  comparisonFull,
  canCompare,
}: {
  players: FavoritePlayer[];
  onOpen: (player: FavoritePlayer) => void;
  onRemove: (player: FavoritePlayer) => void;
  onCompare: (player: FavoritePlayer) => void;
  compareSlot: (player: FavoritePlayer) => 1 | 2 | null;
  comparisonFull: boolean;
  canCompare: boolean;
}) {
  if (players.length === 0) return null;
  return (
    <Panel className="players-favorites" aria-label="Избранные игроки">
      <PanelHeader
        title={
          <span className="players-favorites__title">
            Избранные игроки <Badge>{players.length}</Badge>
          </span>
        }
      />
      <ul className="players-favorites__list">
        {players.map((player) => (
          <FavoritePlayerRow
            key={player.id}
            player={player}
            onOpen={() => onOpen(player)}
            onRemove={() => onRemove(player)}
            onCompare={() => onCompare(player)}
            compareSlot={compareSlot(player)}
            comparisonFull={comparisonFull}
            canCompare={canCompare}
          />
        ))}
      </ul>
    </Panel>
  );
}

function ComparisonRow({
  label,
  a,
  b,
  percent,
  keyName,
}: {
  label: string;
  a: number | null;
  b: number | null;
  percent: boolean;
  keyName: string;
}) {
  const lower = LOWER_IS_BETTER.has(keyName.trim().toLowerCase());
  let winner: 'a' | 'b' | null = null;
  if (a !== null && b !== null && a !== b) {
    winner = lower ? (a < b ? 'a' : 'b') : a > b ? 'a' : 'b';
  }
  const cell = (value: number | null, side: 'a' | 'b') => (
    <td className="ui-table__num">
      <span className={winner === side ? 'players-compare__best' : undefined}>
        {metricText(value, percent)}
        {winner === side && <span className="visually-hidden">лучше</span>}
      </span>
    </td>
  );
  return (
    <tr>
      <td>{label}</td>
      {cell(a, 'a')}
      {cell(b, 'b')}
    </tr>
  );
}

function CompareContent({
  a,
  b,
  onOpen,
}: {
  a: PlayerCard;
  b: PlayerCard;
  onOpen: (player: FavoritePlayer) => void;
}) {
  const labels = useMemo(() => {
    const map = new Map<string, { label: string; percent: boolean }>();
    for (const m of [...(a.stats?.metrics ?? []), ...(b.stats?.metrics ?? [])]) {
      if (map.has(m.key)) {
        if (m.kind === 'fraction') map.get(m.key)!.percent = true;
        continue;
      }
      map.set(m.key, { label: statLabel(m.key, m.label), percent: m.kind === 'fraction' });
    }
    return Array.from(map.entries()).slice(0, 12);
  }, [a.stats, b.stats]);

  const dataNote = (card: PlayerCard) =>
    card.stats
      ? `Матчей с данными: ${card.stats.available}`
      : card.error
        ? 'Данные недоступны'
        : 'Загружаем данные';

  return (
    <>
      {(a.busy || b.busy) && (
        <div className="players-compare__loading" role="status">
          <Skeleton className="players-compare__skeleton" />
          <Skeleton className="players-compare__skeleton" />
          <Skeleton className="players-compare__skeleton" />
          <span className="visually-hidden">Собираем данные для сравнения…</span>
        </div>
      )}
      {a.error && (
        <EmptyState
          tone="error"
          title={`Нет данных: ${a.player.name}`}
          message={a.error}
          action={
            <Button variant="quiet" onClick={a.retry}>
              Повторить
            </Button>
          }
        />
      )}
      {b.error && (
        <EmptyState
          tone="error"
          title={`Нет данных: ${b.player.name}`}
          message={b.error}
          action={
            <Button variant="quiet" onClick={b.retry}>
              Повторить
            </Button>
          }
        />
      )}
      <div className="ui-table-scroll players-compare__table">
        <table className="ui-table">
          <thead>
            <tr>
              <th scope="col">Показатель</th>
              <th scope="col" className="ui-table__num">
                <Button
                  small
                  className="players-compare__open"
                  onClick={() => onOpen(a.player)}
                  aria-label={`Открыть профиль: ${a.player.name}`}
                  title="Открыть профиль"
                >
                  {a.player.name}
                </Button>
                <span className="players-compare__matches">{dataNote(a)}</span>
              </th>
              <th scope="col" className="ui-table__num">
                <Button
                  small
                  className="players-compare__open"
                  onClick={() => onOpen(b.player)}
                  aria-label={`Открыть профиль: ${b.player.name}`}
                  title="Открыть профиль"
                >
                  {b.player.name}
                </Button>
                <span className="players-compare__matches">{dataNote(b)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {labels.map(([key, item]) => (
              <ComparisonRow
                key={key}
                keyName={key}
                label={item.label}
                percent={item.percent}
                a={a.stats?.metrics.find((m) => m.key === key)?.value ?? null}
                b={b.stats?.metrics.find((m) => m.key === key)?.value ?? null}
              />
            ))}
          </tbody>
        </table>
      </div>
      {labels.length === 0 && !a.busy && !b.busy && !a.error && !b.error && (
        <p className="players-note">Источник не вернул показатели для сравнения.</p>
      )}
    </>
  );
}

function ComparisonPanel({
  players,
  a,
  b,
  cardA,
  cardB,
  onPick,
  onOpen,
  onClear,
}: {
  players: FavoritePlayer[];
  a: FavoritePlayer | null;
  b: FavoritePlayer | null;
  cardA: PlayerCard;
  cardB: PlayerCard;
  onPick: (side: 0 | 1, id: string) => void;
  onOpen: (player: FavoritePlayer) => void;
  onClear: () => void;
}) {
  const options = useMemo<SearchSelectOption[]>(() => {
    const groups = new Map<string, SearchSelectOption[]>();
    for (const player of players) {
      const group = player.teamName ?? 'Клуб не указан';
      const list = groups.get(group) ?? [];
      list.push({ value: player.id, label: player.name, group });
      groups.set(group, list);
    }
    return [...groups.values()].flat();
  }, [players]);
  const count = Number(!!a) + Number(!!b);
  return (
    <Panel className="players-compare-picker" aria-label="Сравнение игроков">
      <PanelHeader
        title="Сравнение игроков"
        action={
          count > 0 ? (
            <Button variant="quiet" onClick={onClear}>
              <X size={14} aria-hidden="true" /> Сбросить выбор
            </Button>
          ) : undefined
        }
      />
      <div className="players-compare-picker__fields">
        <div className="players-compare-picker__field">
          <span className="players-compare-picker__label">Первый игрок</span>
          <SearchSelect
            ariaLabel="Первый игрок для сравнения"
            value={a?.id ?? ''}
            options={options.filter((option) => option.value !== b?.id)}
            onChange={(id) => onPick(0, id)}
            placeholder="Выберите игрока"
          />
        </div>
        <div className="players-compare-picker__field">
          <span className="players-compare-picker__label">Второй игрок</span>
          <SearchSelect
            ariaLabel="Второй игрок для сравнения"
            value={b?.id ?? ''}
            options={options.filter((option) => option.value !== a?.id)}
            onChange={(id) => onPick(1, id)}
            placeholder="Выберите игрока"
          />
        </div>
      </div>
      {a && b ? (
        <CompareContent a={{ ...cardA, player: a }} b={{ ...cardB, player: b }} onOpen={onOpen} />
      ) : (
        <p className="players-note" role="status">
          Выберите двух игроков здесь или нажмите «Сравнить» в их строке.
        </p>
      )}
    </Panel>
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
  const [requestedPlayer, setRequestedPlayer] = useViewState<FavoritePlayer | null>(
    'players.requested',
    null,
  );
  const profilePlayer = selected ?? (requestedPlayer?.id === selectedId ? requestedPlayer : null);
  const club = data.teams.find((t) => t.id === clubId);
  const [clubDetailOpen, setClubDetailOpen] = useState(false);

  const directoryOptions = useMemo<SearchSelectOption[]>(() => {
    const options: SearchSelectOption[] = favoritePlayers.map((player) => ({
      value: `${PLAYER_PREFIX}${player.id}`,
      label: player.name,
      group: 'Избранные игроки',
    }));
    for (const team of data.teams)
      options.push({
        value: `${CLUB_PREFIX}${team.id}`,
        label: team.name,
        group: team.leagueName,
      });
    return options;
  }, [data.teams, favoritePlayers]);

  const directoryValue = selectedId
    ? `${PLAYER_PREFIX}${selectedId}`
    : club && clubId
      ? `${CLUB_PREFIX}${clubId}`
      : '';

  const pickDirectory = (value: string) => {
    if (value.startsWith(PLAYER_PREFIX)) {
      const player = favoritePlayers.find((p) => p.id === value.slice(PLAYER_PREFIX.length));
      if (!player) return;
      setSelectedId(player.id);
      if (player.teamId && data.teams.some((t) => t.id === player.teamId)) setClubId(player.teamId);
      return;
    }
    if (value.startsWith(CLUB_PREFIX)) {
      setClubId(value.slice(CLUB_PREFIX.length));
      setSelectedId(null);
      return;
    }
    setClubId('');
    setSelectedId(null);
  };

  const openProfile = (player: FavoritePlayer) => {
    setRequestedPlayer(player);
    setSelectedId(player.id);
  };

  const toggleCompare = (player: FavoritePlayer) => {
    if (slotA?.id === player.id) {
      setSlotAId(null);
      return;
    }
    if (slotB?.id === player.id) {
      setSlotBId(null);
      return;
    }
    if (!slotA) {
      setSlotAId(player.id);
      return;
    }
    if (!slotB) setSlotBId(player.id);
  };
  const compareSlotFor = (player: FavoritePlayer): 1 | 2 | null =>
    slotA?.id === player.id ? 1 : slotB?.id === player.id ? 2 : null;

  const setSlot = (side: 0 | 1, id: string) => {
    if (id && !favoritePlayers.some((p) => p.id === id)) return;
    if (id && id === (side === 0 ? slotBId : slotAId)) return;
    (side === 0 ? setSlotAId : setSlotBId)(id || null);
  };
  const clearComparison = () => {
    setSlotAId(null);
    setSlotBId(null);
  };

  const removeFavorite = (player: FavoritePlayer) => {
    togglePlayer(player);
    if (slotAId === player.id) setSlotAId(null);
    if (slotBId === player.id) setSlotBId(null);
    if (selectedId === player.id) setSelectedId(null);
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

  const catalogueLoading = (data.matchesLoading || data.leaguesLoading) && data.teams.length === 0;
  const catalogueError = data.matchesError && data.teams.length === 0 ? data.matchesError : null;

  return (
    <div className="players-view">
      {!clubDetailOpen && (
        <header className="players-head">
          <h2 className="ui-page-title">Игроки</h2>
          <p className="players-head__note">Избранные футболисты и сравнение.</p>
        </header>
      )}

      {!clubDetailOpen &&
        (favoritePlayers.length === 0 ? (
          <EmptyState
            message={
              directoryOptions.length > 0
                ? 'Выберите клуб ниже и отметьте игроков звёздочкой.'
                : 'Клубов для выбора пока нет.'
            }
          />
        ) : (
          <FavoritePlayersPanel
            players={favoritePlayers}
            onOpen={openProfile}
            onRemove={removeFavorite}
            onCompare={toggleCompare}
            compareSlot={compareSlotFor}
            comparisonFull={!!slotA && !!slotB}
            canCompare={favoritePlayers.length > 1}
          />
        ))}

      {!clubDetailOpen && (directoryOptions.length > 0 || catalogueLoading || catalogueError) && (
        <Panel className="players-directory">
          <PanelHeader title="Найти игрока" />
          {catalogueLoading && (
            <div className="players-directory__loading" role="status">
              <Skeleton className="players-directory__skeleton" />
              <span className="visually-hidden">Загружаем каталог клубов…</span>
            </div>
          )}
          {catalogueError && (
            <EmptyState
              tone="error"
              title="Каталог клубов недоступен"
              message={catalogueError}
              action={
                <Button variant="quiet" onClick={data.reload}>
                  Повторить
                </Button>
              }
            />
          )}
          {directoryOptions.length > 0 && (
            <div className="players-directory__field">
              <span className="players-directory__label">Клуб или игрок</span>
              <SearchSelect
                ariaLabel="Клуб или игрок"
                value={directoryValue}
                options={directoryOptions}
                onChange={pickDirectory}
                placeholder="Выберите клуб или игрока"
              />
            </div>
          )}
        </Panel>
      )}

      {club && (
        <ClubPlayers
          key={club.id}
          team={club}
          matches={data.allMatches}
          onOpenMatch={onOpenMatch}
          onDetailChange={setClubDetailOpen}
        />
      )}

      {!clubDetailOpen && favoritePlayers.length > 1 && (
        <ComparisonPanel
          players={favoritePlayers}
          a={slotA}
          b={slotB}
          cardA={cardA}
          cardB={cardB}
          onPick={setSlot}
          onOpen={openProfile}
          onClear={clearComparison}
        />
      )}

      <SourceLine sources={['pitch']} fetchedAt={data.fetchedAt} stale={data.stale} />
    </div>
  );
}

export default PlayersCenter;
