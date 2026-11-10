import { describe, expect, it } from 'vitest';
import {
  buildXg,
  parsePressure,
  parseShots,
  selectShots,
  shotClock,
  shotMinute,
  shotOutcome,
} from './matchAnalysisModel';

const shot = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  team_id: 'home',
  player: { name: 'Bukayo Saka' },
  x: 94,
  y: 34,
  minute: 12,
  expected_goals: 0.3,
  event_type: 'Goal',
  ...extra,
});
const data = (rows: unknown[], period = 'FirstHalf') => ({
  data: { match_id: 'match', periods: [{ period, shots: rows }] },
});
const parse = (rows: unknown[], period?: string) => parseShots(data(rows, period), 'match').shots;

it('uses metre coordinates and keeps a real zero separate from unknown xG', () => {
  const rows = parse([
    shot('a', { x: 0, y: 0, expected_goals: 0 }),
    shot('b', { x: 106, expected_goals: null }),
    shot('c', { expected_goals: '0.5' }),
  ]);
  expect(rows[0]).toMatchObject({ x: 0, y: 0, xg: 0 });
  expect(rows[1]).toMatchObject({ x: null, y: null, xg: null });
  expect(rows[2]?.xg).toBeNull();
  expect(buildXg([rows[0]!]).total).toBe(0);
  expect(buildXg([rows[1]!]).total).toBeNull();
});

it('applies a repeated ID only once and uses the corrected record', () => {
  const rows = parse([shot('a'), shot('a', { expected_goals: 0.6, event_type: 'Miss' })]);
  expect(rows).toHaveLength(1);
  expect(buildXg(rows).total).toBe(0.6);
  expect(shotOutcome(rows[0]!)).toBe('Мимо');
  expect(buildXg(parse([shot('a')])).total).toBe(0.3);
});

it('flags a partial curve and never invents a time for an untimed shot', () => {
  const rows = parse([
    shot('known'),
    shot('unknown', { expected_goals: null, minute: 14 }),
    shot('untimed', { minute: null, expected_goals: 0.5 }),
    shot('later', { minute: 30, expected_goals: 0.2 }),
  ]);
  const xg = buildXg(rows);
  expect(xg.total).toBe(1);
  expect(xg).toMatchObject({ known: 3, count: 4, incomplete: true });
  expect(xg.points.map((p) => p.total)).toEqual([0.3, 0.5]);
});

it('orders added time before the next half and includes extra time on the clock', () => {
  const rows = parseShots(
    {
      periods: [
        { period: 'SecondHalf', shots: [shot('b', { minute: 46 })] },
        { period: 'FirstHalf', shots: [shot('a', { minute: 45, minute_added: 7 })] },
        { period: 'ExtraFirstHalf', shots: [shot('c', { minute: 105, minute_added: 2 })] },
        { period: 'ExtraSecondHalf', shots: [shot('d', { minute: 120, minute_added: 1 })] },
      ],
    },
    'match',
  ).shots;
  expect(rows.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(shotMinute(rows[0]!)).toBe('45+7′');
  const clock = shotClock(rows);
  expect(rows.map(clock.time)).toEqual([52, 53, 114, 130]);
  expect(clock.end).toBe(130);
  expect(clock.ticks.map((t) => t.label)).toEqual(['0′', '45+7′', '90′', '105+2′', '120+1′']);
});

it('keeps the selected team and period consistent across totals and lists', () => {
  const rows = parseShots(
    {
      periods: [
        { period: 'FirstHalf', shots: [shot('a'), shot('b', { team_id: 'away' })] },
        { period: 'SecondHalf', shots: [shot('c', { minute: 70 })] },
      ],
    },
    'match',
  ).shots;
  expect(selectShots(rows, 'home', 'FirstHalf').map((s) => s.id)).toEqual(['a']);
  expect(selectShots(rows, 'All', 'SecondHalf').map((s) => s.id)).toEqual(['c']);
});

it('excludes own goals and shootout attempts from xG and shootouts from the default list', () => {
  const rows = [
    ...parse([shot('normal'), shot('own', { is_own_goal: true })]),
    ...parse([shot('penalty', { minute: 120, expected_goals: 0.8 })], 'PenaltyShootout'),
  ];
  expect(buildXg(rows).total).toBe(0.3);
  expect(selectShots(rows, 'All', 'All').map((s) => s.id)).toEqual(['normal', 'own']);
  expect(selectShots(rows, 'All', 'PenaltyShootout').map((s) => s.id)).toEqual(['penalty']);
});

it('preserves unknown periods in the list but does not draw their xG at an invented time', () => {
  const rows = parse([shot('a')], 'ThirdHalf');
  expect(rows[0]?.period).toBe('Unknown');
  expect(buildXg(rows)).toMatchObject({ total: 0.3, incomplete: true, points: [] });
});

describe('response validation', () => {
  it.each([null, {}, { match_id: 'other', periods: [] }, { periods: 'bad' }])(
    'rejects malformed or unrelated shots: %j',
    (value) => {
      expect(() => parseShots(value, 'match')).toThrow();
    },
  );
  it('distinguishes an empty response from invalid records without throwing away valid shots', () => {
    expect(parseShots({ periods: [] }, 'match')).toEqual({ shots: [], rejected: 0 });
    expect(parseShots({ periods: null }, 'match')).toEqual({ shots: [], rejected: 0 });
    expect(parseShots(data([null, { x: 4 }, shot('valid')]), 'match')).toMatchObject({
      rejected: 2,
    });
    expect(parseShots({ periods: [null, { shots: [] }] }, 'match').rejected).toBe(1);
  });
  it('keeps signed pressure, deduplicates minutes, and leaves gaps empty', () => {
    expect(
      parsePressure(
        {
          points: [
            { minute: 90.75, value: -27 },
            { minute: 1, value: 12 },
            { minute: 1, value: -8 },
            { minute: 4, value: 0 },
            { minute: 8, value: 200 },
            { minute: '9', value: 3 },
          ],
        },
        'match',
      ),
    ).toEqual({
      rejected: 2,
      points: [
        { minute: 1, value: -8 },
        { minute: 4, value: 0 },
        { minute: 90.75, value: -27 },
      ],
    });
  });
  it('rejects pressure from another match and malformed lists', () => {
    expect(() => parsePressure({ match_id: 'other', points: [] }, 'match')).toThrow();
    expect(() => parsePressure({}, 'match')).toThrow();
    expect(parsePressure({ points: [] }, 'match').points).toEqual([]);
  });
});
