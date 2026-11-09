import { rpc } from '../../lib/bridge';
import type { MatchSummary } from './types';

/**
 * Local season history (№5): every loaded league season is persisted into a
 * local SQLite history DB by the Rust side; this module exposes typed
 * queries (season list, season matches, head-to-head, team form) and the
 * write path used by the football data layer.
 */

export interface HistoryMatch {
  id: string;
  leagueId: string;
  season: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  status: string;
  date: string;
  round: string;
}

export interface HistorySeasonInfo {
  leagueId: string;
  leagueName: string;
  season: string;
  matches: number;
}

/** Persist a loaded league season into history (idempotent upsert). */
export async function saveSeasonToHistory(
  leagueId: string,
  leagueName: string,
  season: string,
  matches: MatchSummary[],
): Promise<void> {
  if (!leagueId || !season || matches.length === 0) return;
  try {
    await rpc('history_upsert', {
      batch: {
        leagueId,
        leagueName,
        season,
        matches: matches.map((m) => ({
          id: m.id,
          homeId: m.home_team.id,
          homeName: m.home_team.name,
          awayId: m.away_team.id,
          awayName: m.away_team.name,
          homeScore: m.score_home ?? null,
          awayScore: m.score_away ?? null,
          status: m.status,
          date: (m.date ?? m.time_utc ?? '').slice(0, 10),
          round: m.round_name ?? '',
        })),
      },
    });
  } catch {
    /* history is a local enhancement; failures must never break loading */
  }
}

async function readHistory<T>(command: string, args?: Record<string, unknown>): Promise<T[]> {
  try {
    const rows = args ? await rpc<T[]>(command, args) : await rpc<T[]>(command);
    if (!Array.isArray(rows)) throw new Error('Некорректный ответ истории.');
    return rows;
  } catch (error) {
    throw new Error('Не удалось прочитать локальную историю матчей.', { cause: error });
  }
}

export async function fetchHistorySeasons(): Promise<HistorySeasonInfo[]> {
  return readHistory('history_seasons');
}

export async function fetchHistorySeason(
  leagueId: string,
  season: string,
): Promise<HistoryMatch[]> {
  return readHistory('history_season_matches', { leagueId, season });
}

export async function fetchHeadToHead(teamAId: string, teamBId: string): Promise<HistoryMatch[]> {
  return readHistory('history_head_to_head', { teamA: teamAId, teamB: teamBId });
}

export async function fetchTeamHistory(
  teamId: string,
  finishedOnly = true,
): Promise<HistoryMatch[]> {
  return readHistory('history_team_matches', { teamId, finishedOnly });
}

// -----
// Local analytics on top of the stored matches
// -----

export type FormResult = 'W' | 'D' | 'L';

/** Form line of finished matches for one team, newest first. */
export function teamForm(matches: HistoryMatch[], teamId: string): FormResult[] {
  const out: FormResult[] = [];
  for (const m of matches) {
    if (m.status !== 'finished' || m.homeScore < 0 || m.awayScore < 0) continue;
    const isHome = m.homeId === teamId;
    const own = isHome ? m.homeScore : m.awayScore;
    const opp = isHome ? m.awayScore : m.homeScore;
    if (own > opp) out.push('W');
    else if (own < opp) out.push('L');
    else out.push('D');
  }
  return out;
}

export interface H2HSummary {
  played: number;
  aWins: number;
  bWins: number;
  draws: number;
  aGoals: number;
  bGoals: number;
}

/** Aggregate head-to-head record between two teams. */
export function h2hSummary(matches: HistoryMatch[], aId: string, bId: string): H2HSummary {
  const s: H2HSummary = { played: 0, aWins: 0, bWins: 0, draws: 0, aGoals: 0, bGoals: 0 };
  for (const m of matches) {
    if (m.status !== 'finished' || m.homeScore < 0 || m.awayScore < 0) continue;
    s.played += 1;
    const aIsHome = m.homeId === aId;
    const a = aIsHome ? m.homeScore : m.awayScore;
    const b = aIsHome ? m.awayScore : m.homeScore;
    s.aGoals += a;
    s.bGoals += b;
    if (a > b) s.aWins += 1;
    else if (a < b) s.bWins += 1;
    else s.draws += 1;
  }
  return s;
}

export interface PointsProgressionPoint {
  date: string;
  round: string;
  points: number;
}

/** Cumulative points of one team through a stored season (oldest first). */
export function pointsProgression(
  matches: HistoryMatch[],
  teamId: string,
): PointsProgressionPoint[] {
  const ordered = [...matches]
    .filter(
      (m) =>
        m.status === 'finished' &&
        m.homeScore >= 0 &&
        m.awayScore >= 0 &&
        (m.homeId === teamId || m.awayId === teamId),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  let points = 0;
  const out: PointsProgressionPoint[] = [];
  for (const m of ordered) {
    const isHome = m.homeId === teamId;
    const own = isHome ? m.homeScore : m.awayScore;
    const opp = isHome ? m.awayScore : m.homeScore;
    if (own > opp) points += 3;
    else if (own === opp) points += 1;
    out.push({ date: m.date, round: m.round, points });
  }
  return out;
}
