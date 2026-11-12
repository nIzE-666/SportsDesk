import { expect, it } from 'vitest';
import { formatHumanDate, formatHumanDateTime } from './humanDate';

// Четверг, 12 ноября 2026, 10:00 UTC. 14 ноября — суббота, 22 ноября — воскресенье.
const now = Date.parse('2026-11-12T10:00:00Z');

it('says today, tomorrow and yesterday with the time', () => {
  expect(formatHumanDateTime('2026-11-12T21:30:00Z', 'UTC', now)).toBe('сегодня 21:30');
  expect(formatHumanDateTime('2026-11-13T00:00:00Z', 'UTC', now)).toBe('завтра 00:00');
  expect(formatHumanDateTime('2026-11-11T18:05:00Z', 'UTC', now)).toBe('вчера 18:05');
  expect(formatHumanDate('2026-11-12T21:30:00Z', 'UTC', now)).toBe('сегодня');
  expect(formatHumanDate('2026-11-13T00:00:00Z', 'UTC', now)).toBe('завтра');
  expect(formatHumanDate('2026-11-11T18:05:00Z', 'UTC', now)).toBe('вчера');
});

it('writes other days of the current year with a short weekday and no year', () => {
  expect(formatHumanDateTime('2026-11-14T21:30:00Z', 'UTC', now)).toBe('сб, 14 нояб., 21:30');
  expect(formatHumanDate('2026-11-14T21:30:00Z', 'UTC', now)).toBe('сб, 14 нояб.');
  expect(formatHumanDate('2026-11-22T09:00:00Z', 'UTC', now)).toBe('вс, 22 нояб.');
  expect(formatHumanDate('2026-11-10T09:00:00Z', 'UTC', now)).toBe('вт, 10 нояб.');
  expect(formatHumanDateTime('2026-01-01T00:00:00Z', 'UTC', now)).toBe('чт, 1 янв., 00:00');
});

it('adds the year for other years', () => {
  expect(formatHumanDate('2025-11-22T21:30:00Z', 'UTC', now)).toBe('сб, 22 нояб. 2025');
  expect(formatHumanDateTime('2025-11-22T21:30:00Z', 'UTC', now)).toBe('сб, 22 нояб. 2025, 21:30');
  expect(formatHumanDateTime('2027-11-22T21:30:00Z', 'UTC', now)).toBe('пн, 22 нояб. 2027, 21:30');
});

it('uses the Russian short month names', () => {
  const names = Array.from(
    { length: 12 },
    (_, month) =>
      formatHumanDate(`2025-${String(month + 1).padStart(2, '0')}-15`, 'UTC', now).split(' ')[2],
  );
  expect(names).toEqual([
    'янв.',
    'февр.',
    'мар.',
    'апр.',
    'мая',
    'июн.',
    'июл.',
    'авг.',
    'сент.',
    'окт.',
    'нояб.',
    'дек.',
  ]);
});

it('counts days in the chosen time zone, not in the computer or UTC', () => {
  // 15:30 UTC — это 00:30 следующего дня в Якутске (UTC+9).
  expect(formatHumanDateTime('2026-11-12T15:30:00Z', 'UTC', now)).toBe('сегодня 15:30');
  expect(formatHumanDateTime('2026-11-12T15:30:00Z', 'Asia/Yakutsk', now)).toBe('завтра 00:30');
  // В Якутске в 20:00 UTC уже 13 ноября: «сегодня» тоже считается по поясу.
  const late = Date.parse('2026-11-12T20:00:00Z');
  expect(formatHumanDateTime('2026-11-13T01:00:00Z', 'Asia/Yakutsk', late)).toBe('сегодня 10:00');
  expect(formatHumanDateTime('2026-11-13T01:00:00Z', 'UTC', late)).toBe('завтра 01:00');
  // Западное полушарие: 02:00 UTC 13 ноября — ещё вечер 12 ноября в Нью-Йорке.
  expect(formatHumanDateTime('2026-11-13T02:00:00Z', 'America/New_York', now)).toBe(
    'сегодня 21:00',
  );
});

it('keeps counting days correctly across a daylight saving change', () => {
  const sunday = Date.parse('2026-11-01T12:00:00Z');
  // Зимнее время в Нью-Йорке началось в 06:00 UTC 1 ноября: 05:30 UTC 2 ноября — 00:30 понедельника.
  expect(formatHumanDateTime('2026-11-02T05:30:00Z', 'America/New_York', sunday)).toBe(
    'завтра 00:30',
  );
  expect(formatHumanDateTime('2026-10-31T23:30:00Z', 'America/New_York', sunday)).toBe(
    'вчера 19:30',
  );
});

it('shows a calendar date without a time zone shift and without a time', () => {
  const late = Date.parse('2026-11-12T20:00:00Z');
  expect(formatHumanDate('2026-11-13', 'UTC', now)).toBe('завтра');
  expect(formatHumanDateTime('2026-11-13', 'Asia/Yakutsk', now)).toBe('завтра');
  expect(formatHumanDateTime('2026-11-13', 'Asia/Yakutsk', late)).toBe('сегодня');
  expect(formatHumanDateTime('2026-11-13', 'UTC', late)).toBe('завтра');
  expect(formatHumanDateTime('2026-11-14', 'Pacific/Kiritimati', now)).toBe('завтра');
  expect(formatHumanDateTime('2026-11-18', 'Pacific/Kiritimati', now)).toBe('ср, 18 нояб.');
  expect(formatHumanDate('2027-03-01', 'UTC', now)).toBe('пн, 1 мар. 2027');
});

it('shows midnight as 00:00 and keeps leading zeros', () => {
  expect(formatHumanDateTime('2026-11-12T00:00:00Z', 'UTC', now)).toBe('сегодня 00:00');
  expect(formatHumanDateTime('2026-11-12T09:05:00Z', 'UTC', now)).toBe('сегодня 09:05');
});

it('accepts timestamps and Date objects', () => {
  expect(formatHumanDateTime(Date.parse('2026-11-12T21:30:00Z'), 'UTC', now)).toBe('сегодня 21:30');
  expect(formatHumanDateTime(new Date('2026-11-13T00:00:00Z'), 'UTC', now)).toBe('завтра 00:00');
});

it('answers with a dash for empty, broken or impossible values and unknown time zones', () => {
  for (const value of [null, undefined, '', 'вчера', 'not a date', '2026-02-30', Number.NaN])
    expect(formatHumanDateTime(value, 'UTC', now)).toBe('—');
  expect(formatHumanDate('2026-11-12T21:30:00Z', 'Not/A_Zone', now)).toBe('—');
  expect(formatHumanDateTime('2026-11-12T21:30:00Z', 'UTC', Number.NaN)).toBe('—');
});

it('uses the current time when no moment is given', () => {
  const soon = new Date(Date.now() + 60_000).toISOString();
  expect(formatHumanDate(soon, 'UTC')).toMatch(/^(сегодня|завтра)$/u);
});
