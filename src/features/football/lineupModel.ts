import type { LineupPlayer, MatchEvent, PlayerMatchEntry, TeamLineup, TeamRef } from './types';

export interface PitchPlayerEvents {
  goals: number;
  penaltyGoals: number;
  ownGoals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  subbedOffMinute: number | null;
  subbedOnMinute: number | null;
}

export interface PitchPlayer {
  player: LineupPlayer;
  entry: PlayerMatchEntry | null;
  rating: number | null;
  minutes: number | null;
  point: { left: number; top: number } | null;
  events: PitchPlayerEvents;
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
  metric: 'rating' | 'minutes' | 'goals' | 'assists',
): number | null {
  const keys =
    metric === 'rating'
      ? ['rating_title', 'rating']
      : metric === 'minutes'
        ? ['minutes_played', 'minutes']
        : metric === 'goals'
          ? ['goals']
          : ['assists'];
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

function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim();
}

function surnameOf(normalized: string): string {
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : '';
}

function matchesPlayerRef(
  ref: { id?: string; name?: string } | undefined,
  player: LineupPlayer,
  targetFull: string,
  targetParts: string[],
  targetSurname: string,
  surnameUnique: boolean,
  sameTeam: boolean,
): boolean {
  if (!ref) return false;
  const evId = ref.id?.trim();
  if (evId && evId === player.player_id) return true;
  const evName = ref.name ? normalizePlayerName(ref.name) : '';
  if (!evName || !targetFull) return false;
  if (evName === targetFull) return true;
  if (!sameTeam) return false;
  if (surnameUnique && (evName === targetSurname || surnameOf(evName) === targetSurname)) {
    return true;
  }
  // Cross-source initial matching: "M. Salah" <-> "Mohamed Salah", "H. Son" <-> "Son Heung-Min"
  const evParts = evName.split(' ').filter(Boolean);
  if (evParts.length >= 2 && targetParts.length >= 2) {
    const evFirst = evParts[0]!;
    const evLast = evParts[evParts.length - 1]!;
    const tFirst = targetParts[0]!;
    const tLast = targetParts[targetParts.length - 1]!;
    if (evFirst.length === 1 && evLast === tLast && tFirst.startsWith(evFirst)) return true;
    if (tFirst.length === 1 && tLast === evLast && evFirst.startsWith(tFirst)) return true;
    // Asian / reversed name order: "H. Son" <-> "Son Heung-Min"
    if (
      evFirst.length === 1 &&
      evLast === tFirst &&
      targetParts.slice(1).some((p) => p.startsWith(evFirst))
    )
      return true;
  }
  return false;
}

function collectPlayerEvents(
  teamId: string,
  player: LineupPlayer,
  entry: PlayerMatchEntry | null,
  matchEvents: MatchEvent[],
  starter: boolean,
  uniqueSurnames: Set<string>,
): PitchPlayerEvents {
  let goals = 0;
  let penaltyGoals = 0;
  let ownGoals = 0;
  let eventAssists = 0;
  let yellowCards = 0;
  let redCards = 0;
  let subbedOffMinute: number | null = null;
  let subbedOnMinute: number | null = null;

  const targetFull = normalizePlayerName(player.name);
  const targetParts = targetFull.split(' ').filter(Boolean);
  const targetSurname = surnameOf(targetFull);
  const surnameUnique = targetSurname.length >= 3 && uniqueSurnames.has(targetSurname);

  for (const ev of matchEvents) {
    if (!ev || typeof ev.event_type !== 'string') continue;
    const type = ev.event_type.toLowerCase();
    const isOwnGoal = Boolean(ev.is_own_goal) || type === 'own_goal';
    const sameTeam = !ev.team_id || ev.team_id === teamId;

    if (
      sameTeam &&
      type === 'goal' &&
      !isOwnGoal &&
      matchesPlayerRef(
        ev.assist_player,
        player,
        targetFull,
        targetParts,
        targetSurname,
        surnameUnique,
        sameTeam,
      )
    ) {
      eventAssists += 1;
    }

    if (!sameTeam && !isOwnGoal) continue;

    const matchedPrimary = matchesPlayerRef(
      ev.player,
      player,
      targetFull,
      targetParts,
      targetSurname,
      surnameUnique,
      sameTeam,
    );
    const matchedRelated =
      !matchedPrimary &&
      type === 'substitution' &&
      matchesPlayerRef(
        ev.related_player,
        player,
        targetFull,
        targetParts,
        targetSurname,
        surnameUnique,
        sameTeam,
      );
    if (!matchedPrimary && !matchedRelated) continue;

    if (isOwnGoal) {
      ownGoals += 1;
    } else if (type === 'goal') {
      goals += 1;
      if (ev.is_penalty) penaltyGoals += 1;
    } else if (type === 'yellowcard' || type === 'yellow_card') {
      yellowCards += 1;
    } else if (type === 'second_yellow') {
      yellowCards = Math.max(yellowCards + 1, 2);
      redCards += 1;
    } else if (type === 'redcard' || type === 'red_card') {
      redCards += 1;
    } else if (type === 'substitution' && Number.isFinite(ev.minute) && ev.minute > 0) {
      if (starter) {
        subbedOffMinute =
          subbedOffMinute === null ? ev.minute : Math.min(subbedOffMinute, ev.minute);
      } else {
        subbedOnMinute = subbedOnMinute === null ? ev.minute : Math.min(subbedOnMinute, ev.minute);
      }
    }
  }

  const statGoals = lineupMetric(entry, 'goals');
  if (statGoals !== null && Math.round(statGoals) > goals) {
    goals = Math.round(statGoals);
  }
  const statAssists = lineupMetric(entry, 'assists');
  const assists = Math.max(
    eventAssists,
    statAssists !== null ? Math.max(0, Math.round(statAssists)) : 0,
  );

  return {
    goals,
    penaltyGoals,
    ownGoals,
    assists,
    yellowCards,
    redCards,
    subbedOffMinute,
    subbedOnMinute,
  };
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
  matchEvents: MatchEvent[] = [],
): PitchTeam {
  const surnameCounts = new Map<string, number>();
  for (const list of [data?.starters, data?.subs]) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      if (!value || typeof value.name !== 'string') continue;
      const surname = surnameOf(normalizePlayerName(value.name));
      if (surname) surnameCounts.set(surname, (surnameCounts.get(surname) ?? 0) + 1);
    }
  }
  const uniqueSurnames = new Set(
    [...surnameCounts.entries()].filter(([, count]) => count === 1).map(([name]) => name),
  );
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
          events: collectPlayerEvents(team.id, value, entry, matchEvents, starter, uniqueSurnames),
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
