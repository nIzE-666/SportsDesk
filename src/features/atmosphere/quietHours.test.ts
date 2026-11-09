// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { POLICY_KEY } from '../settings/notificationPolicy';
import { clockMinutes, isQuietNow, localMinutes } from './quietHours';

const TIMEZONE_KEY = 'sportsdesk.timezone';

function configure(quiet: { enabled?: boolean; start?: string; end?: string }, timezone = 'UTC') {
  localStorage.setItem(TIMEZONE_KEY, timezone);
  localStorage.setItem(
    POLICY_KEY,
    JSON.stringify({
      quietEnabled: quiet.enabled ?? true,
      quietStart: quiet.start ?? '23:00',
      quietEnd: quiet.end ?? '08:00',
    }),
  );
}

const at = (hours: number, minutes = 0) => Date.UTC(2026, 10, 9, hours, minutes);

beforeEach(() => localStorage.clear());

it('parses clock values strictly', () => {
  expect(clockMinutes('00:00')).toBe(0);
  expect(clockMinutes('23:59')).toBe(23 * 60 + 59);
  expect(clockMinutes('24:00')).toBeNull();
  expect(clockMinutes('12:60')).toBeNull();
  expect(clockMinutes('noon')).toBeNull();
});

it('reads local minutes in the chosen time zone', () => {
  expect(localMinutes(at(21), 'Europe/Moscow')).toBe(0);
  expect(localMinutes(at(0, 5), 'UTC')).toBe(5);
  expect(localMinutes(at(12), 'Not/AZone')).toBeNull();
});

it('is never quiet while quiet hours are off', () => {
  configure({ enabled: false });
  expect(isQuietNow(at(23, 30))).toBe(false);
});

it('handles a window that crosses midnight, start inclusive and end exclusive', () => {
  configure({ start: '23:00', end: '08:00' });
  expect(isQuietNow(at(22, 59))).toBe(false);
  expect(isQuietNow(at(23, 0))).toBe(true);
  expect(isQuietNow(at(3, 0))).toBe(true);
  expect(isQuietNow(at(7, 59))).toBe(true);
  expect(isQuietNow(at(8, 0))).toBe(false);
  expect(isQuietNow(at(12, 0))).toBe(false);
});

it('handles a window inside one day', () => {
  configure({ start: '13:00', end: '15:00' });
  expect(isQuietNow(at(12, 59))).toBe(false);
  expect(isQuietNow(at(13, 0))).toBe(true);
  expect(isQuietNow(at(14, 59))).toBe(true);
  expect(isQuietNow(at(15, 0))).toBe(false);
});

it('uses the time zone of the user, not of the computer', () => {
  configure({ start: '23:00', end: '08:00' }, 'Europe/Moscow');
  expect(isQuietNow(at(21, 0))).toBe(true); // 00:00 в Москве
  expect(isQuietNow(at(4, 0))).toBe(true); // 07:00 в Москве
  expect(isQuietNow(at(5, 0))).toBe(false); // 08:00 в Москве
  expect(isQuietNow(at(19, 59))).toBe(false); // 22:59 в Москве
  expect(isQuietNow(at(20, 0))).toBe(true); // 23:00 в Москве
});

it('treats equal bounds as always quiet, like the notification policy in Rust', () => {
  configure({ start: '10:00', end: '10:00' });
  expect(isQuietNow(at(4, 0))).toBe(true);
  expect(isQuietNow(at(16, 0))).toBe(true);
});
