import { expect, it } from 'vitest';
import {
  buildCalendar,
  calendarTime,
  compareUpcoming,
  formatFixtureTime,
  isUpcomingFixture,
  prepareCalendarMatches,
  savedCalendarMessage,
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

it('exports future favourites first, otherwise the selected league', () => {
  const favourite = match('favourite', 'scheduled', '2032-04-05T12:30:00Z');
  const other = match('other', 'scheduled', undefined, '2032-04-06');
  const finished = match('finished', 'finished', '2032-04-04T12:00:00Z');
  const withDate = selectCalendarMatches([favourite, finished], [other, finished]);
  expect(withDate.events.map((event) => event.id)).toEqual(['favourite']);
  expect(withDate.fallback).toBe(false);

  const fallback = selectCalendarMatches([finished], [other, finished]);
  expect(fallback.events.map((event) => event.id)).toEqual(['other']);
  expect(fallback.fallback).toBe(true);

  const missing = prepareCalendarMatches([match('none', 'scheduled')]);
  expect(missing.events).toEqual([]);
  expect(missing.skipped).toBe(1);
  expect(selectCalendarMatches([], [match('none', 'scheduled')])).toMatchObject({
    events: [],
    skipped: 1,
  });
});

it('builds an iCalendar file with reminders and escaped names', () => {
  const text = buildCalendar(
    [
      { id: 'timed', home: 'Atlético; FC', away: 'Away, Club', time: '2032-04-03T12:30:00.000Z' },
      { id: 'day', home: 'Home', away: 'Away', time: '2032-04-04' },
    ],
    new Date('2032-04-01T10:00:00Z'),
  );
  expect(text).toContain('BEGIN:VCALENDAR');
  expect(text).toContain('UID:timed@sportsdesk.local');
  expect(text).toContain('DTSTART:20320403T123000Z');
  expect(text).toContain('SUMMARY:Atlético\\; FC — Away\\, Club');
  expect(text).toContain('BEGIN:VALARM');
  expect(text).toContain('TRIGGER:-PT15M');
  expect(text).toContain('DTSTART;VALUE=DATE:20320404');
  expect(text.split('\r\n').filter(Boolean).at(-1)).toBe('END:VCALENDAR');
});

it('tells the reminder and all-day parts of a saved calendar', () => {
  expect(
    savedCalendarMessage([
      { id: 'one', home: 'Home', away: 'Away', time: '2032-04-03T12:30:00.000Z' },
      { id: 'two', home: 'Home', away: 'Away', time: '2032-04-03T15:30:00.000Z' },
      { id: 'three', home: 'Home', away: 'Away', time: '2032-04-03T18:30:00.000Z' },
      { id: 'four', home: 'Home', away: 'Away', time: '2032-04-03T20:30:00.000Z' },
      { id: 'day', home: 'Home', away: 'Away', time: '2032-04-04' },
    ]),
  ).toBe('Сохранено: 5 матчей, напоминание за 15 минут; без времени: 1, на весь день.');
  expect(
    savedCalendarMessage([
      { id: 'one', home: 'Home', away: 'Away', time: '2032-04-03T12:30:00.000Z' },
    ]),
  ).toBe('Сохранено: 1 матч, напоминание за 15 минут.');
  expect(
    savedCalendarMessage([{ id: 'day', home: 'Home', away: 'Away', time: '2032-04-04' }]),
  ).toBe('Сохранено: 1 матч; без времени: 1, на весь день.');
});
