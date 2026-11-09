import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { buildWeekendComparison, fetchWeekendSeason } from './weekendData';
import type { WeekendSeason } from './weekendData';
import type { JolpicaRaceResultRow } from './types';

vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));
beforeEach(() => {
  vi.mocked(api).mockReset();
});

function result(driverId: string, position: number | null, points: string, status = 'Finished') {
  return {
    Driver: { driverId, givenName: 'D', familyName: driverId },
    Constructor: { constructorId: 'team', name: 'Team' },
    position: position === null ? undefined : String(position),
    positionText: position === null ? 'R' : String(position),
    points,
    status,
  };
}

function raceRow(round: number, results: ReturnType<typeof result>[]): JolpicaRaceResultRow {
  return {
    season: '2025',
    round: String(round),
    raceName: `Race ${round}`,
    date: '2025-05-01',
    Circuit: { circuitId: 'test', circuitName: 'Circuit' },
    Results: results,
  };
}

function sprintRow(round: number, results: ReturnType<typeof result>[]): Record<string, unknown> {
  return {
    season: '2025',
    round: String(round),
    raceName: `Race ${round}`,
    date: '2025-05-01',
    Circuit: { circuitId: 'test', circuitName: 'Circuit' },
    SprintResults: results,
  };
}

function qualyRow(
  round: number,
  entries: Array<{ id: string; pos: number }>,
): Record<string, unknown> {
  return {
    season: '2025',
    round: String(round),
    raceName: `Race ${round}`,
    date: '2025-05-01',
    Circuit: { circuitId: 'test', circuitName: 'Circuit' },
    QualifyingResults: entries.map((e) => ({
      Driver: { driverId: e.id, givenName: 'D', familyName: e.id },
      Constructor: { constructorId: 'team', name: 'Team' },
      position: String(e.pos),
      Q1: '1:20.000',
      Q2: '1:19.000',
      Q3: '1:18.000',
    })),
  };
}

function reply(races: unknown[], total: number, stale = false, offset = 0) {
  return {
    source: 'jolpica',
    payload: {
      MRData: {
        total: String(total),
        limit: '100',
        offset: String(offset),
        RaceTable: { Races: races },
      },
    },
    fetchedAt: '2026-10-21T00:00:00Z',
    stale,
  };
}

function raceReply() {
  const results = [
    result('a', 1, '25'),
    result('b', 2, '18'),
    ...Array.from({ length: 18 }, (_, index) => result(`other_${index}`, index + 3, '0')),
  ];
  return reply([raceRow(1, results)], results.length);
}

function season(r: {
  races: JolpicaRaceResultRow[];
  sprints: JolpicaRaceResultRow[] | null;
  qualifying: WeekendSeason['qualifying'];
}): WeekendSeason {
  return {
    races: r.races,
    sprints: r.sprints,
    qualifying: r.qualifying,
    fetchedAt: 'x',
    stale: false,
    issues: [],
  };
}

it('merges sprint pages split mid-race and preserves fractional points', async () => {
  const entries = Array.from({ length: 101 }, (_, i) =>
    result(`driver_${i}`, i + 1, i === 100 ? '3.5' : '0'),
  );
  vi.mocked(api).mockImplementation(async (_, path) => {
    if (path.includes('/results.json')) return raceReply();
    if (path.includes('/qualifying.json'))
      return reply(
        [
          qualyRow(1, [
            { id: 'a', pos: 2 },
            { id: 'b', pos: 5 },
          ]),
        ],
        2,
      );
    return path.includes('offset=100')
      ? reply([sprintRow(5, entries.slice(100))], 101, true, 100)
      : reply(
          Array.from({ length: 5 }, (_, index) => sprintRow(index + 1, entries.slice(0, 20))),
          101,
        );
  });
  const data = await fetchWeekendSeason(2025);
  expect(data.sprints).toHaveLength(5);
  expect(data.sprints?.[4]?.Results).toHaveLength(21);
  expect(data.sprints?.[4]?.Results[20]?.points).toBe('3.5');
  expect(data.qualifying?.[0]?.QualifyingResults).toHaveLength(2);
  expect(data.stale).toBe(true);
  expect(data.issues).toHaveLength(0);
});

it('rejects a sprint page set that does not deliver all documented entries', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(raceReply())
    .mockResolvedValueOnce(reply([sprintRow(1, [result('a', 1, '8'), result('b', 2, '7')])], 4)) // total 4 but only 2 delivered
    .mockResolvedValueOnce(reply([], 4));
  const data = await fetchWeekendSeason(2025);
  expect(data.sprints).toBeNull();
  expect(data.qualifying).toBeNull();
  expect(data.issues.length).toBeGreaterThan(0);
  expect(data.races).toHaveLength(1);
});

it('keeps optional sprint/qualifying null when their requests fail', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(raceReply())
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce(reply([qualyRow(1, [{ id: 'a', pos: 1 }])], 1));
  const data = await fetchWeekendSeason(2025);
  expect(data.sprints).toBeNull();
  expect(data.qualifying).not.toBeNull();
  expect(data.issues.some((i) => /Спринты/.test(i))).toBe(true);
});

it('does not silently convert a failed optional source into an empty array', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(raceReply())
    .mockRejectedValueOnce(new Error('nope'))
    .mockRejectedValueOnce(new Error('nope'));
  const data = await fetchWeekendSeason(2025);
  expect(data.sprints).toBeNull();
  expect(data.qualifying).toBeNull();
  expect(data.issues).toHaveLength(2);
});

it('treats a legitimately empty sprint source as [] with zero sprint totals', () => {
  const data = season({
    races: [raceRow(1, [result('a', 1, '25'), result('b', 2, '18')])],
    sprints: [],
    qualifying: [],
  });
  const cmp = buildWeekendComparison(data, 'a', 'b');
  expect(cmp.a.sprintPoints).toBe(0);
  expect(cmp.a.points).toBe(25);
  expect(cmp.a.racePoints).toBe(25);
  expect(cmp.qualifyingHeadToHead).toEqual({ a: 0, b: 0, compared: 0 });
});

it('computes fractional race+sprint and DNF points, DNS excluded from starts, qualifying is not grid', () => {
  const data = season({
    races: [
      raceRow(1, [result('a', 1, '25.5'), result('b', null, '0', 'Engine')]),
      raceRow(2, [result('a', 2, '18'), result('b', 3, '15')]),
    ],
    sprints: [raceRow(1, [result('a', 1, '8'), result('b', 4, '4.5')])],
    qualifying: [
      {
        season: '2025',
        round: '1',
        raceName: 'Race 1',
        QualifyingResults: [
          {
            Driver: { driverId: 'a', givenName: 'D', familyName: 'a' },
            Constructor: { constructorId: 't', name: 'T' },
            position: '1',
          },
          {
            Driver: { driverId: 'b', givenName: 'D', familyName: 'b' },
            Constructor: { constructorId: 't', name: 'T' },
            position: '6',
          },
        ],
      },
    ],
  });
  const cmp = buildWeekendComparison(data, 'a', 'b');
  expect(cmp.a).toMatchObject({
    starts: 2,
    wins: 1,
    dnf: 0,
    racePoints: 43.5,
    sprintPoints: 8,
    points: 51.5,
  });
  expect(cmp.b).toMatchObject({
    starts: 2,
    dnf: 1,
    racePoints: 15,
    sprintPoints: 4.5,
    points: 19.5,
  });
  expect(cmp.headToHead).toEqual({ a: 1, b: 0, compared: 1 });
  expect(cmp.qualifyingHeadToHead).toEqual({ a: 1, b: 0, compared: 1 });
  // Qualifying pole for driver a must not leak into race position rows.
  expect(cmp.series[0]?.aPosition).toBe(1);
  expect(cmp.series[0]?.aQualifying).toBe(1);
});

it('counts a sprint-only round while race head-to-head remains zero', () => {
  const data = season({
    races: [],
    sprints: [raceRow(1, [result('a', 2, '7'), result('b', 1, '8')])],
    qualifying: null,
  });
  const cmp = buildWeekendComparison(data, 'a', 'b', '1');
  expect(cmp.series).toHaveLength(1);
  expect(cmp.headToHead).toEqual({ a: 0, b: 0, compared: 0 });
  expect(cmp.qualifyingHeadToHead).toEqual({ a: 0, b: 0, compared: 0 });
  expect(cmp.a.sprintPoints).toBe(7);
  expect(cmp.a.points).toBe(7);
  expect(cmp.series[0]).toMatchObject({ aRacePoints: null, aSprintPoints: 7, aQualifying: null });
});

it('nulls sprint and total points across the aggregate when the sprint source failed', () => {
  const data = season({
    races: [raceRow(1, [result('a', 1, '25'), result('b', 2, '18')])],
    sprints: null,
    qualifying: null,
  });
  const cmp = buildWeekendComparison(data, 'a', 'b');
  expect(cmp.a.racePoints).toBe(25);
  expect(cmp.a.sprintPoints).toBeNull();
  expect(cmp.a.points).toBeNull();
  expect(cmp.series[0]?.aSprintPoints).toBeNull();
  expect(cmp.series[0]?.aPoints).toBeNull();
});

it('rejects the mandatory races request failure', async () => {
  vi.mocked(api).mockRejectedValue(new Error('down https://secret.example/token=abc'));
  await expect(fetchWeekendSeason(2025)).rejects.toThrow(
    'Не удалось загрузить результаты сезона 2025',
  );
});
