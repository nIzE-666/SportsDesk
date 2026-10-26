/** Explicit real-provider acceptance: F1_REAL_ACCEPTANCE=1, dev bridge on :1420. */
import { expect, it, vi } from 'vitest';
import { fetchWeekendSeason, buildWeekendComparison } from './weekendData';
vi.mock('../../lib/bridge', () => ({
  api: async (source: string, path: string) => {
    const response = await fetch(
      `http://127.0.0.1:1420/bridge/api?${new URLSearchParams({ source, path })}`,
      { headers: { Origin: 'http://127.0.0.1:1420' } },
    );
    if (!response.ok) throw new Error(`Provider bridge returned ${response.status}`);
    return response.json();
  },
}));
it.skipIf(process.env.F1_REAL_ACCEPTANCE !== '1')(
  'loads the complete 2025 weekend season and reconciles Verstappen points with the published standings',
  async () => {
    const data = await fetchWeekendSeason(2025);
    expect(data.issues).toEqual([]);
    expect(data.sprints?.length).toBeGreaterThan(0);
    expect(data.qualifying?.length).toBeGreaterThan(0);
    const response = await fetch(
      `http://127.0.0.1:1420/bridge/api?${new URLSearchParams({ source: 'jolpica', path: '2025/driverStandings.json?limit=100' })}`,
      { headers: { Origin: 'http://127.0.0.1:1420' } },
    );
    expect(response.ok).toBe(true);
    const payload = (await response.json()).payload;
    const official = payload.MRData.StandingsTable.StandingsLists[0].DriverStandings.find(
      (row: any) => row.Driver.driverId === 'max_verstappen',
    );
    const comparison = buildWeekendComparison(data, 'max_verstappen', 'russell');
    expect(comparison.a.points).toBe(Number(official.points));
    console.log(
      JSON.stringify({
        races: data.races.length,
        sprints: data.sprints?.length,
        qualifying: data.qualifying?.length,
        verstappen: comparison.a,
        officialPoints: Number(official.points),
      }),
    );
  },
  120000,
);
