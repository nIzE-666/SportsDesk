import { classifyMatchStatus } from '../../lib/sportsIdentity';
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
