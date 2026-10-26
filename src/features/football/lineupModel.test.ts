import { expect, it } from 'vitest';
import { buildPitchTeam, lineupMetric, lineupPoint } from './lineupModel';
import type { LineupPlayer, PlayerMatchEntry } from './types';

const player = (id = 'one', extra: Partial<LineupPlayer> = {}): LineupPlayer => ({
  player_id: id,
  name: `Player ${id}`,
  pitch_x: 0.1,
  pitch_y: 0.5,
  ...extra,
});
const entry = (
  team = 'home',
  id = 'one',
  key = 'rating_title',
  value: unknown = 8.25,
  type = 'double',
): PlayerMatchEntry => ({
  team_id: team,
  player: { id, name: `Player ${id}` },
  stats: [
    {
      key: 'top_stats',
      title: 'Autre langue',
      stats: { 'Une évaluation': { key, stat: { type, value: value as number } } },
    },
  ],
});

it('joins ratings by exact team and player IDs, independent of translated stat labels', () => {
  const team = buildPitchTeam({ id: 'home', name: 'Home' }, { starters: [player()], subs: [] }, [
    entry('away'),
    entry('home', 'other'),
    entry(),
  ]);
  expect(team.starters[0]?.rating).toBe(8.25);
  expect(team.rated).toBe(1);
  expect(team.average).toBe(8.25);
  expect(
    buildPitchTeam({ id: 'home', name: 'Home' }, { starters: [player()], subs: [] }, [
      entry('away'),
    ]).starters[0]?.rating,
  ).toBeNull();
});

it('distinguishes absent ratings from explicit zero and rejects malformed or non-rating values', () => {
  for (const raw of [null, '', false, NaN, Infinity, -1, 10.5])
    expect(lineupMetric(entry('home', 'one', 'rating_title', raw), 'rating')).toBeNull();
  expect(lineupMetric(entry('home', 'one', 'rating_title', 0), 'rating')).toBe(0);
  expect(lineupMetric(entry('home', 'one', 'rating', '7.35'), 'rating')).toBe(7.35);
  expect(lineupMetric(entry('home', 'one', 'rating_title', 1, 'boolean'), 'rating')).toBeNull();
  expect(lineupMetric(entry('home', 'one', 'goals', 8), 'rating')).toBeNull();
  expect(lineupMetric(entry('home', 'one', 'minutes_played', 90, 'integer'), 'minutes')).toBe(90);
});

it('orients both teams toward the center without confusing source x with field width', () => {
  const keeper = player(),
    forward = player('striker', { pitch_x: 0.87, pitch_y: 0.7 });
  const homeKeeper = lineupPoint(keeper, false)!,
    awayKeeper = lineupPoint(keeper, true)!;
  const homeForward = lineupPoint(forward, false)!,
    awayForward = lineupPoint(forward, true)!;
  expect(homeKeeper.left).toBeLessThan(15);
  expect(awayKeeper.left).toBeGreaterThan(85);
  expect(homeForward.left).toBeGreaterThan(homeKeeper.left);
  expect(homeForward.left).toBeLessThan(50);
  expect(awayForward.left).toBeLessThan(awayKeeper.left);
  expect(awayForward.left).toBeGreaterThan(50);
  expect(homeForward.left + awayForward.left).toBeCloseTo(100);
  expect(homeForward.top + awayForward.top).toBeCloseTo(100);
});

it('leaves missing, invalid and out-of-range coordinates unpositioned', () => {
  for (const extra of [
    { pitch_x: undefined },
    { pitch_y: undefined },
    { pitch_x: NaN },
    { pitch_y: Infinity },
    { pitch_x: 1.01 },
    { pitch_y: -0.01 },
  ]) {
    expect(lineupPoint(player('one', extra), false)).toBeNull();
  }
  expect(lineupPoint(player('one', { pitch_x: 0, pitch_y: 1 }), false)).not.toBeNull();
});

it('keeps substitutes off the pitch, deduplicates players and averages only rated starters', () => {
  const team = buildPitchTeam(
    { id: 'home', name: 'Home' },
    {
      starters: [player(), player(), player('missing', { pitch_x: undefined })],
      subs: [player(), player('sub', { pitch_x: 0, pitch_y: 0 })],
    },
    [entry(), entry('home', 'sub', 'rating_title', 2)],
  );
  expect(team.starters).toHaveLength(2);
  expect(team.subs).toHaveLength(1);
  expect(team.subs[0]?.point).toBeNull();
  expect(team.average).toBe(8.25);
  expect(team.rated).toBe(1);
  expect(team.starters[1]?.point).toBeNull();
  expect(team.starters[1]?.entry).toBeNull();
});

it('handles absent lineups and malformed lists without inventing a formation or players', () => {
  expect(buildPitchTeam({ id: 'home', name: 'Home' }, undefined, [])).toMatchObject({
    starters: [],
    subs: [],
    average: null,
    rated: 0,
    formation: null,
    confirmed: false,
  });
  const data = { starters: [null, {}, player()], subs: null } as unknown as Parameters<
    typeof buildPitchTeam
  >[1];
  expect(buildPitchTeam({ id: 'home', name: 'Home' }, data, []).starters).toHaveLength(1);
});
