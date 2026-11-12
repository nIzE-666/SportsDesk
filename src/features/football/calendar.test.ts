import { expect, it } from 'vitest';
import {
  buildCalendar,
  calendarTime,
  compareUpcoming,
  formatFixtureTime,
  isUpcomingFixture,
  prepareCalendarMatches,
  selectCalendarMatches,
} from './calendar';
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

it('uses the league when favourites only have live or undated matches', () => {
  const league = [match('league', 'scheduled', '2032-04-05T12:00:00Z')];
  const live = selectCalendarMatches([match('live', 'live', '2032-04-03T12:00:00Z')], league);
  expect(live.events.map((event) => event.id)).toEqual(['league']);
  expect(live.fallback).toBe(true);
  const missing = selectCalendarMatches([match('missing', 'scheduled')], league);
  expect(missing.events.map((event) => event.id)).toEqual(['league']);
  expect(missing.skippedFavorites).toBe(1);
  const favorite = selectCalendarMatches(
    [match('favorite', 'scheduled', '2032-04-04T12:00:00Z')],
    league,
  );
  expect(favorite.events.map((event) => event.id)).toEqual(['favorite']);
  expect(favorite.fallback).toBe(false);
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
  const result = prepareCalendarMatches([
    match('timed', 'scheduled', '2032-04-03T12:30:00Z'),
    match('day', 'scheduled', 'invalid', '2032-04-04'),
    match('missing', 'scheduled'),
  ]);
  expect(result.events.map((event) => event.time)).toEqual([
    '2032-04-03T12:30:00.000Z',
    '2032-04-04',
  ]);
  expect(result.skipped).toBe(1);
  const ics = buildCalendar(result.events, new Date('2032-04-01T10:00:00Z'));
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(ics).toContain('DTSTART:20320403T123000Z');
  expect(ics).toContain('DTEND:20320403T141500Z');
  expect(ics).toContain('DTSTART;VALUE=DATE:20320404');
  expect(ics).toContain('DTEND;VALUE=DATE:20320405');
  expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
  expect(ics).toContain('SUMMARY:Atlético\\; FC — Away\\, Club');
});
