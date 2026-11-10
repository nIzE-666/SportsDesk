import { ApiError } from '../../lib/apiError';

export const SHOT_PERIODS = [
  'FirstHalf',
  'SecondHalf',
  'FirstExtraHalf',
  'SecondExtraHalf',
  'PenaltyShootout',
] as const;
export type ShotPeriod = (typeof SHOT_PERIODS)[number] | 'Unknown';
export interface AnalysisShot {
  id: string;
  teamId: string;
  player: string;
  period: ShotPeriod;
  minute: number | null;
  added: number;
  x: number | null;
  y: number | null;
  xg: number | null;
  outcome: string;
  ownGoal: boolean;
  blocked: boolean;
}
export interface ShotData {
  shots: AnalysisShot[];
  rejected: number;
}
export interface PressurePoint {
  minute: number;
  value: number;
}
export interface PressureData {
  points: PressurePoint[];
  rejected: number;
}
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const numberIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

function payload(value: unknown, matchId: string): Record<string, unknown> {
  const data = record(value) && 'data' in value ? value.data : value;
  if (!record(data) || (data.match_id !== undefined && data.match_id !== matchId))
    throw new ApiError('BadPayload');
  return data;
}
function shotPeriod(value: unknown): ShotPeriod {
  if (value === 'ExtraFirstHalf') return 'FirstExtraHalf';
  if (value === 'ExtraSecondHalf') return 'SecondExtraHalf';
  return SHOT_PERIODS.includes(value as (typeof SHOT_PERIODS)[number])
    ? (value as ShotPeriod)
    : 'Unknown';
}
export function parseShots(value: unknown, matchId: string): ShotData {
  const data = payload(value, matchId);
  // Real upcoming fixtures return periods: null, rather than an empty array.
  if (data.periods === null) return { shots: [], rejected: 0 };
  if (!Array.isArray(data.periods)) throw new ApiError('BadPayload');
  const shots = new Map<string, AnalysisShot>();
  let rejected = 0;
  for (const group of data.periods) {
    if (!record(group) || !Array.isArray(group.shots)) {
      rejected++;
      continue;
    }
    for (const row of group.shots) {
      if (
        !record(row) ||
        typeof row.id !== 'string' ||
        !row.id ||
        typeof row.team_id !== 'string' ||
        !row.team_id
      ) {
        rejected++;
        continue;
      }
      const x = numberIn(row.x, 0, 105),
        y = numberIn(row.y, 0, 68);
      const minute = numberIn(row.minute, 0, 180);
      shots.set(row.id, {
        id: row.id,
        teamId: row.team_id,
        player:
          record(row.player) && typeof row.player.name === 'string'
            ? row.player.name
            : 'Игрок не указан',
        period: shotPeriod(group.period),
        minute: minute !== null && Number.isInteger(minute) ? minute : null,
        added: numberIn(row.minute_added, 0, 99) ?? 0,
        x: x !== null && y !== null ? x : null,
        y: x !== null && y !== null ? y : null,
        xg: numberIn(row.expected_goals, 0, 1),
        outcome: typeof row.event_type === 'string' ? row.event_type : '',
        ownGoal: row.is_own_goal === true,
        blocked: row.is_blocked === true,
      });
    }
  }
  return { shots: [...shots.values()].sort(compareShots), rejected };
}
export function parsePressure(value: unknown, matchId: string): PressureData {
  const data = payload(value, matchId);
  if (!Array.isArray(data.points)) throw new ApiError('BadPayload');
  const points = new Map<number, PressurePoint>();
  let rejected = 0;
  for (const row of data.points) {
    if (!record(row)) {
      rejected++;
      continue;
    }
    const minute = numberIn(row.minute, 0, 180),
      index = numberIn(row.value, -100, 100);
    if (minute === null || index === null) {
      rejected++;
      continue;
    }
    points.set(minute, { minute, value: index });
  }
  return { points: [...points.values()].sort((a, b) => a.minute - b.minute), rejected };
}
export const periodLabel = (period: ShotPeriod | 'All'): string =>
  ({
    All: 'Весь матч',
    FirstHalf: '1-й тайм',
    SecondHalf: '2-й тайм',
    FirstExtraHalf: '1-й доп. тайм',
    SecondExtraHalf: '2-й доп. тайм',
    PenaltyShootout: 'Серия пенальти',
    Unknown: 'Период не указан',
  })[period];
export const shotMinute = (shot: AnalysisShot): string =>
  shot.minute === null ? '—' : `${shot.minute}${shot.added ? `+${shot.added}` : ''}′`;
export function shotOutcome(shot: AnalysisShot): string {
  if (shot.ownGoal) return 'Автогол';
  if (shot.blocked) return 'Заблокирован';
  const labels: Record<string, string> = {
    goal: 'Гол',
    attemptsaved: 'Отбит',
    miss: 'Мимо',
    post: 'Каркас ворот',
  };
  return labels[shot.outcome.toLowerCase()] ?? 'Исход не указан';
}
export function compareShots(a: AnalysisShot, b: AnalysisShot): number {
  const order = (p: ShotPeriod) => (p === 'Unknown' ? 5 : SHOT_PERIODS.indexOf(p));
  return (
    order(a.period) - order(b.period) ||
    (a.minute ?? Infinity) - (b.minute ?? Infinity) ||
    a.added - b.added ||
    a.id.localeCompare(b.id)
  );
}
export function selectShots(shots: AnalysisShot[], team: string, period: ShotPeriod | 'All') {
  return shots.filter(
    (shot) =>
      (team === 'All' || shot.teamId === team) &&
      (period === 'All' ? shot.period !== 'PenaltyShootout' : shot.period === period),
  );
}
export interface XgSeries {
  total: number | null;
  known: number;
  count: number;
  incomplete: boolean;
  points: { shot: AnalysisShot; total: number }[];
}
/** Missing values are never added as zero; this is only the sum of published xG. */
export function buildXg(shots: AnalysisShot[]): XgSeries {
  const eligible = shots.filter((s) => !s.ownGoal && s.period !== 'PenaltyShootout');
  const known = eligible.filter((s) => s.xg !== null);
  let sum = 0;
  const points: XgSeries['points'] = [];
  for (const shot of [...eligible].sort(compareShots)) {
    if (shot.xg === null || shot.minute === null || shot.period === 'Unknown') continue;
    sum += shot.xg;
    points.push({ shot, total: sum });
  }
  return {
    total: known.length ? known.reduce((v, s) => v + s.xg!, 0) : null,
    known: known.length,
    count: eligible.length,
    incomplete: known.length < eligible.length || points.length < known.length,
    points,
  };
}

/** Put added time before the next period, without confusing 45+7 with minute 52. */
export function shotClock(shots: AnalysisShot[]) {
  const starts = [0, 45, 90, 105],
    ends = [45, 90, 105, 120];
  const extra = starts.map((_, i) =>
    Math.max(
      0,
      ...shots
        .filter((s) => s.period === SHOT_PERIODS[i] && s.minute !== null)
        .map((s) => Math.max(0, s.minute! + s.added - ends[i]!)),
    ),
  );
  const offset = (i: number) => extra.slice(0, i).reduce((a, b) => a + b, 0);
  const time = (shot: AnalysisShot) => {
    const i = SHOT_PERIODS.indexOf(shot.period as (typeof SHOT_PERIODS)[number]);
    return i < 0 || i > 3 || shot.minute === null ? null : shot.minute + shot.added + offset(i);
  };
  const last = shots.some((s) => s.period === 'SecondExtraHalf')
    ? 3
    : shots.some((s) => s.period === 'FirstExtraHalf')
      ? 2
      : 1;
  return {
    time,
    end: ends[last]! + offset(last) + extra[last]!,
    ticks: [
      { value: 0, label: '0′' },
      ...ends.slice(0, last + 1).map((end, i) => ({
        value: end + offset(i) + extra[i]!,
        label: `${end}${extra[i] ? `+${extra[i]}` : ''}′`,
      })),
    ],
  };
}
