import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import {
  fetchPlayerForm,
  playerFormRow,
  selectPlayerFormFixtures,
  selectPlayerFormWindow,
} from './playerForm';
import type { MatchSummary, PlayerMatchEntry, PlayerStatEntry } from './types';
import { formatDate, formatShortDate } from './storage';

vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));
beforeEach(() => {
  vi.mocked(api).mockReset();
});

const metric = (key: string, value: number | string | null, type = 'integer'): PlayerStatEntry => ({
  key,
  stat: { type, value: value as number },
});
const player = (
  stats: Record<string, PlayerStatEntry>,
  teamId = 'club',
  playerId = 'player',
): PlayerMatchEntry => ({
  player: { id: playerId, name: 'Player' },
  team_id: teamId,
  stats: [{ key: 'top', title: 'Top stats', stats }],
});
const fixture = (id: string, day: number, overrides: Partial<MatchSummary> = {}): MatchSummary => ({
  id,
  date: new Date(Date.UTC(2026, 0, day)).toISOString(),
  status: 'finished',
  home_team: { id: 'club', name: 'Club' },
  away_team: { id: 'opponent', name: 'Opponent' },
  score_home: 1,
  score_away: 0,
  ...overrides,
});
const reply = (entries: PlayerMatchEntry[], stale = false) => ({
  source: 'pitch',
  payload: { data: entries },
  fetchedAt: '2026-10-25T00:00:00Z',
  stale,
});

it('selects exact finished club fixtures, resolves duplicate copies and orders independently of input', () => {
  const list = [
    fixture('order_a', 1),
    fixture('order_b', 2),
    fixture('order_c', 3),
    fixture('order_b', 1),
    fixture('order_invalid-time', 4, { time_utc: 'not a time' }),
    fixture('order_away', 5, {
      home_team: { id: 'other', name: 'Club' },
      away_team: { id: 'club', name: 'Club' },
    }),
    fixture('order_same-name', 6, { home_team: { id: 'club2', name: 'Club' } }),
    fixture('order_future', 7, { status: 'upcoming' }),
    fixture('order_live', 8, { status: 'live' }),
    fixture('order_unknown', 9, { status: '' }),
    fixture('order_undated', 10, { date: undefined }),
    fixture('order_tie-b', 3),
    fixture('order_tie-a', 3),
  ];
  const selected = selectPlayerFormFixtures('club', list);
  expect(selected.map((match) => match.id)).toEqual([
    'order_away',
    'order_invalid-time',
    'order_c',
    'order_tie-a',
    'order_tie-b',
    'order_b',
    'order_a',
    'order_undated',
  ]);
  expect(selectPlayerFormFixtures('club', list.slice().reverse())).toEqual(selected);
  expect(selectPlayerFormFixtures('', list)).toEqual([]);
});

it('orders offsetless provider timestamps as UTC alongside explicit offsets and date-only records', () => {
  vi.stubEnv('TZ', 'Asia/Yakutsk');
  try {
    const fixtures = [
      fixture('utc_date_only', 2, { time_utc: undefined, date: '2026-01-02' }),
      fixture('utc_space', 2, { time_utc: '2026-01-02 01:00:00' }),
      fixture('utc_minutes', 2, { time_utc: '2026-01-02T02:00' }),
      fixture('utc_z', 2, { time_utc: '2026-01-02T03:00:00Z' }),
      fixture('utc_offset', 2, { time_utc: '2026-01-02T13:00:00+09:00' }),
    ];
    expect(selectPlayerFormFixtures('club', fixtures).map((match) => match.id)).toEqual([
      'utc_offset',
      'utc_z',
      'utc_minutes',
      'utc_space',
      'utc_date_only',
    ]);
    expect(playerFormRow(fixtures[1]!, [], 'player', 'club').date).toBe('2026-01-02T01:00:00.000Z');
    expect(playerFormRow(fixtures[0]!, [], 'player', 'club').date).toBe('2026-01-02');
  } finally {
    vi.unstubAllEnvs();
  }
});

it('falls back from malformed times and never normalizes impossible dates or24-hour times', () => {
  const fallback = fixture('utc_fallback', 2, {
    time_utc: '2026-01-03T25:00:00Z',
    date: '2026-01-02',
  });
  const impossible = fixture('utc_impossible', 2, {
    time_utc: '2026-02-30T12:00:00Z',
    date: '2026-02-30',
  });
  const hours = fixture('utc_hours', 2, { time_utc: '2026-01-02T24:00:00Z', date: undefined });
  expect(playerFormRow(fallback, [], 'player', 'club').date).toBe('2026-01-02');
  expect(playerFormRow(impossible, [], 'player', 'club').date).toBeNull();
  expect(playerFormRow(hours, [], 'player', 'club').date).toBeNull();
  expect(selectPlayerFormFixtures('club', [impossible, hours, fallback])[0]?.id).toBe(
    'utc_fallback',
  );
});

it('preserves a fixture calendar day for labels while converting actual kickoff timestamps', () => {
  const day = playerFormRow(
    fixture('label_day', 2, { date: '2026-01-02', time_utc: undefined }),
    [],
    'player',
    'club',
  );
  const kickoff = playerFormRow(
    fixture('label_time', 2, { time_utc: '2026-01-02T23:30:00Z' }),
    [],
    'player',
    'club',
  );
  expect(day.date).toBe('2026-01-02');
  expect(formatDate(day.date, 'Pacific/Kiritimati')).toBe('2 января 2026');
  expect(formatShortDate(day.date, 'Etc/GMT+12')).toBe('2 янв');
  expect(formatDate(kickoff.date, 'Pacific/Kiritimati')).toBe('3 января 2026');
});

it('caps work at latest60, deduplicates, preserves chronology and uses at most3 concurrent requests', async () => {
  let active = 0;
  let maxActive = 0;
  vi.mocked(api).mockImplementation(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return reply([]);
  });
  const fixtures = Array.from({ length: 65 }, (_, index) => fixture(`cap_${index}`, index + 1));
  fixtures.splice(3, 0, fixture('cap_20', 21));
  const progress = vi.fn();
  const result = await fetchPlayerForm('player', 'club', fixtures, 10, progress);
  expect(api).toHaveBeenCalledTimes(60);
  expect(maxActive).toBe(3);
  expect(result).toMatchObject({ totalCandidates: 65, scanned: 60, available: 0, failed: 0 });
  expect(result.baselineRows).toHaveLength(60);
  expect(result.baselineRows[0]?.id).toBe('cap_5');
  expect(result.baselineRows.at(-1)?.id).toBe('cap_64');
  expect(result.rows.map((row) => row.id)).toEqual(
    Array.from({ length: 10 }, (_, index) => `cap_${index + 55}`),
  );
  expect(progress).toHaveBeenLastCalledWith(60, 60);
  expect(result.baseline.from).toBe(fixtures.find((match) => match.id === 'cap_5')?.date);
  expect(result.baseline.to).toBe(fixtures.find((match) => match.id === 'cap_64')?.date);
});

it('uses canonical numeric keys for the exact player and team without summing aliases or duplicates', () => {
  const row = playerFormRow(
    fixture('row_keys', 1),
    [
      player({ goals: metric('goals', 90) }, 'wrong-team'),
      player({ goals: metric('goals', 80) }, 'club', 'another-player'),
      player({
        minutes_alias: metric('minutes', 1),
        minutes: metric('minutes_played', '90'),
        rating_alias: metric('rating', 2, 'double'),
        rating: metric('rating_title', '8.5', 'double'),
        goals: metric('goals', 0),
        assists: metric('assists', 1),
      }),
      player({ goals: metric('goals', 40), minutes: metric('minutes_played', 90) }),
    ],
    'player',
    'club',
  );
  expect(row).toMatchObject({
    status: 'available',
    playerPresent: true,
    rating: 8.5,
    minutes: 90,
    goals: 0,
    assists: 1,
  });
  const unknown = playerFormRow(
    fixture('row_invalid', 2),
    [
      player({
        rating: metric('rating_title', Number.NaN, 'double'),
        goals: metric('goals', -1),
        assists: metric('assists', null),
        minutes: metric('minutes_played', 1, 'boolean'),
      }),
    ],
    'player',
    'club',
  );
  expect(unknown).toMatchObject({
    status: 'missing',
    playerPresent: true,
    rating: null,
    minutes: null,
    goals: null,
    assists: null,
  });
});

it('keeps recent fixture gaps and DNP markers, preserving known zeros and per-metric denominators', async () => {
  const fixtures = Array.from({ length: 9 }, (_, index) =>
    fixture(`coverage_${index + 1}`, index + 1),
  );
  vi.mocked(api).mockImplementation(async (_source, path) => {
    const number = Number(path.split('/')[1]?.split('_')[1]);
    if (number <= 4)
      return reply([
        player({
          minutes: metric('minutes_played', 90),
          rating: metric('rating_title', 8, 'double'),
          goals: metric('goals', 1),
          assists: metric('assists', 0),
        }),
      ]);
    if (number === 5)
      return reply([player({ minutes: metric('minutes_played', 0), goals: metric('goals', 0) })]);
    if (number === 6) return reply([]);
    if (number === 7) return reply([player({})]);
    if (number === 8) throw new Error('Provider unavailable');
    return reply([player({ minutes: metric('minutes_played', 40) })], true);
  });
  const result = await fetchPlayerForm('player', 'club', fixtures, 5);
  expect(result.rows.map((row) => [row.id, row.status])).toEqual([
    ['coverage_5', 'not-played'],
    ['coverage_6', 'missing'],
    ['coverage_7', 'missing'],
    ['coverage_8', 'failed'],
    ['coverage_9', 'available'],
  ]);
  expect(result).toMatchObject({
    totalCandidates: 9,
    scanned: 9,
    available: 6,
    failed: 1,
    stale: true,
  });
  expect(result.recent).toMatchObject({
    fixtures: 5,
    available: 2,
    missing: 2,
    failed: 1,
    notPlayed: 1,
  });
  expect(result.recent.metrics).toEqual({
    rating: { mean: null, total: null, observed: 0 },
    minutes: { mean: 20, total: 40, observed: 2 },
    goals: { mean: 0, total: 0, observed: 1 },
    assists: { mean: null, total: null, observed: 0 },
  });
  expect(result.baseline.metrics.rating).toEqual({ mean: 8, total: 32, observed: 4 });
  expect(result.baseline.metrics.goals).toEqual({ mean: 0.8, total: 4, observed: 5 });
  const ten = selectPlayerFormWindow(result, 10);
  expect(ten.rows).toHaveLength(9);
  expect(ten.recent).toEqual(ten.baseline);
  expect(ten.baselineRows).toBe(result.baselineRows);
  expect(api).toHaveBeenCalledTimes(9);
});

it('shares successful match cache, retries failures and tolerates a broken progress callback', async () => {
  let failedAttempt = true;
  vi.mocked(api).mockImplementation(async (_source, path) => {
    if (path.includes('retry_failure') && failedAttempt) {
      failedAttempt = false;
      throw new Error('Temporary');
    }
    return reply([player({ goals: metric('goals', 0) })]);
  });
  const fixtures = [fixture('retry_success', 1), fixture('retry_failure', 2)];
  const first = await fetchPlayerForm('player', 'club', fixtures, 5, () => {
    throw new Error('Consumer');
  });
  expect(first.failed).toBe(1);
  const second = await fetchPlayerForm('player', 'club', fixtures, 10);
  expect(second.failed).toBe(0);
  expect(second.available).toBe(2);
  expect(api).toHaveBeenCalledTimes(3);
});

it('does not request data for empty selection', async () => {
  const result = await fetchPlayerForm('', 'club', [fixture('empty', 1)]);
  expect(result.rows).toEqual([]);
  expect(result.baselineRows).toEqual([]);
  expect(result.baseline).toMatchObject({ fixtures: 0, available: 0, from: null, to: null });
  expect(api).not.toHaveBeenCalled();
});
