import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import type { ApiReply } from '../../lib/bridge';
import {
  buildRacePaceComparison,
  isRacePaceSessionAvailable,
  loadRacePace,
  type RacePaceData,
  type RacePaceDriverData,
} from './racePace';
import type { OpenF1Session } from './types';

vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));

function driver(
  driverNumber: number,
  laps: unknown[],
  extras: Partial<RacePaceDriverData> = {},
): RacePaceDriverData {
  return {
    driverNumber,
    laps,
    stints: [],
    pits: [],
    stintsAvailable: true,
    pitsAvailable: true,
    fetchedAt: null,
    stale: false,
    warnings: [],
    ...extras,
  };
}
function lap(driverNumber: number, lapNumber: number, duration: unknown, extras = {}) {
  return {
    session_key: 9000,
    driver_number: driverNumber,
    lap_number: lapNumber,
    lap_duration: duration,
    ...extras,
  };
}
function data(a: RacePaceDriverData, b: RacePaceDriverData): RacePaceData {
  return { sessionKey: 9000, driverA: a, driverB: b, fetchedAt: null, stale: false, warnings: [] };
}
function session(sessionKey: number): OpenF1Session {
  return {
    session_key: sessionKey,
    meeting_key: 100,
    year: 2025,
    date_end: '2025-06-01T16:00:00Z',
    session_name: 'Race',
  };
}
function reply(payload: unknown, extra: Partial<ApiReply> = {}): ApiReply {
  return { payload, source: 'openf1', fetchedAt: '2025-06-02T00:00:00Z', stale: false, ...extra };
}

beforeEach(() => {
  vi.mocked(api).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('race pace comparison', () => {
  it('keeps missing and invalid laps as gaps, and computes deltas on matching valid laps only', () => {
    const result = buildRacePaceComparison(
      data(
        driver(1, [
          lap(1, 1, null),
          lap(1, 2, 90),
          lap(1, 4, 92),
          lap(1, 5, 0),
          lap(1, 6, -3),
          lap(1, 7, ''),
          lap(1, 8, NaN),
          lap(1, 9, false),
          lap(1, 10, Infinity),
        ]),
        driver(63, [lap(63, 1, 95), lap(63, 2, 91), lap(63, 3, 94), lap(63, 4, 94)]),
      ),
    );
    expect(result.rows).toHaveLength(10);
    expect(result.rows[0]?.a.paceSeconds).toBeNull();
    expect(result.rows[2]?.a).toMatchObject({ excludedReason: 'missing', paceSeconds: null });
    expect(result.rows.map((row) => row.deltaSeconds)).toEqual([
      null,
      -1,
      null,
      -2,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(result.a).toMatchObject({
      validLapCount: 2,
      meanSeconds: 91,
      medianSeconds: 91,
      bestSeconds: 90,
    });
    expect(result.paired).toEqual({
      lapCount: 2,
      meanASeconds: 91,
      meanBSeconds: 92.5,
      meanDeltaSeconds: -1.5,
      medianDeltaSeconds: -1.5,
    });
  });

  it('marks pit in/out and inclusive stint boundaries, retaining context when pit laps are excluded', () => {
    const input = data(
      driver(
        1,
        [lap(1, 1, 100), lap(1, 2, 120), lap(1, 3, 110, { is_pit_out_lap: true }), lap(1, 4, 90)],
        {
          pits: [
            {
              session_key: 9000,
              driver_number: 1,
              lap_number: 2,
              lane_duration: 22.2,
              pit_duration: 23,
              stop_duration: 2.1,
            },
          ],
          stints: [
            {
              driver_number: 1,
              session_key: 9000,
              stint_number: 1,
              lap_start: 1,
              lap_end: 2,
              compound: 'MEDIUM',
            },
            {
              driver_number: 1,
              session_key: 9000,
              stint_number: 2,
              lap_start: 3,
              lap_end: 4,
              compound: 'HARD',
            },
          ],
        },
      ),
      driver(63, [lap(63, 2, 95), lap(63, 3, 94)]),
    );
    const filtered = buildRacePaceComparison(input);
    expect(filtered.rows[1]?.a).toMatchObject({
      pitIn: true,
      pitOut: false,
      compound: 'MEDIUM',
      stintNumber: 1,
      durationSeconds: 120,
      paceSeconds: null,
      pitLaneSeconds: 22.2,
      pitStopSeconds: 2.1,
    });
    expect(filtered.rows[2]?.a).toMatchObject({
      pitIn: false,
      pitOut: true,
      compound: 'HARD',
      excludedReason: 'pit',
    });
    expect(filtered.a).toMatchObject({
      validLapCount: 2,
      excludedPitLapCount: 2,
      medianSeconds: 95,
    });
    expect(filtered.paired.lapCount).toBe(0);
    const all = buildRacePaceComparison(input, { excludePitLaps: false });
    expect(all.paired.lapCount).toBe(2);
    expect(all.a).toMatchObject({ validLapCount: 4, excludedPitLapCount: 0, meanSeconds: 105 });
  });

  it('scopes both drivers to the session, rejects malformed lap numbers, and never counts duplicate timings twice', () => {
    const result = buildRacePaceComparison(
      data(
        driver(1, [
          lap(1, 1, 90),
          lap(1, 1, 90),
          lap(1, 2, 91),
          lap(1, 2, 92),
          lap(1, 2, 91),
          lap(1, 3, 80, { session_key: 9001 }),
          lap(63, 3, 80),
          lap(1, 0, 80),
          lap(1, 1.5, 80),
          lap(1, 1000000, 80),
        ]),
        driver(63, []),
      ),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.a).toMatchObject({ recordedLapCount: 2, validLapCount: 1, meanSeconds: 90 });
    expect(result.rows[1]?.a).toMatchObject({
      durationSeconds: null,
      excludedReason: 'invalid-duration',
    });
    expect(result.b.meanSeconds).toBeNull();
    expect(result.paired.meanDeltaSeconds).toBeNull();
  });

  it('retains unrecognised compounds and old pit-lane alias without substituting stop time', () => {
    const result = buildRacePaceComparison(
      data(
        driver(1, [lap(1, 2, 100)], {
          pits: [{ driver_number: 1, lap_number: 2, pit_duration: 25, stop_duration: 2.5 }],
          stints: [
            {
              driver_number: 1,
              lap_start: 1,
              lap_end: 3,
              compound: 'test_compound',
              stint_number: 1,
            },
          ],
        }),
        driver(63, []),
      ),
    );
    expect(result.rows[1]?.a).toMatchObject({
      compound: 'TEST_COMPOUND',
      pitLaneSeconds: 25,
      pitStopSeconds: 2.5,
    });
  });

  it('requires the historical access window and does not treat absent or invalid end dates as completed', async () => {
    const end = Date.parse('2025-06-01T16:00:00Z');
    expect(isRacePaceSessionAvailable(session(9000), end + 29 * 60_000)).toBe(false);
    expect(isRacePaceSessionAvailable(session(9000), end + 30 * 60_000)).toBe(true);
    expect(isRacePaceSessionAvailable({ ...session(9000), date_end: undefined })).toBe(false);
    expect(isRacePaceSessionAvailable({ ...session(9000), date_end: 'unknown' })).toBe(false);
    expect(isRacePaceSessionAvailable({ ...session(9000), year: 2022 })).toBe(false);
    expect(
      isRacePaceSessionAvailable({
        ...session(9000),
        year: undefined,
        date_end: '2022-06-01T00:00:00Z',
      }),
    ).toBe(false);
    await expect(loadRacePace(session(9000), 1, 1)).rejects.toThrow('разных пилотов');
    expect(api).not.toHaveBeenCalled();
  });
});

describe('race pace loader', () => {
  it('shares in-flight/cached queries by session and driver, refreshes explicitly, and spaces request starts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
    const requestTimes: number[] = [];
    vi.mocked(api).mockImplementation(async () => {
      requestTimes.push(Date.now());
      return reply([]);
    });
    const first = loadRacePace(session(9011), 1, 63);
    const concurrent = loadRacePace(session(9011), 1, 63);
    await vi.runAllTimersAsync();
    expect(await first).toEqual(await concurrent);
    expect(api).toHaveBeenCalledTimes(6);
    expect(api).toHaveBeenCalledWith('openf1', 'laps?session_key=9011&driver_number=1');
    for (let index = 1; index < requestTimes.length; index++) {
      expect(requestTimes[index]! - requestTimes[index - 1]!).toBeGreaterThanOrEqual(350);
    }
    await loadRacePace(session(9011), 1, 63);
    expect(api).toHaveBeenCalledTimes(6);
    const newPair = loadRacePace(session(9011), 1, 44);
    await vi.runAllTimersAsync();
    await newPair;
    expect(api).toHaveBeenCalledTimes(9);
    const refresh = loadRacePace(session(9011), 1, 44, { refresh: true });
    await vi.runAllTimersAsync();
    await refresh;
    expect(api).toHaveBeenCalledTimes(15);
    const anotherSession = loadRacePace(session(9012), 1, 63);
    await vi.runAllTimersAsync();
    await anotherSession;
    expect(api).toHaveBeenCalledTimes(21);
  });

  it('keeps valid lap data and stale metadata when optional pit/stint data fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
    vi.mocked(api).mockImplementation(async (_source, path) => {
      if (!path.startsWith('laps?')) throw new Error('upstream');
      const number = path.endsWith('driver_number=1') ? 1 : 63;
      return reply([lap(number, 1, 90)], { stale: number === 1 });
    });
    const pending = loadRacePace(session(9013), 1, 63);
    await vi.runAllTimersAsync();
    const loaded = await pending;
    expect(loaded.stale).toBe(true);
    expect(loaded.warnings).toHaveLength(4);
    expect(loaded.driverA).toMatchObject({ stintsAvailable: false, pitsAvailable: false });
    expect(buildRacePaceComparison({ ...loaded, sessionKey: 9000 }).paired.lapCount).toBe(1);
    expect(buildRacePaceComparison(loaded).paired.lapCount).toBe(0); // Explicit wrong session rows are dropped.
  });

  it('rejects failure of essential lap data rather than representing unavailable laps as zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
    vi.mocked(api).mockImplementation(async (_source, path) => {
      if (path.startsWith('laps?')) throw new Error('upstream');
      return reply([]);
    });
    const pending = expect(loadRacePace(session(9014), 1, 63)).rejects.toThrow('круги пилота');
    await vi.runAllTimersAsync();
    await pending;
  });

  it('respects the rolling 30-request minute budget across different comparisons', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
    const times: number[] = [];
    vi.mocked(api).mockImplementation(async () => {
      times.push(Date.now());
      return reply([]);
    });
    const pending = Promise.all(
      Array.from({ length: 6 }, (_, index) => loadRacePace(session(9030 + index), 1, 63)),
    );
    await vi.runAllTimersAsync();
    await pending;
    expect(api).toHaveBeenCalledTimes(36);
    expect(times[30]! - times[0]!).toBeGreaterThan(60_000);
    for (const time of times) {
      expect(
        times.filter((candidate) => candidate > time - 60_000 && candidate <= time),
      ).toHaveLength(Math.min(30, times.indexOf(time) + 1));
    }
  });
});
