import type { LineupPlayer, PlayerMatchEntry, TeamLineup, TeamRef } from './types';

export interface PitchPlayer {
  player: LineupPlayer;
  entry: PlayerMatchEntry | null;
  rating: number | null;
  minutes: number | null;
  point: { left: number; top: number } | null;
}
export interface PitchTeam {
  team: TeamRef;
  formation: string | null;
  confirmed: boolean;
  coach: string | null;
  starters: PitchPlayer[];
  subs: PitchPlayer[];
  rated: number;
  average: number | null;
}

/** Canonical provider keys, independent of the display language of stat labels. */
export function lineupMetric(
  entry: PlayerMatchEntry | null,
  metric: 'rating' | 'minutes',
): number | null {
  const keys = metric === 'rating' ? ['rating_title', 'rating'] : ['minutes_played', 'minutes'];
  for (const key of keys) {
    for (const group of Array.isArray(entry?.stats) ? entry.stats : []) {
      if (!group?.stats || typeof group.stats !== 'object') continue;
      for (const cell of Object.values(group.stats)) {
        if (
          cell?.key !== key ||
          !['integer', 'double', 'number', 'decimal', 'float'].includes(cell.stat?.type)
        )
          continue;
        const raw: unknown = cell.stat.value;
        if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) continue;
        const value = Number(raw);
        if (Number.isFinite(value) && value >= 0 && (metric !== 'rating' || value <= 10))
          return value;
      }
    }
  }
  return null;
}

/** PitchAPI's normalized x runs from own goal to attack for BOTH teams. */
export function lineupPoint(player: LineupPlayer, away: boolean): PitchPlayer['point'] {
  const x = player.pitch_x,
    y = player.pitch_y;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1
  )
    return null;
  return away ? { left: 95 - x * 44, top: 90 - y * 80 } : { left: 5 + x * 44, top: 10 + y * 80 };
}

export function buildPitchTeam(
  team: TeamRef,
  data: TeamLineup | undefined,
  entries: PlayerMatchEntry[],
  away = false,
): PitchTeam {
  const seen = new Set<string>();
  const players = (raw: unknown, starter: boolean): PitchPlayer[] => {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value: LineupPlayer) => {
      if (
        !value ||
        typeof value.player_id !== 'string' ||
        !value.player_id ||
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        seen.has(value.player_id)
      )
        return [];
      seen.add(value.player_id);
      const entry =
        entries.find((e) => e?.team_id === team.id && e.player?.id === value.player_id) ?? null;
      return [
        {
          player: value,
          entry,
          rating: lineupMetric(entry, 'rating'),
          minutes: lineupMetric(entry, 'minutes'),
          point: starter ? lineupPoint(value, away) : null,
        },
      ];
    });
  };
  const starters = players(data?.starters, true),
    subs = players(data?.subs, false);
  const ratings = starters.flatMap((p) => (p.rating === null ? [] : [p.rating]));
  return {
    team,
    starters,
    subs,
    formation: typeof data?.formation === 'string' && data.formation.trim() ? data.formation : null,
    confirmed: data?.confirmed === true,
    coach: typeof data?.coach?.name === 'string' ? data.coach.name : null,
    rated: ratings.length,
    average: ratings.length ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length : null,
  };
}

export const lineupPlayerKey = (teamId: string, playerId: string) =>
  JSON.stringify([teamId, playerId]);
export const ratingText = (rating: number | null) =>
  rating === null
    ? '—'
    : rating.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const ratingTone = (rating: number | null) =>
  rating === null
    ? 'unknown'
    : rating >= 8
      ? 'excellent'
      : rating >= 7
        ? 'good'
        : rating >= 6
          ? 'average'
          : 'low';
