import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { fetchBracketFor, groupBracket } from './bracket';
import type { MatchSummary } from '../football/types';
vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));
beforeEach(() => vi.mocked(api).mockReset());
const fixture: MatchSummary = {
  id: 'wc-final-july',
  date: '2026-07-19',
  status: 'finished',
  round_name: 'final',
  home_team: { id: 'a', name: 'A' },
  away_team: { id: 'b', name: 'B' },
  score_home: 2,
  score_away: 1,
};
it('includes July finals for single-year tournaments and finishes one-game knockout ties', async () => {
  vi.mocked(api).mockResolvedValue({
    source: 'pitch',
    payload: { data: fixture },
    stale: false,
    fetchedAt: '2026-10-21T00:00:00Z',
  });
  const result = await fetchBracketFor([fixture], '2026', undefined, 'single-leg');
  expect(api).toHaveBeenCalledOnce();
  expect(result.ties[0]).toMatchObject({
    complete: true,
    winnerId: 'a',
    aggregateHome: 2,
    aggregateAway: 1,
  });
  expect(groupBracket([{ ...fixture, round_name: '1/4' }], 'single-leg')[0]?.complete).toBe(true);
  expect(groupBracket([{ ...fixture, round_name: '1/4' }])[0]?.complete).toBe(false);
});
it('keeps winter World Cups and third-place matches without treating a tied score as a winner', async () => {
  const winter = {
    ...fixture,
    id: 'wc-winter-final',
    date: '2022-12-18',
    score_home: 3,
    score_away: 3,
  };
  vi.mocked(api).mockResolvedValue({
    source: 'pitch',
    payload: { data: winter },
    stale: false,
    fetchedAt: '2026-10-21T00:00:00Z',
  });
  const result = await fetchBracketFor([winter], '2022', undefined, 'single-leg');
  expect(result.ties[0]).toMatchObject({ complete: true, winnerId: null });
  expect(
    groupBracket([{ ...fixture, round_name: 'Third place play-off' }], 'single-leg')[0],
  ).toMatchObject({ round: 'third', complete: true });
});
