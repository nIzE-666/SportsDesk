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
function page(races: unknown[], { total = 110, offset = 0, limit = 100, stale = false } = {}) {
  return {
    source: 'jolpica',
    payload: {
      MRData: {
        total: String(total),
        offset: String(offset),
        limit: String(limit),
        RaceTable: { Races: races },
      },
    },
    fetchedAt: '2026-10-21T00:00:00Z',
    stale,
  };
}

it('merges a race split across Jolpica result pages without losing drivers', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(
      page([race(1, 0, 22), race(2, 0, 22), race(3, 0, 22), race(4, 0, 22), race(5, 0, 12)]),
    )
    .mockResolvedValueOnce(page([race(5, 12, 22)], { offset: 100, stale: true }));
  const result = await fetchSeasonResults(2025);
  expect(api).toHaveBeenNthCalledWith(2, 'jolpica', '2025/results.json?limit=100&offset=100');
  expect(result.races).toHaveLength(5);
  expect(result.races[4]?.Results).toHaveLength(22);
  expect(result.stale).toBe(true);
});

it('rejects a nonempty page with fewer driver results than advertised', async () => {
  vi.mocked(api).mockResolvedValueOnce(page([race(1, 0, 99)]));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('неполную или избыточную страницу');
  expect(api).toHaveBeenCalledTimes(1);
});

it('rejects an empty intermediate page instead of showing a partial season as complete', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(page([race(1, 0, 100)]))
    .mockResolvedValueOnce(page([], { offset: 100 }));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('неполную или избыточную страницу');
});

it.each(['driver', 'circuit'])('rejects a malformed %s dropped by the parser', async (part) => {
  const malformed = race(1, 0, 2);
  if (part === 'driver') malformed.Results[0]!.Driver.givenName = '';
  else malformed.Circuit.circuitId = '';
  vi.mocked(api).mockResolvedValueOnce(page([malformed], { total: 2 }));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('разобрать все результаты');
});

it('rejects duplicate driver results within a race or across overlapping pages', async () => {
  const duplicate = race(1, 0, 2);
  duplicate.Results[1]!.Driver.driverId = duplicate.Results[0]!.Driver.driverId;
  vi.mocked(api).mockResolvedValueOnce(page([duplicate], { total: 2 }));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('повторный результат пилота');

  vi.mocked(api)
    .mockResolvedValueOnce(page([race(1, 0, 100)]))
    .mockResolvedValueOnce(page([race(1, 99, 109)], { offset: 100 }));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('повторный результат пилота');
});

it('accepts an empty season only when total is zero', async () => {
  vi.mocked(api).mockResolvedValueOnce(page([], { total: 0 }));
  await expect(fetchSeasonResults(2025)).resolves.toMatchObject({ races: [], stale: false });
  expect(api).toHaveBeenCalledTimes(1);
  vi.mocked(api).mockResolvedValueOnce(page([race(1, 0, 1)], { total: 0 }));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('неполную или избыточную страницу');
});

it.each([
  { offset: 1, limit: 100 },
  { offset: 0, limit: 50 },
])('rejects inconsistent page metadata', async ({ offset, limit }) => {
  vi.mocked(api).mockResolvedValueOnce(page([race(1, 0, 2)], { total: 2, offset, limit }));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('offset или limit');
});

it('rejects a changing total and inconsistent metadata for a split race', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(page([race(1, 0, 100)]))
    .mockResolvedValueOnce(page([race(1, 100, 111)], { total: 111, offset: 100 }));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('противоречивый total');

  const next = race(1, 100, 110);
  next.raceName = 'Different race';
  vi.mocked(api)
    .mockResolvedValueOnce(page([race(1, 0, 100)]))
    .mockResolvedValueOnce(page([next], { offset: 100 }));
  await expect(fetchSeasonResults(2025)).rejects.toThrow('противоречивые данные одного раунда');
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
