import type { MatchStripGoal, ShowcaseTeam } from '../../kit';
import { findPitchMatchId } from '../football/liveData';
import { minuteLabel } from '../football/liveFeed';
import type { LiveMatch } from '../football/liveSources';
import { LEAGUES } from '../../lib/navigationMetadata';
import { CUP_COMPETITIONS } from '../ucl/cupMetadata';
import type { MatchEvent, TeamRef } from '../football/types';
import { levelForPoints, rateFinished, rateUpcoming, type InterestStage } from './interest';
import { tableBefore } from './standings';
import type { HomeWeekData } from './useHomeWeek';
import { matchStartMs, shiftDayKey, type WeekMatch } from './weekData';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const TRACK_MARKS_PER_DAY = 3;
const leagues = new Set<string>(LEAGUES.map((league) => league.id));
const competitions = new Map<string, string>([
  ...LEAGUES.map(({ id, label }) => [id, label] as const),
  ...CUP_COMPETITIONS.map(({ id, title }) => [id, title] as const),
]);

export interface HomeMatch extends WeekMatch {
  start: number;
  iso: string;
  competition: string;
  finished: ReturnType<typeof rateFinished> | null;
  upcoming: ReturnType<typeof rateUpcoming> | null;
  events: MatchEvent[];
}

export interface HomeLiveMatch {
  live: LiveMatch;
  match: HomeMatch | undefined;
  competition: string;
  minute: string | null;
  points: number;
}

export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDayKey(day, -((weekday + 6) % 7));
}

export function toShowcaseTeam(team: TeamRef): ShowcaseTeam {
  return { name: team.name, imageUrl: team.image_url };
}

export function scoreValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function matchTitle(home: string, away: string): string {
  return `${home} — ${away}`;
}

function matchStage(leagueId: string, round: string | undefined): InterestStage | undefined {
  if (leagues.has(leagueId)) return 'league';
  if (!round) return undefined;
  if (/^(?:grand )?final$|^финал$/iu.test(round.trim())) return 'final';
  return /knockout|round of \d+|\bplay[- ]?offs?\b|\b(?:quarter|semi)[- ]?finals?\b|\d\/\d+ финала|полуфинал/iu.test(
    round,
  )
    ? 'knockout'
    : undefined;
}

export function collectHomeMatches(data: HomeWeekData): HomeMatch[] {
  const matches: HomeMatch[] = [];
  for (const day of data.days) {
    for (const match of day.matches) {
      const { summary, leagueId, state } = match;
      if (state !== 'finished' && state !== 'scheduled' && state !== 'live') continue;
      const start = matchStartMs(summary);
      if (start === null) continue;
      const iso = new Date(start).toISOString();
      const stage = matchStage(leagueId, summary.round_name);
      const table = leagues.has(leagueId)
        ? tableBefore(data.seasonMatches[leagueId] ?? [], iso)
        : undefined;
      const events = data.events[summary.id]?.events ?? [];
      matches.push({
        ...match,
        start,
        iso,
        competition: competitions.get(leagueId) ?? 'Футбол',
        finished: state === 'finished' ? rateFinished(summary, events, { table, stage }) : null,
        upcoming: state === 'scheduled' ? rateUpcoming(summary, { table, stage }) : null,
        events,
      });
    }
  }
  return matches;
}

export function selectBest(matches: HomeMatch[], fromDay: number, now: number): HomeMatch[] {
  return matches
    .filter((match) => match.finished && match.start >= fromDay && match.start <= now)
    .sort((a, b) => b.finished!.points - a.finished!.points || b.start - a.start);
}

export function selectUpcoming(matches: HomeMatch[], now: number, through: number): HomeMatch[] {
  return matches
    .filter((match) => match.upcoming && match.start > now && match.start < through)
    .sort((a, b) => b.upcoming!.score - a.upcoming!.score || a.start - b.start);
}

export function homeInterest(match: HomeMatch): number | null {
  if (!match.finished) return null;
  const known =
    scoreValue(match.summary.score_home) !== null && scoreValue(match.summary.score_away) !== null;
  return known || match.finished.points > 0 ? match.finished.level : null;
}

export function selectLiveMatches(
  matches: readonly LiveMatch[],
  week: HomeMatch[],
): HomeLiveMatch[] {
  const byId = new Map(week.map((match) => [match.summary.id, match]));
  const references = week.map((match) => ({ match: match.summary, leagueId: match.leagueId }));
  return matches
    .filter((live) => live.state === 'live' && live.leagueId && competitions.has(live.leagueId))
    .map((live) => {
      const id = findPitchMatchId(live, references);
      const match = id ? byId.get(id) : undefined;
      const minute = minuteLabel(live.minute);
      const minutes = minute ? Number.parseInt(minute, 10) : 0;
      const home = scoreValue(live.score.home);
      const away = scoreValue(live.score.away);
      const close = home !== null && away !== null && Math.abs(home - away) < 2;
      const many = home !== null && away !== null && home + away >= 4;
      const points = (close ? 2 : 0) + (minutes >= 75 ? 2 : 0) + (many ? 2 : 0);
      return { live, match, competition: competitions.get(live.leagueId!)!, minute, points };
    })
    .filter(({ match }) => match?.state !== 'finished')
    .sort((a, b) => b.points - a.points);
}

export function liveInterest(match: HomeLiveMatch): number | null {
  return match.points > 0 ? levelForPoints(match.points) : null;
}

export function extractGoals(match: HomeMatch): MatchStripGoal[] {
  const steps = match.events
    .filter(
      (event) => event.event_type === 'goal' && Number.isFinite(event.minute) && event.minute >= 0,
    )
    .sort((a, b) => a.minute - b.minute || (a.minute_added ?? 0) - (b.minute_added ?? 0));
  let home = 0;
  let away = 0;
  const goals: MatchStripGoal[] = [];
  for (const event of steps) {
    const nextHome = scoreValue(event.score_home);
    const nextAway = scoreValue(event.score_away);
    if (nextHome === null || nextAway === null) {
      const side =
        event.team_id === match.summary.home_team.id
          ? 'home'
          : event.team_id === match.summary.away_team.id
            ? 'away'
            : undefined;
      if (!side || event.is_own_goal) continue;
      goals.push({ minute: event.minute, extra: event.minute_added, side });
      if (side === 'home') home += 1;
      else away += 1;
      continue;
    }
    const side =
      nextHome === home + 1 && nextAway === away
        ? 'home'
        : nextAway === away + 1 && nextHome === home
          ? 'away'
          : undefined;
    home = nextHome;
    away = nextAway;
    if (side) goals.push({ minute: event.minute, extra: event.minute_added, side });
  }
  const last = goals.at(-1);
  if (
    last &&
    match.finished?.reasons.some((reason) => reason.kind === 'late') &&
    (last.minute ?? 0) >= 85
  )
    last.key = true;
  return goals;
}
