import { expect, it } from 'vitest';
import type { MatchEvent, MatchSummary } from '../football/types';
import { levelForPoints, rateFinished, rateUpcoming, spoilerSafe } from './interest';
import type { TableRow } from './standings';

const team = (name: string) => ({ id: name, name });

const finished = (
  home: string,
  away: string,
  scoreHome: number,
  scoreAway: number,
): MatchSummary => ({
  id: `${home}-${away}`,
  status: 'finished',
  home_team: team(home),
  away_team: team(away),
  score_home: scoreHome,
  score_away: scoreAway,
});

const goal = (minute: number, home: number, away: number, added = 0): MatchEvent => ({
  event_type: 'goal',
  minute,
  minute_added: added || undefined,
  score_home: home,
  score_away: away,
});

const redCard = (minute: number): MatchEvent => ({ event_type: 'redcard', minute });

const tableRow = (teamName: string, place: number, points = 100 - place): TableRow => ({
  teamId: teamName,
  teamName,
  place,
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points,
});

const comebackEvents = [
  goal(10, 0, 1),
  goal(20, 0, 2),
  goal(50, 1, 2),
  goal(70, 2, 2),
  goal(80, 3, 2),
];

it('spots a comeback from 0:2', () => {
  const result = rateFinished(finished('United', 'Villa', 3, 2), comebackEvents);

  expect(result.reasons).toContainEqual({
    kind: 'comeback',
    text: 'камбэк с 0:2',
    points: 2,
    spoiler: true,
  });
});

it('names a winner in added time', () => {
  const result = rateFinished(finished('Home', 'Away', 1, 0), [goal(90, 1, 0, 3)]);

  expect(result.reasons).toContainEqual({
    kind: 'late',
    text: 'победный гол на 90+3',
    points: 2,
    spoiler: true,
  });
});

it('does not mistake a late consolation for the decider', () => {
  const result = rateFinished(finished('Home', 'Away', 2, 1), [
    goal(10, 1, 0),
    goal(20, 2, 0),
    goal(90, 2, 1),
  ]);

  expect(result.reasons.map((item) => item.kind)).not.toContain('late');
});

it('names an equaliser at 88', () => {
  const events = [goal(10, 0, 1), goal(50, 1, 1), goal(70, 1, 2), goal(88, 2, 2)];
  const result = rateFinished(finished('Home', 'Away', 2, 2), events);

  expect(result.reasons).toContainEqual({
    kind: 'late',
    text: 'ничья на 88-й',
    points: 2,
    spoiler: true,
  });
});

it('finds nothing to add to a 0:0', () => {
  expect(rateFinished(finished('Home', 'Away', 0, 0), [])).toEqual({
    points: 0,
    level: 1,
    reasons: [],
  });
});

it('counts eight goals in a 4:4 and calls it close', () => {
  const result = rateFinished(finished('Home', 'Away', 4, 4), []);

  expect(result.points).toBe(3);
  expect(result.level).toBe(3);
  expect(result.reasons.map((item) => item.text)).toEqual(['8 голов', 'интрига до конца']);
});

it('counts a red card once and names the number', () => {
  const result = rateFinished(finished('Home', 'Away', 1, 0), [redCard(30)]);

  expect(result.reasons).toContainEqual({
    kind: 'red-card',
    text: 'удаление',
    points: 1,
    spoiler: true,
  });
});

it('declines goals and red cards', () => {
  const goalsText = (count: number) =>
    rateFinished(finished('Home', 'Away', count, 0), []).reasons.find(
      (item) => item.kind === 'goals',
    )?.text;
  expect([4, 5, 6, 8].map(goalsText)).toEqual(['4 гола', '5 голов', '6 голов', '8 голов']);

  const redsText = (count: number) =>
    rateFinished(
      finished('Home', 'Away', 0, 0),
      Array.from({ length: count }, (_, index) => redCard(10 + index)),
    ).reasons.find((item) => item.kind === 'red-card')?.text;
  expect([1, 2, 5].map(redsText)).toEqual(['удаление', '2 удаления', '5 удалений']);
});

it('never counts an event without a minute as late', () => {
  const noMinute = {
    event_type: 'goal',
    score_home: 1,
    score_away: 0,
  } as unknown as MatchEvent;
  const result = rateFinished(finished('Home', 'Away', 1, 0), [noMinute]);

  expect(result.reasons.map((item) => item.kind)).toEqual(['close']);
});

it('uses only the score when there are no events', () => {
  const result = rateFinished(finished('Home', 'Away', 3, 2), []);

  expect(result.reasons.map((item) => item.kind)).toEqual(['goals', 'close']);
  expect(result.points).toBe(2);
  expect(result.level).toBe(2);
});

it('calls an upset by the places before the match', () => {
  const table = [tableRow('Winner', 15, 20), tableRow('Loser', 2, 50)];
  const result = rateFinished(finished('Winner', 'Loser', 2, 1), [], { table });

  expect(result.reasons).toContainEqual({
    kind: 'upset',
    text: '15-е место обыграло 2-е',
    points: 2,
    spoiler: true,
  });
});

it('marks a meeting of the top four', () => {
  const table = [tableRow('First', 1, 50), tableRow('Fourth', 4, 40)];
  const result = rateFinished(finished('First', 'Fourth', 1, 0), [], { table });

  expect(result.reasons).toContainEqual({
    kind: 'top-clash',
    text: 'встреча лидеров',
    points: 1,
    spoiler: false,
  });
});

it('marks a final without a knockout reason', () => {
  const result = rateFinished(finished('Home', 'Away', 1, 0), [], { stage: 'final' });

  expect(result.reasons).toContainEqual({
    kind: 'knockout',
    text: 'финал',
    points: 2,
    spoiler: false,
  });
  expect(result.points).toBe(3);
  expect(result.level).toBe(3);
});

it('recognises a derby by the club names', () => {
  const result = rateFinished(finished('Manchester United', 'Manchester City', 1, 0), []);

  expect(result.reasons).toContainEqual({
    kind: 'derby',
    text: 'дерби',
    points: 1,
    spoiler: false,
  });
});

it('keeps the level but hides the spoiling reasons', () => {
  const result = rateFinished(finished('Home', 'Away', 3, 2), comebackEvents, {
    stage: 'final',
    derby: true,
  });
  expect(result.points).toBe(7);
  expect(result.level).toBe(5);

  const safe = spoilerSafe(result);

  expect(safe.points).toBe(7);
  expect(safe.level).toBe(5);
  expect(safe.reasons).toEqual([
    { kind: 'knockout', text: 'финал', points: 2, spoiler: false },
    { kind: 'derby', text: 'дерби', points: 1, spoiler: false },
  ]);
});

it('maps points to the five levels', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(levelForPoints)).toEqual([1, 1, 2, 3, 3, 4, 4, 5, 5]);
});

it('ranks a 4:4 comeback above a quiet 1:0', () => {
  const comeback = rateFinished(finished('Manchester United', 'Aston Villa', 4, 4), [
    goal(5, 0, 1),
    goal(12, 0, 2),
    goal(30, 1, 2),
    goal(40, 2, 2),
    goal(55, 3, 2),
    goal(60, 4, 2),
    goal(70, 4, 3),
    goal(84, 4, 4),
  ]);
  const quiet = rateFinished(finished('Home', 'Away', 1, 0), []);

  expect(comeback.reasons.map((item) => item.text)).toContain('камбэк с 0:2');
  expect(comeback.points).toBeGreaterThan(quiet.points);
  expect(comeback.level).toBeGreaterThan(quiet.level);
});

it('describes an upcoming top match by places and has no level', () => {
  const table = [
    tableRow('First', 1, 50),
    tableRow('Second', 2, 47),
    tableRow('Third', 3, 46),
    tableRow('Fourth', 4, 40),
  ];
  const result = rateUpcoming(finished('Second', 'Third', 0, 0), { table });

  expect(result).not.toHaveProperty('level');
  expect(result.reasons.map((item) => item.kind)).toEqual(['top-clash', 'places']);
  expect(result.reasons.map((item) => item.text)).toEqual(['встреча лидеров', '2-е против 3-го']);
  expect(result.score).toBe(5);
});

it('calls teams within three points neighbours in the top half', () => {
  const table = [
    tableRow('First', 1, 50),
    tableRow('Second', 2, 47),
    tableRow('Third', 3, 46),
    tableRow('Fourth', 4, 40),
    tableRow('Fifth', 5, 30),
    tableRow('Sixth', 6, 29),
    tableRow('Seventh', 7, 28),
    tableRow('Eighth', 8, 27),
    tableRow('Ninth', 9, 27),
    tableRow('Tenth', 10, 20),
    tableRow('Eleventh', 11, 18),
    tableRow('Twelfth', 12, 17),
    tableRow('Thirteenth', 13, 16),
    tableRow('Fourteenth', 14, 15),
    tableRow('Fifteenth', 15, 14),
    tableRow('Sixteenth', 16, 13),
    tableRow('Seventeenth', 17, 12),
    tableRow('Eighteenth', 18, 11),
    tableRow('Nineteenth', 19, 10),
    tableRow('Twentieth', 20, 9),
  ];
  const result = rateUpcoming(finished('Fifth', 'Ninth', 0, 0), { table });

  expect(result.reasons).toEqual([
    { kind: 'table-neighbours', text: 'соседи по таблице', points: 1, spoiler: false },
  ]);
});

it('combines the stage and the derby for an upcoming match', () => {
  const result = rateUpcoming(finished('Manchester United', 'Manchester City', 0, 0), {
    stage: 'final',
  });

  expect(result.reasons.map((item) => item.text)).toEqual(['финал', 'дерби']);
  expect(result.score).toBe(4);
});
