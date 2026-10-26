import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { buildSeasonComparison, fetchSeasonResults } from './seasonData';
import type { JolpicaRaceResultRow } from './types';

vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));
beforeEach(() => vi.mocked(api).mockReset());

function race(round: number, start: number, end: number): JolpicaRaceResultRow {
  return {
    season: '2025',
    round: String(round),
    raceName: `Race ${round}`,
    date: '2025-05-01',
    Circuit: { circuitId: 'test', circuitName: 'Circuit' },
    Results: Array.from({ length: end - start }, (_, i) => ({
      Driver: {
        driverId: `driver_${i + start}`,
        givenName: 'Driver',
        familyName: String(i + start),
      },
      Constructor: { constructorId: 'team', name: 'Team' },
      position: String(i + start + 1),
      points: '0',
      status: 'Finished',
      positionText: String(i + start + 1),
    })),
  };
}
function page(races: JolpicaRaceResultRow[], stale = false) {
  return {
    source: 'jolpica',
    payload: { MRData: { total: '110', RaceTable: { Races: races } } },
    fetchedAt: '2026-10-21T00:00:00Z',
    stale,
  };
}

it('merges a race split across Jolpica result pages without losing drivers', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(
      page([race(1, 0, 22), race(2, 0, 22), race(3, 0, 22), race(4, 0, 22), race(5, 0, 12)]),
    )
    .mockResolvedValueOnce(page([race(5, 12, 22)], true));
  const result = await fetchSeasonResults(2025);
  expect(api).toHaveBeenNthCalledWith(2, 'jolpica', '2025/results.json?limit=100&offset=100');
  expect(result.races).toHaveLength(5);
  expect(result.races[4]?.Results).toHaveLength(22);
  expect(result.stale).toBe(true);
});

it('rejects an empty intermediate page instead of showing a partial season as complete', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(page([race(1, 0, 22)]))
    .mockResolvedValueOnce(page([]));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('пустую страницу');
});

it('keeps fractional points and excludes non-starts and retirements from finish comparisons', () => {
  const first = race(1, 0, 2);
  first.Results[0]!.points = '12.5';
  first.Results[1]!.points = '9';
  const second = race(2, 0, 2);
  second.Results[0]!.status = 'Engine';
  second.Results[0]!.positionText = 'R';
  second.Results[1]!.status = 'Did not start';
  second.Results[1]!.positionText = 'E';
  const result = buildSeasonComparison([second, first], 'driver_0', 'driver_1');
  expect(result.a).toMatchObject({ starts: 2, points: 12.5, wins: 1, dnf: 1 });
  expect(result.b).toMatchObject({ starts: 1, points: 9, dnf: 0 });
  expect(result.headToHead).toEqual({ a: 1, b: 0, compared: 1 });
  expect(result.series[1]).toMatchObject({ aPosition: null, bPosition: null });
});
