import { expect, it } from 'vitest';
import { calendarTime, compareUpcoming, formatFixtureTime, isUpcomingFixture } from './calendar';
import type { MatchSummary } from './types';

const match = (id: string, status: string, time_utc?: string, date?: string): MatchSummary => ({
  id,
  status,
  time_utc,
  date,
  home_team: { id: 'home', name: 'Atlético; FC' },
  away_team: { id: 'away', name: 'Away, Club' },
  score_home: null,
  score_away: null,
});

it('only lists scheduled or live fixtures and places unknown dates last', () => {
  const now = Date.parse('2032-04-03T12:00:00Z');
  const fixtures = [
    match('unknown', 'scheduled'),
    match('cancelled', 'cancelled', '2032-04-05T12:00:00Z'),
    match('postponed', 'postponed', '2032-04-05T12:00:00Z'),
    match('live', 'live', '2032-04-03T11:30:00Z'),
    match('day', 'scheduled', undefined, '2032-04-03'),
  ];
  expect(
    fixtures
      .filter((m) => isUpcomingFixture(m, now))
      .sort(compareUpcoming)
      .map((m) => m.id),
  ).toEqual(['day', 'live', 'unknown']);
});

it('validates timestamps and falls back to the date when kickoff is invalid', () => {
  expect(calendarTime('2032-04-03 12:30:00')).toBe('2032-04-03T12:30:00.000Z');
  expect(calendarTime('2032-04-03T12:30:00.123456Z')).toBe('2032-04-03T12:30:00.123Z');
  expect(calendarTime('2032-04-03T15:30:00+03:00')).toBe('2032-04-03T12:30:00.000Z');
  expect(calendarTime('2032-02-30T12:30:00Z')).toBeNull();
  expect(calendarTime('2032-04-03T24:00:00Z')).toBeNull();
  const now = Date.parse('2032-04-01T10:00:00Z');
  expect(
    formatFixtureTime(
      match('day', 'scheduled', undefined, '2032-04-04'),
      'Pacific/Kiritimati',
      now,
    ),
  ).toBe('вс, 4 апр.');
  // В UTC+14 уже 2 апреля, поэтому матч 2-го в 12:30 UTC — «завтра» в 02:30.
  expect(
    formatFixtureTime(
      match('timed', 'scheduled', '2032-04-02T12:30:00Z'),
      'Pacific/Kiritimati',
      now,
    ),
  ).toBe('завтра 02:30');
  expect(
    formatFixtureTime(
      match('timed', 'scheduled', '2032-04-03T12:30:00Z'),
      'Pacific/Kiritimati',
      now,
    ),
  ).toBe('вс, 4 апр., 02:30');
});
