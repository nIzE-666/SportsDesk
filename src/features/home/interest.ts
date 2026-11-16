import { countRu, type PluralForms } from '../../lib/plural';
import type { MatchEvent, MatchSummary } from '../football/types';
import { isDerbyMatch } from './derbies';
import type { TableRow } from './standings';

export type InterestStage = 'league' | 'knockout' | 'final';
export type InterestLevel = 1 | 2 | 3 | 4 | 5;

export type InterestReasonKind =
  | 'goals'
  | 'close'
  | 'comeback'
  | 'late'
  | 'red-card'
  | 'upset'
  | 'top-clash'
  | 'places'
  | 'table-neighbours'
  | 'knockout'
  | 'derby';

export interface InterestReason {
  kind: InterestReasonKind;
  text: string;
  points: number;
  spoiler: boolean;
}

export interface InterestContext {
  table?: readonly TableRow[];
  stage?: InterestStage;
  derby?: boolean;
}

export interface FinishedRating {
  points: number;
  level: InterestLevel;
  reasons: InterestReason[];
}

export interface UpcomingRating {
  score: number;
  reasons: InterestReason[];
}

interface Score {
  home: number;
  away: number;
}

interface GoalStep {
  minute: number;
  added: number;
  home: number;
  away: number;
}

const GOAL_FORMS: PluralForms = ['гол', 'гола', 'голов'];
const RED_CARD_FORMS: PluralForms = ['удаление', 'удаления', 'удалений'];

const REASON_ORDER: Record<InterestReasonKind, number> = {
  comeback: 0,
  late: 1,
  upset: 2,
  goals: 3,
  close: 4,
  'red-card': 5,
  'top-clash': 6,
  places: 7,
  'table-neighbours': 8,
  knockout: 9,
  derby: 10,
};

function reason(
  kind: InterestReasonKind,
  text: string,
  points: number,
  spoiler: boolean,
): InterestReason {
  return { kind, text, points, spoiler };
}

function orderReasons(reasons: InterestReason[]): InterestReason[] {
  return reasons.sort((a, b) => REASON_ORDER[a.kind] - REASON_ORDER[b.kind]);
}

export function levelForPoints(points: number): InterestLevel {
  if (points >= 7) return 5;
  if (points >= 5) return 4;
  if (points >= 3) return 3;
  if (points >= 2) return 2;
  return 1;
}

function finalScore(match: MatchSummary): Score | null {
  const home = match.score_home;
  const away = match.score_away;
  if (
    typeof home !== 'number' ||
    !Number.isFinite(home) ||
    home < 0 ||
    typeof away !== 'number' ||
    !Number.isFinite(away) ||
    away < 0
  )
    return null;
  return { home, away };
}

function scoreReasons(score: Score): InterestReason[] {
  const reasons: InterestReason[] = [];
  const goals = score.home + score.away;
  if (goals >= 6) reasons.push(reason('goals', countRu(goals, GOAL_FORMS), 2, true));
  else if (goals >= 4) reasons.push(reason('goals', countRu(goals, GOAL_FORMS), 1, true));

  const drawWithGoals = score.home === score.away && score.home > 0;
  const oneGoalMargin = Math.abs(score.home - score.away) === 1;
  if (drawWithGoals || oneGoalMargin) reasons.push(reason('close', 'интрига до конца', 1, true));
  return reasons;
}

function eventMinute(event: MatchEvent): number | null {
  return typeof event.minute === 'number' && Number.isFinite(event.minute) && event.minute >= 0
    ? event.minute
    : null;
}

function addedMinutes(event: MatchEvent): number {
  return typeof event.minute_added === 'number' &&
    Number.isFinite(event.minute_added) &&
    event.minute_added > 0
    ? event.minute_added
    : 0;
}

/**
 * Goal events in match order. A goal without a usable minute or score makes the sequence
 * incomplete: the comeback and the late decider are then skipped instead of guessed.
 */
function goalSteps(events: readonly MatchEvent[]): { steps: GoalStep[]; complete: boolean } {
  const steps: GoalStep[] = [];
  let complete = true;
  for (const event of events) {
    if (event.event_type !== 'goal') continue;
    const minute = eventMinute(event);
    const home = event.score_home;
    const away = event.score_away;
    if (
      minute === null ||
      typeof home !== 'number' ||
      !Number.isFinite(home) ||
      typeof away !== 'number' ||
      !Number.isFinite(away)
    ) {
      complete = false;
      continue;
    }
    steps.push({ minute, added: addedMinutes(event), home, away });
  }
  steps.sort((a, b) => a.minute - b.minute || a.added - b.added);
  return { steps, complete };
}

function detailsMatchScore(steps: readonly GoalStep[], score: Score): boolean {
  if (steps.length === 0) return score.home === 0 && score.away === 0;
  const last = steps[steps.length - 1]!;
  return last.home === score.home && last.away === score.away;
}

/** A team that was two goals down and still won or drew; the deepest deficit is named. */
function comebackReasons(steps: readonly GoalStep[], score: Score): InterestReason[] {
  let homeDepth = 0;
  let awayDepth = 0;
  let homeAt: Score | null = null;
  let awayAt: Score | null = null;

  for (const step of steps) {
    const homeDifference = step.home - step.away;
    if (homeDifference < homeDepth) {
      homeDepth = homeDifference;
      homeAt = { home: step.home, away: step.away };
    }
    const awayDifference = step.away - step.home;
    if (awayDifference < awayDepth) {
      awayDepth = awayDifference;
      awayAt = { home: step.away, away: step.home };
    }
  }

  const reasons: InterestReason[] = [];
  if (homeDepth <= -2 && score.home >= score.away) {
    const at = homeAt!;
    reasons.push(reason('comeback', `камбэк с ${at.home}:${at.away}`, 2, true));
  }
  if (awayDepth <= -2 && score.away >= score.home) {
    const at = awayAt!;
    reasons.push(reason('comeback', `камбэк с ${at.home}:${at.away}`, 2, true));
  }
  return reasons;
}

function minuteLabel(step: GoalStep): string {
  return step.added > 0 ? `${step.minute}+${step.added}` : `${step.minute}-й`;
}

/**
 * The last goal with which the winner took the lead, or the equaliser in a draw, from the
 * 85th minute on. A late consolation goal does not count: the result was already decided.
 */
function lateReason(steps: readonly GoalStep[], score: Score): InterestReason | null {
  if (steps.length === 0) return null;
  const last = steps[steps.length - 1]!;
  if (last.home !== score.home || last.away !== score.away) return null;

  let decisive: GoalStep | null = null;
  if (score.home === score.away) {
    const previous = steps.length > 1 ? steps[steps.length - 2]! : { home: 0, away: 0 };
    if (previous.home !== previous.away) decisive = last;
  } else {
    const winner = score.home > score.away ? 'home' : 'away';
    let previousHome = 0;
    let previousAway = 0;
    for (const step of steps) {
      const wasLeading =
        previousHome > previousAway ? 'home' : previousAway > previousHome ? 'away' : null;
      const leads = step.home > step.away ? 'home' : step.away > step.home ? 'away' : null;
      if (leads === winner && wasLeading !== winner) decisive = step;
      previousHome = step.home;
      previousAway = step.away;
    }
  }
  if (!decisive) return null;
  if (decisive.minute + decisive.added < 85) return null;

  const label = minuteLabel(decisive);
  const text = score.home === score.away ? `ничья на ${label}` : `победный гол на ${label}`;
  return reason('late', text, 2, true);
}

function redCardReasons(events: readonly MatchEvent[]): InterestReason[] {
  const redCards = events.filter((event) => event.event_type === 'redcard').length;
  if (redCards === 0) return [];
  const text = redCards === 1 ? 'удаление' : countRu(redCards, RED_CARD_FORMS);
  return [reason('red-card', text, 1, true)];
}

function rowFor(table: readonly TableRow[] | undefined, teamId: string): TableRow | undefined {
  return table?.find((row) => row.teamId === teamId);
}

function topClashReason(
  table: readonly TableRow[] | undefined,
  match: MatchSummary,
): InterestReason | null {
  const home = rowFor(table, match.home_team.id);
  const away = rowFor(table, match.away_team.id);
  if (!home || !away || home.place > 4 || away.place > 4) return null;
  return reason('top-clash', 'встреча лидеров', 1, false);
}

function upsetReason(
  table: readonly TableRow[] | undefined,
  match: MatchSummary,
  score: Score,
): InterestReason | null {
  if (!table || score.home === score.away) return null;
  const homeWon = score.home > score.away;
  const winner = rowFor(table, homeWon ? match.home_team.id : match.away_team.id);
  const loser = rowFor(table, homeWon ? match.away_team.id : match.home_team.id);
  if (!winner || !loser || winner.place - loser.place < 8) return null;
  return reason('upset', `${winner.place}-е место обыграло ${loser.place}-е`, 2, true);
}

function stageReason(
  stage: InterestStage | undefined,
  finalPoints: number,
  knockoutPoints: number,
): InterestReason | null {
  if (stage === 'final') return reason('knockout', 'финал', finalPoints, false);
  if (stage === 'knockout') return reason('knockout', 'матч на вылет', knockoutPoints, false);
  return null;
}

function derbyReason(
  match: MatchSummary,
  context: InterestContext,
  points: number,
): InterestReason | null {
  const derby = context.derby ?? isDerbyMatch(match);
  return derby ? reason('derby', 'дерби', points, false) : null;
}

export function rateFinished(
  match: MatchSummary,
  events: readonly MatchEvent[] = [],
  context: InterestContext = {},
): FinishedRating {
  const score = finalScore(match);
  const reasons: InterestReason[] = [];
  if (score) reasons.push(...scoreReasons(score));

  if (Array.isArray(events) && events.length > 0) {
    const { steps, complete } = goalSteps(events);
    if (complete && score && detailsMatchScore(steps, score)) {
      reasons.push(...comebackReasons(steps, score));
      const late = lateReason(steps, score);
      if (late) reasons.push(late);
    }
  }
  if (Array.isArray(events)) reasons.push(...redCardReasons(events));

  if (score) {
    const upset = upsetReason(context.table, match, score);
    if (upset) reasons.push(upset);
  }
  const topClash = topClashReason(context.table, match);
  if (topClash) reasons.push(topClash);
  const stage = stageReason(context.stage, 2, 1);
  if (stage) reasons.push(stage);
  const derby = derbyReason(match, context, 1);
  if (derby) reasons.push(derby);

  const ordered = orderReasons(reasons);
  const points = ordered.reduce((sum, item) => sum + item.points, 0);
  return { points, level: levelForPoints(points), reasons: ordered };
}

/**
 * Keeps the interest level: hiding the reasons does not change how bright the match was.
 * Only facts that do not reveal the result stay on the card.
 */
export function spoilerSafe(result: FinishedRating): FinishedRating {
  return {
    ...result,
    reasons: result.reasons.filter((item) => !item.spoiler),
  };
}

function inTopHalf(table: readonly TableRow[], row: TableRow): boolean {
  return row.place <= Math.ceil(table.length / 2);
}

/**
 * Upcoming matches have no level: importance, not interest, is what can be known before
 * the whistle. The score only orders the cards.
 */
export function rateUpcoming(match: MatchSummary, context: InterestContext = {}): UpcomingRating {
  const reasons: InterestReason[] = [];
  const table = context.table;
  const home = rowFor(table, match.home_team.id);
  const away = rowFor(table, match.away_team.id);

  if (table && home && away) {
    if (home.place <= 4 && away.place <= 4)
      reasons.push(reason('top-clash', 'встреча лидеров', 3, false));

    if (home.place <= 6 && away.place <= 6) {
      const first = Math.min(home.place, away.place);
      const second = Math.max(home.place, away.place);
      reasons.push(reason('places', `${first}-е против ${second}-го`, 2, false));
    }
    if (
      inTopHalf(table, home) &&
      inTopHalf(table, away) &&
      Math.abs(home.points - away.points) <= 3
    ) {
      reasons.push(reason('table-neighbours', 'соседи по таблице', 1, false));
    }
  }

  const stage = stageReason(context.stage, 3, 2);
  if (stage) reasons.push(stage);
  const derby = derbyReason(match, context, 1);
  if (derby) reasons.push(derby);

  const ordered = orderReasons(reasons);
  return { score: ordered.reduce((sum, item) => sum + item.points, 0), reasons: ordered };
}
