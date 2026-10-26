// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { loadLiveFeed } from './liveFeed';
vi.mock('../../lib/bridge', () => ({ api: vi.fn(), isTauriRuntime: () => false, rpc: vi.fn() }));
const fixture = (id: string, homeId = 't_Arsenal', homeName = 'Arsenal') => ({
  id,
  status: 'scheduled',
  home_team: { id: homeId, name: homeName },
  away_team: { id: 't_Chelsea', name: 'Chelsea' },
  time_utc: '2032-08-01T14:00:00Z',
  score_home: null,
  score_away: null,
});
const reply = (matches: unknown[]) => ({
  payload: { data: { matches } },
  fetchedAt: '2026-10-26T00:00:00Z',
  source: 'pitch',
  stale: false,
});
beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockReset();
  localStorage.setItem(
    'sportsdesk.football.favorites.teams',
    JSON.stringify({
      ids: ['t_Arsenal'],
      dismissed: [
        'Chelsea',
        'Barcelona',
        'Real Madrid',
        'Liverpool',
        'Manchester City',
        'Brighton',
        'Inter Miami',
        'Atletico Madrid',
        'Real Betis',
      ],
    }),
  );
  localStorage.setItem(
    'sportsdesk.football.catalogue',
    JSON.stringify([{ id: 't_Arsenal', name: 'Arsenal', leagueId: 'l_EPL' }]),
  );
});
it('finds favourite number 151, rejects same-name wrong IDs and merges days without duplicates', async () => {
  vi.mocked(api).mockImplementation(async (_source, path) =>
    reply(
      path.startsWith('date/')
        ? [
            ...Array.from({ length: 150 }, (_, i) => fixture('m_' + i, 't_other', 'Other')),
            fixture('m_favourite'),
            fixture('m_wrong', 't_different', 'Arsenal'),
            fixture('m_youth', 't_u21', 'Arsenal U21'),
          ]
        : [],
    ),
  );
  const result = await loadLiveFeed();
  expect(result.matches.map((m) => m.id)).toEqual(['m_favourite']);
  expect(vi.mocked(api).mock.calls.filter((c) => c[1].startsWith('date/'))).toHaveLength(3);
});
it('includes a future league fixture beyond three days and prefers the daily result for a shared ID', async () => {
  vi.mocked(api).mockImplementation(async (_s, path) =>
    reply(
      path.startsWith('leagues/')
        ? [fixture('m_next'), fixture('m_shared')]
        : [{ ...fixture('m_shared'), status: 'finished', score_home: 2, score_away: 1 }],
    ),
  );
  const result = await loadLiveFeed();
  expect(result.matches.find((m) => m.id === 'm_shared')?.home_score).toBe(2);
  expect(result.matches.some((m) => m.id === 'm_next')).toBe(true);
});
