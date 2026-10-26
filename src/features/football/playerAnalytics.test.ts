import { expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { fetchPlayerSeasonStats } from './playerAnalytics';
import type { MatchSummary, PlayerMatchEntry, PlayerStatEntry } from './types';

vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));

const metric = (key: string, value: number, type = 'integer', total?: number): PlayerStatEntry => ({
  key,
  stat: { type, value, ...(total === undefined ? {} : { total }) },
});
const player = (stats: Record<string, PlayerStatEntry>): PlayerMatchEntry => ({
  player: { id: 'p_analytics', name: 'Player' },
  team_id: 't_home',
  stats: Object.keys(stats).length ? [{ key: 'top', title: 'Top stats', stats }] : [],
});
const match = (id: string, status = 'finished', homeId = 't_home'): MatchSummary => ({
  id,
  status,
  date: '2026-10-01',
  home_team: { id: homeId, name: 'Home' },
  away_team: { id: 't_away', name: 'Away' },
  score_home: 1,
  score_away: 0,
});

it('weights pass accuracy, preserves missing coverage and excludes unused substitutes and other fixtures', async () => {
  const entries: Record<string, PlayerMatchEntry[]> = {
    m_a: [
      player({
        minutes: metric('minutes_played', 90),
        rating: metric('rating_title', 8, 'double'),
        goals: metric('goals', 1),
        passes: metric('accurate_passes', 9, 'fractionWithPercentage', 10),
        xg: metric('expected_goals', 0.2, 'double'),
      }),
    ],
    m_b: [
      player({
        minutes: metric('minutes_played', 30),
        rating: metric('rating_title', 6, 'double'),
        passes: metric('accurate_passes', 1, 'fractionWithPercentage', 2),
        xg: metric('expected_goals', 0.1, 'double'),
      }),
    ],
    m_bench: [player({})],
    m_absent: [],
  };
  vi.mocked(api).mockImplementation(async (_source, path) => {
    const id = path.split('/')[1];
    if (id === 'm_failed') throw new Error('Unavailable');
    if (!id || !(id in entries)) throw new Error('Unexpected fixture');
    return {
      source: 'pitch',
      payload: { data: entries[id] },
      fetchedAt: '2026-10-21T00:00:00Z',
      stale: id === 'm_b',
    };
  });
  const onProgress = vi.fn();
  const result = await fetchPlayerSeasonStats(
    'p_analytics',
    't_home',
    [
      ...Object.keys(entries).map((id) => match(id)),
      match('m_failed'),
      match('m_a'),
      match('m_upcoming', 'upcoming'),
      match('m_unknown', ''),
      match('m_other', 'finished', 't_other'),
    ],
    onProgress,
  );
  expect(api).toHaveBeenCalledTimes(5);
  expect(onProgress).toHaveBeenLastCalledWith(5, 5);
  expect(result).toMatchObject({
    scanned: 5,
    totalCandidates: 5,
    available: 2,
    failed: 1,
    minutes: 120,
    stale: true,
  });
  expect(result.matches).toHaveLength(2);
  const metrics = new Map(result.metrics.map((m) => [m.key, m]));
  expect(metrics.get('goals')).toMatchObject({ value: 1, matches: 1 });
  expect(metrics.get('rating_avg')).toMatchObject({ value: 7, kind: 'average', matches: 2 });
  expect(metrics.get('pass_accuracy')).toMatchObject({
    value: 83.3,
    total: 12,
    kind: 'fraction',
    matches: 2,
  });
  expect(metrics.get('xg')).toMatchObject({ value: 0.3, matches: 2 });
});
