import type { Page } from '@playwright/test';
import {
  CUP_ID,
  CUP_MATCHES,
  CUP_SEASONS,
  CUP_TABLE_GROUPS,
  TOURNAMENT_DETAILS,
  TOURNAMENT_FETCHED_AT,
  TOURNAMENT_SEASON,
  UCL_ID,
  UCL_MATCHES,
  UCL_SCORERS,
  UCL_SEASONS,
  UCL_TABLE,
  WORLD_CUP_MATCHES,
  WORLD_CUP_SEASONS,
} from '../src/test/fixtures/tournamentSeason';

/**
 * TEST DATA ONLY — installs the invented European season from
 * `src/test/fixtures/tournamentSeason.ts` on top of the visual fixture.
 *
 * Register it after `setupVisualFixture` so these routes win; anything they do
 * not handle falls back to the base fixture.
 */
export async function installTournamentFixture(page: Page): Promise<void> {
  await page.route('**/bridge/api**', async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source');
    const path = url.searchParams.get('path') ?? '';
    const reply = (payload: unknown) =>
      route.fulfill({
        json: { payload, source, stale: false, fetchedAt: TOURNAMENT_FETCHED_AT },
      });

    if (source === 'pitch') {
      if (path === 'leagues')
        return reply({
          data: {
            leagues: [
              { id: 'l_4WFCIZ', name: 'Premier League', seasons: [TOURNAMENT_SEASON] },
              { id: UCL_ID, name: 'Champions League', seasons: UCL_SEASONS },
              { id: CUP_ID, name: 'Europa League', seasons: CUP_SEASONS },
              { id: 'l_1XLtP0', name: 'World Cup', seasons: WORLD_CUP_SEASONS },
            ],
          },
        });
      if (path.startsWith(`leagues/${UCL_ID}/matches`))
        return reply({
          data: {
            league: { id: UCL_ID, name: 'Champions League' },
            matches: UCL_MATCHES,
          },
        });
      if (path.startsWith(`leagues/${CUP_ID}/matches`))
        return reply({
          data: {
            league: { id: CUP_ID, name: 'Europa League' },
            matches: CUP_MATCHES,
          },
        });
      if (path.startsWith('leagues/l_1XLtP0/matches'))
        return reply({
          data: {
            league: { id: 'l_1XLtP0', name: 'World Cup' },
            matches: WORLD_CUP_MATCHES,
          },
        });
      const matchId = /^matches\/([^/?]+)/.exec(path)?.[1];
      if (matchId) {
        const match = TOURNAMENT_DETAILS.get(matchId);
        if (match) return reply({ data: match });
      }
    }

    if (source === 'sportscore') {
      if (path.startsWith('standings/') && path.includes('uefa-champions-league'))
        return reply({
          competition: 'Champions League',
          tables: [{ rows: UCL_TABLE }],
        });
      if (path.startsWith('standings/') && path.includes('uefa-europa-league'))
        return reply({ competition: 'Europa League', tables: CUP_TABLE_GROUPS });
      if (path.startsWith('topscorers/') && path.includes('uefa-champions-league'))
        return reply({ scorers: UCL_SCORERS });
      if (path.startsWith('topscorers/')) return reply({ scorers: [] });
      if (path.startsWith('player/')) return reply({ nationality: 'Англия' });
    }

    return route.fallback();
  });
}
