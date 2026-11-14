import { classifyMatchStatus } from '../../lib/sportsIdentity';
import type { MatchSummary } from '../football/types';

/**
 * Pure helpers of the «Сегодня» screen: a table from the loaded season results,
 * the latest and next club fixtures, and readable Formula 1 constructor names.
 */

const RECENT_KICKOFF_MS = 150 * 60_000;

export interface LeagueTableEntry {
  teamId: string;
  name: string;
  position: number;
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

interface TableRow {
  teamId: string;
  name: string;
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

/** UTC start of a fixture; a date-only value is a calendar date, not a local midnight. */
export function matchStart(match: Pick<MatchSummary, 'time_utc' | 'date'>): number {
  const value = (match.time_utc || match.date || '').trim();
  if (!value) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(day) ? day : NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Table of the loaded season results. Missing scores and unfinished matches do
 * not count; when the season has no result the table is empty and the screen
 * shows a dash instead of a made-up place.
 */
export function buildLeagueTable(matches: readonly MatchSummary[]): Map<string, LeagueTableEntry> {
  const rows = new Map<string, TableRow>();
  const ensure = (teamId: string, name: string): TableRow => {
    const current = rows.get(teamId);
    if (current) return current;
    const created: TableRow = {
      teamId,
      name,
      played: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
    };
    rows.set(teamId, created);
    return created;
  };

  for (const match of matches) {
    if (classifyMatchStatus(match.status) !== 'finished') continue;
    if (match.score_home === null || match.score_away === null) continue;
    if (!match.home_team?.id || !match.away_team?.id) continue;
    const home = ensure(match.home_team.id, match.home_team.name);
    const away = ensure(match.away_team.id, match.away_team.name);
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.score_home;
    home.goalsAgainst += match.score_away;
    away.goalsFor += match.score_away;
    away.goalsAgainst += match.score_home;
    if (match.score_home > match.score_away) home.points += 3;
    else if (match.score_home < match.score_away) away.points += 3;
    else {
      home.points += 1;
      away.points += 1;
    }
  }

  return new Map(
    [...rows.values()]
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
          b.goalsFor - a.goalsFor ||
          a.name.localeCompare(b.name, 'ru'),
      )
      .map((row, index) => [
        row.teamId,
        {
          teamId: row.teamId,
          name: row.name,
          position: index + 1,
          played: row.played,
          points: row.points,
          goalsFor: row.goalsFor,
          goalsAgainst: row.goalsAgainst,
          goalDifference: row.goalsFor - row.goalsAgainst,
        },
      ]),
  );
}

export interface ClubSnapshot {
  last: MatchSummary | null;
  next: MatchSummary | null;
}

/** Latest finished and next still-relevant fixture of one club. */
export function clubSnapshot(
  matches: readonly MatchSummary[],
  teamId: string,
  now: number = Date.now(),
): ClubSnapshot {
  const own = matches.filter(
    (match) => match.home_team?.id === teamId || match.away_team?.id === teamId,
  );
  const finished = own
    .filter(
      (match) =>
        classifyMatchStatus(match.status) === 'finished' &&
        match.score_home !== null &&
        match.score_away !== null,
    )
    .map((match) => ({ match, start: matchStart(match) }))
    .filter(({ start }) => !Number.isFinite(start) || start <= now)
    .sort(
      (a, b) =>
        (Number.isFinite(b.start) ? b.start : -Infinity) -
        (Number.isFinite(a.start) ? a.start : -Infinity),
    );
  const upcoming = own
    .filter((match) => {
      const state = classifyMatchStatus(match.status);
      if (state !== 'scheduled' && state !== 'unknown') return false;
      const start = matchStart(match);
      return Number.isFinite(start) ? start >= now - RECENT_KICKOFF_MS : false;
    })
    .sort((a, b) => matchStart(a) - matchStart(b));
  return { last: finished[0]?.match ?? null, next: upcoming[0] ?? null };
}

/** The other club of a fixture, or an empty string when the team is not in it. */
export function opponentName(match: MatchSummary | null, teamId: string): string {
  if (!match) return '';
  if (match.home_team.id === teamId) return match.away_team.name;
  if (match.away_team.id === teamId) return match.home_team.name;
  return '';
}

/** Human constructor names for the favourite teams. Unknown ids stay visible as-is. */
const F1_TEAM_NAMES: Readonly<Record<string, string>> = {
  mercedes: 'Mercedes',
  red_bull: 'Red Bull',
  ferrari: 'Ferrari',
  mclaren: 'McLaren',
  aston_martin: 'Aston Martin',
  alpine: 'Alpine',
  williams: 'Williams',
  rb: 'RB',
  sauber: 'Sauber',
  kick_sauber: 'Kick Sauber',
  audi: 'Audi',
  haas: 'Haas',
  cadillac: 'Cadillac',
};

export function f1TeamName(id: string): string {
  return F1_TEAM_NAMES[id] ?? id;
}
