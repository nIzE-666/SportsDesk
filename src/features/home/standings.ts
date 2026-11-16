import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { fixtureCalendarTime } from '../football/calendar';
import type { MatchSummary, TeamRef } from '../football/types';

export interface TableRow {
  teamId: string;
  teamName: string;
  place: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

interface TeamTotals {
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant used for "started before". A record that carries only a calendar day is
 * counted after that whole UTC day has passed: the time inside the day is unknown, and
 * counting it earlier could include a match that had not started yet.
 */
function startedAt(match: MatchSummary): number | null {
  const time = fixtureCalendarTime(match);
  if (!time) return null;
  const parsed = Date.parse(time);
  if (!Number.isFinite(parsed)) return null;
  return time.length === 10 ? parsed + DAY_MS - 1 : parsed;
}

function goalValue(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function totalsFor(team: TeamRef, teams: Map<string, TeamTotals>): TeamTotals {
  let totals = teams.get(team.id);
  if (!totals) {
    totals = {
      teamId: team.id,
      teamName: team.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    };
    teams.set(team.id, totals);
  }
  return totals;
}

const goalDifference = (team: TeamTotals): number => team.goalsFor - team.goalsAgainst;

/**
 * The table as it stood before `beforeIso`: finished matches started earlier, ranked by
 * points, then goal difference, then goals scored. A full tie falls back to the team name
 * and id so the places stay stable between calls.
 */
export function tableBefore(seasonMatches: readonly MatchSummary[], beforeIso: string): TableRow[] {
  const cutoff = Date.parse(beforeIso);
  if (!Number.isFinite(cutoff)) return [];

  const teams = new Map<string, TeamTotals>();
  for (const match of seasonMatches) {
    if (classifyMatchStatus(match.status, match.status_text) !== 'finished') continue;
    const started = startedAt(match);
    if (started === null || started >= cutoff) continue;
    const homeGoals = goalValue(match.score_home);
    const awayGoals = goalValue(match.score_away);
    if (homeGoals === null || awayGoals === null) continue;

    const home = totalsFor(match.home_team, teams);
    const away = totalsFor(match.away_team, teams);
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.won += 1;
      away.lost += 1;
      home.points += 3;
    } else if (homeGoals < awayGoals) {
      away.won += 1;
      home.lost += 1;
      away.points += 3;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return [...teams.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        goalDifference(b) - goalDifference(a) ||
        b.goalsFor - a.goalsFor ||
        a.teamName.localeCompare(b.teamName, 'ru') ||
        a.teamId.localeCompare(b.teamId),
    )
    .map((team, index) => ({
      teamId: team.teamId,
      teamName: team.teamName,
      place: index + 1,
      played: team.played,
      won: team.won,
      drawn: team.drawn,
      lost: team.lost,
      goalsFor: team.goalsFor,
      goalsAgainst: team.goalsAgainst,
      goalDifference: goalDifference(team),
      points: team.points,
    }));
}
