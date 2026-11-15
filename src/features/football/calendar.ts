import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { countRu, MATCHES } from '../../lib/plural';
import type { MatchSummary } from './types';
import { formatHumanDate, formatHumanDateTime } from '../../lib/humanDate';

function validDay(day: string): boolean {
  const value = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === day;
}

/** Pitch offsetless timestamps are UTC; a date without a time stays an all-day date. */
export function calendarTime(value: string | undefined): string | null {
  const input = value?.trim();
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return validDay(input) ? input : null;
  const parts =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      input,
    );
  if (
    !parts ||
    !validDay(parts[1]!) ||
    Number(parts[2]) > 23 ||
    Number(parts[3]) > 59 ||
    Number(parts[4] ?? '0') > 59
  )
    return null;
  const normalized = `${parts[1]}T${parts[2]}:${parts[3]}:${parts[4] ?? '00'}${parts[5] ?? ''}${parts[6] ?? 'Z'}`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function fixtureCalendarTime(match: MatchSummary): string | null {
  return calendarTime(match.time_utc) ?? calendarTime(match.date);
}

/** Время матча для списков: «сегодня 21:30», «сб, 22 нояб., 21:30»; день без времени — без времени. */
export function formatFixtureTime(
  match: MatchSummary,
  timezone: string,
  now: number = Date.now(),
): string {
  const time = fixtureCalendarTime(match);
  return time?.length === 10
    ? formatHumanDate(time, timezone, now)
    : formatHumanDateTime(time, timezone, now);
}

/** Scheduled and live fixtures remain visible; postponed and cancelled ones do not. */
export function isUpcomingFixture(match: MatchSummary, now = Date.now()): boolean {
  const state = classifyMatchStatus(match.status);
  if (state !== 'scheduled' && state !== 'live') return false;
  const time = fixtureCalendarTime(match);
  if (!time) return true;
  const end = time.length === 10 ? Date.parse(`${time}T23:59:59.999Z`) : Date.parse(time);
  return end >= now - (time.length === 10 ? 0 : 2 * 60 * 60 * 1000);
}

export function compareUpcoming(a: MatchSummary, b: MatchSummary): number {
  return (fixtureCalendarTime(a) ?? '\uffff').localeCompare(fixtureCalendarTime(b) ?? '\uffff');
}

export interface CalendarMatch {
  id: string;
  home: string;
  away: string;
  /** A validated calendar date or UTC ISO timestamp. */
  time: string;
}

/** Matches without a usable date are counted but never given an invented one. */
export function prepareCalendarMatches(matches: MatchSummary[]): {
  events: CalendarMatch[];
  skipped: number;
} {
  const events: CalendarMatch[] = [];
  for (const match of matches) {
    const time = fixtureCalendarTime(match);
    if (time)
      events.push({ id: match.id, home: match.home_team.name, away: match.away_team.name, time });
  }
  return { events, skipped: matches.length - events.length };
}

/** Prefer future favourites; otherwise use the selected league's scheduled fixtures. */
export function selectCalendarMatches(favorites: MatchSummary[], league: MatchSummary[]) {
  const scheduled = (matches: MatchSummary[]) =>
    matches.filter((match) => classifyMatchStatus(match.status) === 'scheduled');
  const favoriteResult = prepareCalendarMatches(scheduled(favorites));
  if (favoriteResult.events.length > 0) {
    return { ...favoriteResult, fallback: false, skippedFavorites: 0 };
  }
  const leagueResult = prepareCalendarMatches(scheduled(league));
  if (leagueResult.events.length > 0) {
    return { ...leagueResult, fallback: true, skippedFavorites: favoriteResult.skipped };
  }
  return {
    events: [],
    skipped: favoriteResult.skipped || leagueResult.skipped,
    fallback: false,
    skippedFavorites: 0,
  };
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/** Browser fallback mirrors the native exporter, including all-day dates. */
export function buildCalendar(events: CalendarMatch[], now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SportsDesk//Personal Sports Hub//RU',
    'CALSCALE:GREGORIAN',
  ];
  for (const event of events) {
    const allDay = event.time.length === 10;
    const start = allDay
      ? event.time.replace(/-/g, '')
      : event.time.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const endDate = new Date(allDay ? `${event.time}T00:00:00Z` : event.time);
    endDate.setTime(endDate.getTime() + (allDay ? 24 * 60 : 105) * 60 * 1000);
    const end = allDay
      ? endDate.toISOString().slice(0, 10).replace(/-/g, '')
      : endDate
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}Z$/, 'Z');
    const summary = escapeText(`${event.home} — ${event.away}`);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id.replace(/[\r\n]/g, '')}@sportsdesk.local`,
      `DTSTAMP:${stamp}`,
      `${allDay ? 'DTSTART;VALUE=DATE' : 'DTSTART'}:${start}`,
      `${allDay ? 'DTEND;VALUE=DATE' : 'DTEND'}:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${summary} (SportsDesk)`,
    );
    if (!allDay)
      lines.push(
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'ACTION:DISPLAY',
        'DESCRIPTION:Матч скоро начнётся',
        'END:VALARM',
      );
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/**
 * What the browser says after saving: the number of matches, the reminder for
 * matches with a known time, and the all-day events for matches without one.
 */
export function savedCalendarMessage(
  events: CalendarMatch[],
  extraNotes: readonly string[] = [],
): string {
  const timed = events.filter((event) => event.time.length !== 10).length;
  const allDay = events.length - timed;
  const first = [countRu(events.length, MATCHES)];
  if (timed) first.push('напоминание за 15 минут');
  const rest: string[] = [];
  if (allDay) rest.push(`без времени: ${allDay}, на весь день`);
  rest.push(...extraNotes);
  return `Сохранено: ${[first.join(', '), ...rest].join('; ')}.`;
}
