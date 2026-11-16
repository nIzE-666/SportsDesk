import { describe, expect, it } from 'vitest';
import {
  appendError,
  buildWeekDays,
  createTaskQueue,
  earlierFetchedAt,
  localDayKey,
  localMidnightUtc,
  orderFinishedForEvents,
  parseDateMatches,
  parseEvents,
  parseSeasonMatches,
  resolveWeekWindow,
  selectWeekMatches,
  shiftDayKey,
  weekProgress,
  WEEK_FUTURE_DAYS,
  WEEK_PAST_DAYS,
  type DateMatchSummary,
  type WeekMatch,
} from './weekData';

function match(
  id: string,
  leagueId: string,
  leagueName: string,
  timeUtc: string,
  status = 'finished',
  extra: Partial<DateMatchSummary> = {},
): DateMatchSummary {
  return {
    id,
    league: { id: leagueId, name: leagueName },
    home_team: { id: `home-${id}`, name: `Home ${id}` },
    away_team: { id: `away-${id}`, name: `Away ${id}` },
    status,
    time_utc: timeUtc,
    score_home: status === 'finished' ? 1 : null,
    score_away: status === 'finished' ? 0 : null,
    ...extra,
  };
}

const FOLLOWED = new Set(['l_4WFCIZ', 'l_0ALvwF']);

describe('the local week window', () => {
  it('covers the right local days in UTC+9 around midnight', () => {
    const before = resolveWeekWindow(Date.parse('2026-11-16T14:59:00Z'), 'Asia/Tokyo');
    expect(before.days).toHaveLength(WEEK_PAST_DAYS + WEEK_FUTURE_DAYS + 1);
    expect(before.days[0]).toBe('2026-11-09');
    expect(before.days[7]).toBe('2026-11-16');
    expect(before.days.at(-1)).toBe('2026-11-23');
    expect(new Date(before.startMs).toISOString()).toBe('2026-11-08T15:00:00.000Z');
    expect(new Date(before.endMs).toISOString()).toBe('2026-11-23T15:00:00.000Z');
    expect(before.utcDates[0]).toBe('2026-11-08');
    expect(before.utcDates.at(-1)).toBe('2026-11-23');

    const after = resolveWeekWindow(Date.parse('2026-11-16T15:00:00Z'), 'Asia/Tokyo');
    expect(after.days[0]).toBe('2026-11-10');
    expect(after.days[7]).toBe('2026-11-17');
    expect(after.days.at(-1)).toBe('2026-11-24');
    expect(new Date(after.startMs).toISOString()).toBe('2026-11-09T15:00:00.000Z');
    expect(new Date(after.endMs).toISOString()).toBe('2026-11-24T15:00:00.000Z');
    expect(after.utcDates[0]).toBe('2026-11-09');
    expect(after.utcDates.at(-1)).toBe('2026-11-24');
  });

  it('covers the right local days in UTC-5 around midnight', () => {
    const before = resolveWeekWindow(Date.parse('2026-11-16T04:59:00Z'), 'America/New_York');
    expect(before.days[0]).toBe('2026-11-08');
    expect(before.days[7]).toBe('2026-11-15');
    expect(before.days.at(-1)).toBe('2026-11-22');
    expect(new Date(before.startMs).toISOString()).toBe('2026-11-08T05:00:00.000Z');
    expect(new Date(before.endMs).toISOString()).toBe('2026-11-23T05:00:00.000Z');
    expect(before.utcDates[0]).toBe('2026-11-08');
    expect(before.utcDates.at(-1)).toBe('2026-11-23');

    const after = resolveWeekWindow(Date.parse('2026-11-16T05:00:00Z'), 'America/New_York');
    expect(after.days[0]).toBe('2026-11-09');
    expect(after.days[7]).toBe('2026-11-16');
    expect(after.days.at(-1)).toBe('2026-11-23');
    expect(new Date(after.startMs).toISOString()).toBe('2026-11-09T05:00:00.000Z');
    expect(new Date(after.endMs).toISOString()).toBe('2026-11-24T05:00:00.000Z');
    expect(after.utcDates[0]).toBe('2026-11-09');
    expect(after.utcDates.at(-1)).toBe('2026-11-24');
  });

  it('keeps an ordinary UTC window at fifteen UTC day lists', () => {
    const window = resolveWeekWindow(Date.parse('2026-11-16T12:00:00Z'), 'UTC');
    expect(window.utcDates).toHaveLength(15);
    expect(window.utcDates[0]).toBe('2026-11-09');
    expect(window.utcDates.at(-1)).toBe('2026-11-23');
    expect(localMidnightUtc('2026-11-16', 'UTC')).toBe(Date.parse('2026-11-16T00:00:00Z'));
    expect(localDayKey(Date.parse('2026-11-16T23:59:00Z'), 'UTC')).toBe('2026-11-16');
    expect(shiftDayKey('2026-11-30', 1)).toBe('2026-12-01');
  });
});

describe('filtering the week by league id', () => {
  const window = resolveWeekWindow(Date.parse('2026-11-16T12:00:00Z'), 'UTC');

  it('leaves out same-name leagues from other countries', () => {
    const selected = selectWeekMatches(
      [
        match('followed-serie-a', 'l_0ALvwF', 'Serie A', '2026-11-15T18:00:00Z'),
        match('brazil-serie-a', 'l_brazil', 'Serie A', '2026-11-15T18:00:00Z'),
        match('ecuador-serie-a', 'l_ecuador', 'Serie A', '2026-11-15T19:00:00Z'),
        match('canada-premier', 'l_canada', 'Premier League', '2026-11-15T20:00:00Z'),
        match('austria-bundesliga', 'l_austria', 'Bundesliga', '2026-11-15T20:00:00Z'),
        match('followed-premier', 'l_4WFCIZ', 'Premier League', '2026-11-16T20:00:00Z'),
      ],
      FOLLOWED,
      window,
    );
    expect(selected.map((item) => item.summary.id)).toEqual([
      'followed-serie-a',
      'followed-premier',
    ]);
  });

  it('keeps only local kickoffs inside the window and preserves the state', () => {
    const selected = selectWeekMatches(
      [
        match('before', 'l_4WFCIZ', 'Premier League', '2026-11-08T23:59:00Z'),
        match('start', 'l_4WFCIZ', 'Premier League', '2026-11-09T00:00:00Z'),
        match('end', 'l_4WFCIZ', 'Premier League', '2026-11-24T00:00:00Z'),
        match('after', 'l_4WFCIZ', 'Premier League', '2026-11-24T00:01:00Z'),
        match('postponed', 'l_4WFCIZ', 'Premier League', '2026-11-15T12:00:00Z', 'postponed'),
        match('cancelled', 'l_4WFCIZ', 'Premier League', '2026-11-15T13:00:00Z', 'cancelled'),
        match('unknown', 'l_4WFCIZ', 'Premier League', '2026-11-15T14:00:00Z', 'weird'),
      ],
      FOLLOWED,
      window,
    );
    expect(selected.map((item) => item.summary.id)).toEqual([
      'start',
      'postponed',
      'cancelled',
      'unknown',
    ]);
    expect(selected.map((item) => item.state)).toEqual([
      'finished',
      'postponed',
      'cancelled',
      'unknown',
    ]);
  });

  it('groups matches by the user local day, not by the UTC day list', () => {
    const tokyoWindow = resolveWeekWindow(Date.parse('2026-11-16T15:00:00Z'), 'Asia/Tokyo');
    const lateUtc = match('late', 'l_4WFCIZ', 'Premier League', '2026-11-16T16:00:00Z');
    const selected = selectWeekMatches([lateUtc], FOLLOWED, tokyoWindow);
    const days = buildWeekDays(tokyoWindow, selected, 'Asia/Tokyo');
    expect(days.find((day) => day.date === '2026-11-17')?.matches.map((m) => m.summary.id)).toEqual(
      ['late'],
    );
    expect(days.find((day) => day.date === '2026-11-16')?.matches).toEqual([]);
  });
});

describe('the events queue', () => {
  it('orders finished matches newest first and never queues postponed or cancelled ones', () => {
    const matches: WeekMatch[] = [
      {
        summary: match('old', 'l_4WFCIZ', 'PL', '2026-11-10T12:00:00Z'),
        leagueId: 'l_4WFCIZ',
        state: 'finished',
      },
      {
        summary: match('new', 'l_4WFCIZ', 'PL', '2026-11-16T12:00:00Z'),
        leagueId: 'l_4WFCIZ',
        state: 'finished',
      },
      {
        summary: match('postponed', 'l_4WFCIZ', 'PL', '2026-11-15T12:00:00Z', 'postponed'),
        leagueId: 'l_4WFCIZ',
        state: 'postponed',
      },
      {
        summary: match('cancelled', 'l_4WFCIZ', 'PL', '2026-11-15T13:00:00Z', 'cancelled'),
        leagueId: 'l_4WFCIZ',
        state: 'cancelled',
      },
    ];
    expect(orderFinishedForEvents(matches).map((item) => item.summary.id)).toEqual(['new', 'old']);
  });

  it('runs at most four tasks at a time', async () => {
    const queue = createTaskQueue(4);
    let active = 0;
    let max = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        queue.run(async () => {
          active += 1;
          max = Math.max(max, active);
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          active -= 1;
          return index;
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(max).toBe(4);
    expect(queue.active).toBe(0);
    expect(queue.pending).toBe(0);
  });

  it('keeps the FIFO order of queued tasks', async () => {
    const queue = createTaskQueue(1);
    const started: number[] = [];
    await Promise.all(
      [0, 1, 2].map((index) =>
        queue.run(async () => {
          started.push(index);
        }),
      ),
    );
    expect(started).toEqual([0, 1, 2]);
  });
});

describe('provider payloads and progress', () => {
  it('reads the events and season lists from the usual envelope', () => {
    expect(parseEvents({ data: { events: [{ event_type: 'goal', minute: 10 }] } })).toHaveLength(1);
    expect(parseEvents({ data: { events: [] } })).toEqual([]);
    expect(parseEvents({ data: {} })).toBeNull();
    expect(
      parseSeasonMatches({ data: { matches: [match('m', 'l', 'L', '2026-11-16T12:00:00Z')] } }),
    ).toHaveLength(1);
    expect(parseSeasonMatches({ data: {} })).toBeNull();
    expect(parseDateMatches({ data: { matches: [] } })).toEqual([]);
    expect(parseDateMatches({ data: {} })).toBeNull();
  });

  it('counts only loaded events and keeps the honest «загружено» label', () => {
    const progress = weekProgress(
      {
        a: { status: 'loaded', events: [] },
        b: { status: 'missing', events: [] },
        c: { status: 'failed', events: [] },
        d: { status: 'pending', events: [] },
      },
      4,
    );
    expect(progress).toEqual({ loaded: 1, total: 4, label: 'загружено 1 из 4' });
  });

  it('keeps the oldest data timestamp and does not duplicate errors', () => {
    expect(earlierFetchedAt(null, '2026-11-16T10:00:00Z')).toBe('2026-11-16T10:00:00Z');
    expect(earlierFetchedAt('2026-11-16T10:00:00Z', '2026-11-16T09:00:00Z')).toBe(
      '2026-11-16T09:00:00Z',
    );
    expect(earlierFetchedAt('2026-11-16T10:00:00Z', 'not a date')).toBe('2026-11-16T10:00:00Z');
    const errors = appendError([], { scope: 'day', key: '2026-11-10', message: 'offline' });
    expect(appendError(errors, { scope: 'day', key: '2026-11-10', message: 'again' })).toBe(errors);
  });
});
