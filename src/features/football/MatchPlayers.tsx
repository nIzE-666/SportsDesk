import { PersonAvatar } from '../../components/PersonAvatar';
import { ArrowLeft, Star } from 'lucide-react';
import { useMemo } from 'react';
import { EmptyBlock } from '../../components/StateViews';
import { useViewState } from '../../lib/useViewState';
import { useFavorites } from './FavoritesProvider';
import { SeasonPlayerPanel } from './SeasonPlayerPanel';
import { PlayerFormPanel } from './PlayerFormPanel';
import { formatHumanDate } from '../../lib/humanDate';
import { getUserTimezone } from './storage';
import { formatDistanceStat, formatTeamStat, statGroupLabel, statLabel } from './statLabels';
import type {
  MatchDetail,
  MatchSummary,
  PlayerMatchEntry,
  PlayerStatGroup,
  StatValue,
} from './types';

const PER90_ALLOWED_KEYS = new Set<string>([
  'goals',
  'assists',
  'total_shots',
  'shots_on_target',
  'accurate_passes',
  'touches',
  'chances_created',
  'tackles',
  'interceptions',
  'clearances',
  'blocks',
  'fouls',
  'duels_won',
  'ball_recoveries',
  'dispossessed',
  'defensive_actions',
]);

function isCountStat(key: string, stat: StatValue | undefined): boolean {
  if (!stat || !PER90_ALLOWED_KEYS.has(key)) return false;
  if (stat.type === 'fractionWithPercentage' || stat.type === 'boolean') return false;
  return typeof stat.value === 'number' && Number.isFinite(stat.value);
}

function formatStatValue(stat: StatValue | undefined): string {
  if (!stat) return '—';
  if (stat.type === 'fractionWithPercentage') {
    const value = stat.value;
    const total = stat.total;
    if (
      typeof value !== 'number' ||
      typeof total !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isFinite(total)
    )
      return '—';
    if (total <= 0) return '—';
    return `${value}/${total} (${Math.round((value / total) * 100)}%)`;
  }
  if (stat.type === 'boolean') return stat.value ? 'да' : 'нет';
  if (stat.type === 'distanceWithPercentage')
    return typeof stat.value === 'number' ? formatDistanceStat(stat.value, stat.total) : '—';
  if (stat.type === 'distance')
    return typeof stat.value === 'number' ? formatTeamStat(String(stat.value), 'distance') : '—';
  if (stat.type === 'speed')
    return typeof stat.value === 'number' ? formatTeamStat(String(stat.value), 'speed') : '—';
  if (typeof stat.value === 'number' && Number.isFinite(stat.value)) {
    if (Number.isInteger(stat.value)) return String(stat.value);
    return stat.value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  }
  return '—';
}

function numericStat(entry: PlayerMatchEntry | null, label: string): number | null {
  if (!entry) return null;
  for (const g of entry.stats) {
    const cell = g.stats[label];
    if (!cell) continue;
    const v = cell.stat?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return null;
}

/** Look up a stat cell by its canonical provider key across all groups. */
function findStatCell(
  entry: PlayerMatchEntry,
  key: string,
): { key: string; stat: StatValue } | undefined {
  for (const g of entry.stats) {
    const stats = g.stats ?? {};
    for (const cell of Object.values(stats)) {
      if (cell?.key === key) return { key, stat: cell.stat };
    }
  }
  return undefined;
}

function playerTeamName(entry: PlayerMatchEntry, detail: MatchDetail): string {
  if (entry.team_id === detail.home_team.id) return detail.home_team.name;
  if (entry.team_id === detail.away_team.id) return detail.away_team.name;
  return 'Команда не сопоставлена';
}

export function PlayersTab({
  entries,
  error,
  detail,
  seasonMatches,
  onOpenMatch,
}: {
  entries: PlayerMatchEntry[];
  error?: string;
  detail: MatchDetail;
  seasonMatches: MatchSummary[];
  onOpenMatch?: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useViewState<string | null>(
    `match.${detail.id}.player`,
    null,
    (v) => v === null || typeof v === 'string',
  );

  if (error && entries.length === 0)
    return <EmptyBlock title="Данные игроков недоступны" message={error} />;
  if (entries.length === 0)
    return (
      <EmptyBlock title="Игроки не загружены" message="Источник не передал статистику игроков." />
    );

  const selected = selectedId ? (entries.find((e) => e.player.id === selectedId) ?? null) : null;

  if (selected) {
    return (
      <>
        <PlayerProfile entry={selected} detail={detail} onBack={() => setSelectedId(null)} />
        <PlayerFormPanel
          playerId={selected.player.id}
          teamId={selected.team_id}
          teamName={playerTeamName(selected, detail)}
          matches={seasonMatches}
          onOpenMatch={onOpenMatch}
        />
        <SeasonPlayerPanel
          playerId={selected.player.id}
          teamId={selected.team_id}
          teamName={playerTeamName(selected, detail)}
          matches={seasonMatches}
          onOpenMatch={(id) => {
            setSelectedId(null);
            onOpenMatch?.(id);
          }}
        />
      </>
    );
  }

  return (
    <div className="players-grid">
      {entries.map((entry) => (
        <PlayerCard
          key={entry.player.id}
          entry={entry}
          detail={detail}
          onClick={() => setSelectedId(entry.player.id)}
        />
      ))}
    </div>
  );
}

function PlayerCard({
  entry,
  detail,
  onClick,
}: {
  entry: PlayerMatchEntry;
  detail: MatchDetail;
  onClick: () => void;
}) {
  const rating = numericStat(entry, 'Рейтинг');
  const ratingAlt = rating ?? numericStat(entry, 'Rating');
  const minutes = numericStat(entry, 'Сыграно минут') ?? numericStat(entry, 'Minutes played');
  const goals = numericStat(entry, 'Голы') ?? numericStat(entry, 'Goals');
  const assists = numericStat(entry, 'Ассисты') ?? numericStat(entry, 'Assists');
  const teamName = playerTeamName(entry, detail);

  return (
    <button className="player-card" onClick={onClick} title="Открыть статистику игрока">
      <div className="player-head">
        <PersonAvatar name={entry.player.name} src={entry.player.image_url} />
        <div>
          <strong>{entry.player.name}</strong>
          <span className="muted small">{teamName}</span>
        </div>
      </div>
      <div className="player-metrics">
        <StatChip
          label="Рейтинг"
          value={
            ratingAlt != null
              ? ratingAlt.toLocaleString('ru-RU', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : '—'
          }
        />
        <StatChip label="Минуты" value={minutes != null ? String(minutes) : '—'} />
        <StatChip label="Голы" value={goals != null ? String(goals) : '—'} />
        <StatChip label="Ассисты" value={assists != null ? String(assists) : '—'} />
      </div>
    </button>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-chip">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PlayerProfile({
  entry,
  detail,
  onBack,
  backLabel = 'К игрокам',
}: {
  entry: PlayerMatchEntry;
  detail: MatchDetail;
  onBack: () => void;
  backLabel?: string;
}) {
  const { isPlayerFavorite, togglePlayer } = useFavorites();
  const favorite = isPlayerFavorite(entry.player.id);
  const teamName = playerTeamName(entry, detail);
  const matchLabel = `${detail.home_team.name} — ${detail.away_team.name}`;
  const minutes = numericStat(entry, 'Сыграно минут') ?? numericStat(entry, 'Minutes played');

  return (
    <div className="panel player-profile">
      <div className="md-topbar">
        <button className="ghost-btn" onClick={onBack}>
          <ArrowLeft size={14} /> {backLabel}
        </button>
        <button
          className={favorite ? 'ghost-btn active' : 'ghost-btn'}
          aria-pressed={favorite}
          onClick={() =>
            togglePlayer({
              id: entry.player.id,
              name: entry.player.name,
              teamId: entry.team_id,
              teamName,
              imageUrl: entry.player.image_url ?? null,
              matchId: detail.id,
              matchLabel,
              savedAt: new Date().toISOString(),
            })
          }
        >
          <Star size={14} /> {favorite ? 'В избранном' : 'В избранное'}
        </button>
      </div>
      <div className="player-profile-head">
        <PersonAvatar name={entry.player.name} src={entry.player.image_url} size={64} />
        <div>
          <h2>{entry.player.name}</h2>
          <p className="muted small">
            {teamName} · {matchLabel} ·{' '}
            {formatHumanDate(detail.time_utc ?? detail.date, getUserTimezone())} · {minutes ?? '—'}{' '}
            мин.
          </p>
        </div>
      </div>
      {minutes === null && (
        <p
          className="chip"
          title="Источник не указал минуты игрока, поэтому показатели за 90 минут недоступны."
        >
          Неполные данные: нет минут игрока
        </p>
      )}
      <h3>Статистика матча</h3>
      <div className="stat-groups">
        {entry.stats.map((group, i) => (
          <StatPlayerGroup key={`${group.key || 'group'}-${i}`} group={group} minutes={minutes} />
        ))}
      </div>
    </div>
  );
}

function StatPlayerGroup({ group, minutes }: { group: PlayerStatGroup; minutes: number | null }) {
  const stats = group.stats && typeof group.stats === 'object' ? group.stats : {};
  const rows = Object.entries(stats).filter(([, v]) => v?.stat?.type !== 'boolean');
  return (
    <section className="panel inner">
      <h3>{statGroupLabel(group.key, group.title)}</h3>
      {rows.length === 0 && <p className="muted small">Показателей в этой группе нет.</p>}
      <div className="sp-grid">
        {rows.map(([label, v]) => {
          const stat = v?.stat;
          const key = v?.key || '';
          // Per-90 only for additive count stats; ratings, minutes and ratio
          // metrics stay raw. Missing/invalid values never render as fake zero.
          const per90Value =
            minutes && minutes > 0 && isCountStat(key, stat)
              ? ((stat as StatValue).value as number) / (minutes / 90)
              : null;
          return (
            <div key={label} className="sp-cell">
              <span className="muted small">{statLabel(key, label)}</span>
              <strong>{formatStatValue(stat)}</strong>
              {per90Value !== null && (
                <span className="muted tiny">
                  {per90Value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} / 90
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function MatchPlayersComparison({
  detail,
  entries,
}: {
  detail: MatchDetail;
  entries: PlayerMatchEntry[];
}) {
  const [slots, setSlots] = useViewState<[string | null, string | null]>(
    `match.${detail.id}.comparison`,
    [null, null],
    (v) =>
      Array.isArray(v) && v.length === 2 && v.every((id) => id === null || typeof id === 'string'),
  );
  const byId = useMemo(() => {
    const map = new Map<string, PlayerMatchEntry>();
    for (const e of entries) map.set(e.player.id, e);
    return map;
  }, [entries]);

  const left = slots[0] ? (byId.get(slots[0]) ?? null) : null;
  const right = slots[1] ? (byId.get(slots[1]) ?? null) : null;

  const setSlot = (idx: 0 | 1, id: string) => {
    setSlots((prev) => {
      const next: [string | null, string | null] = [prev[0], prev[1]];
      next[idx] = id || null;
      return next;
    });
  };

  const leftMinutes = numericStat(left, 'Сыграно минут') ?? numericStat(left, 'Minutes played');
  const rightMinutes = numericStat(right, 'Сыграно минут') ?? numericStat(right, 'Minutes played');

  const commonItems = useMemo(() => {
    if (!left || !right) return [] as Array<{ key: string; title: string }>;
    const leftKeys = new Set<string>();
    for (const g of left.stats)
      for (const cell of Object.values(g.stats ?? {})) if (cell?.key) leftKeys.add(cell.key);
    const seen = new Set<string>();
    const result: Array<{ key: string; title: string }> = [];
    for (const g of right.stats) {
      for (const [label, cell] of Object.entries(g.stats ?? {})) {
        if (!cell?.key) continue;
        if (leftKeys.has(cell.key) && !seen.has(cell.key)) {
          seen.add(cell.key);
          result.push({ key: cell.key, title: label });
        }
      }
    }
    return result;
  }, [left, right]);

  if (entries.length === 0) return null;

  return (
    <section className="panel compare-panel">
      <div className="section-title">
        <h2>Сравнение двух игроков матча</h2>
      </div>
      <div className="compare-selects">
        <select
          value={slots[0] ?? ''}
          onChange={(e) => setSlot(0, e.target.value)}
          aria-label="Первый игрок"
        >
          <option value="">Выберите игрока A</option>
          {entries.map((e) => (
            <option key={e.player.id} value={e.player.id}>
              {e.player.name} ({playerTeamName(e, detail)})
            </option>
          ))}
        </select>
        <select
          value={slots[1] ?? ''}
          onChange={(e) => setSlot(1, e.target.value)}
          aria-label="Второй игрок"
        >
          <option value="">Выберите игрока B</option>
          {entries.map((e) => (
            <option key={e.player.id} value={e.player.id}>
              {e.player.name} ({playerTeamName(e, detail)})
            </option>
          ))}
        </select>
      </div>
      {left && right ? (
        <div className="compare-grid">
          <div className="compare-context compare-row">
            <strong>{left.player.name}</strong>
            <span>Показатель</span>
            <strong>{right.player.name}</strong>
          </div>
          {commonItems.map((row) => {
            const lStat = findStatCell(left, row.key)?.stat;
            const rStat = findStatCell(right, row.key)?.stat;
            const lPer90 =
              leftMinutes && leftMinutes > 0 && isCountStat(row.key, lStat)
                ? ((lStat as StatValue).value as number) / (leftMinutes / 90)
                : null;
            const rPer90 =
              rightMinutes && rightMinutes > 0 && isCountStat(row.key, rStat)
                ? ((rStat as StatValue).value as number) / (rightMinutes / 90)
                : null;
            return (
              <div key={row.key} className="compare-row">
                <span className="compare-a">{formatStatValue(lStat)}</span>
                <span className="compare-label">
                  {statLabel(row.key, row.title)}
                  {lPer90 !== null && rPer90 !== null && (
                    <span className="muted tiny">
                      {' '}
                      / 90: {lPer90.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} /{' '}
                      {rPer90.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                    </span>
                  )}
                </span>
                <span className="compare-b">{formatStatValue(rStat)}</span>
              </div>
            );
          })}
          {commonItems.length === 0 && (
            <p className="muted small">У этих игроков нет общих показателей.</p>
          )}
        </div>
      ) : (
        <p className="muted small">
          {entries.length < 2 ? 'Нужна статистика хотя бы двух игроков.' : 'Выберите двух игроков.'}
        </p>
      )}
    </section>
  );
}

export function FavoritePlayersPanel({ onClose }: { onClose: () => void }) {
  const { favoritePlayers, togglePlayer } = useFavorites();
  return (
    <section className="panel">
      <div className="section-title">
        <h2>
          <Star size={14} /> Избранные игроки
        </h2>
        <button className="link-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {favoritePlayers.length === 0 && <p className="muted small">Пока нет избранных игроков.</p>}
      <ul className="fav-players-list">
        {favoritePlayers.map((p) => (
          <li key={p.id}>
            <span>
              <strong>{p.name}</strong>
              <span className="muted small">
                {' '}
                · {p.teamName ?? '—'} · {p.matchLabel ?? ''}
              </span>
            </span>
            <button className="link-btn" onClick={() => togglePlayer(p)}>
              Убрать
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
