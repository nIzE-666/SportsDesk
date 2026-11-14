// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatShortDate,
  formatUpdatedAt,
  getUserTimezone,
  STORAGE_KEYS,
} from './storage';

beforeEach(() => {
  localStorage.clear();
});

it('uses a safe timezone for corrupt storage', () => {
  localStorage.setItem(STORAGE_KEYS.timezone, 'Not/A_Zone');
  expect(getUserTimezone()).toBe('Asia/Yakutsk');
  localStorage.setItem(STORAGE_KEYS.timezone, 'Pacific/Kiritimati');
  expect(getUserTimezone()).toBe('Pacific/Kiritimati');
});

it('keeps calendar days in extreme timezones but converts timestamps', () => {
  for (const timezone of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
    expect(formatDate('2026-01-02', timezone)).toBe('2 января 2026');
    expect(formatShortDate('2026-01-02', timezone)).toBe('2 янв');
    expect(formatDateTime('2026-01-02', timezone)).toBe('2 янв');
  }
  expect(formatDate('2026-01-02T23:30:00Z', 'Pacific/Kiritimati')).toBe('3 января 2026');
  expect(formatShortDate('2026-01-02T02:30:00Z', 'Etc/GMT+12')).toBe('1 янв');
  expect(formatDateTime('2026-01-02T23:30:00Z', 'Pacific/Kiritimati')).toContain('3 янв');
  expect(formatDate('2026-02-30', 'UTC')).toBe('2026-02-30');
});

it('describes the last update as today, yesterday or a date', () => {
  const now = Date.parse('2026-11-10T20:00:00Z');
  expect(formatUpdatedAt('2026-11-10T09:15:00Z', 'UTC', now)).toBe('09:15');
  expect(formatUpdatedAt('2026-11-09T23:59:00Z', 'UTC', now)).toBe('вчера 23:59');
  expect(formatUpdatedAt('2026-11-07T09:15:00Z', 'UTC', now)).toBe('сб, 7 нояб., 09:15');
  expect(formatUpdatedAt('2025-12-31T09:15:00Z', 'UTC', now)).toBe('ср, 31 дек. 2025, 09:15');
  // Для часового пояса «сегодня» считается по его календарю, а не по UTC.
  expect(formatUpdatedAt('2026-11-10T20:30:00Z', 'Pacific/Kiritimati', now)).toBe('10:30');
  expect(formatUpdatedAt(null, 'UTC', now)).toBe('—');
  expect(formatUpdatedAt('not a date', 'UTC', now)).toBe('—');
});
