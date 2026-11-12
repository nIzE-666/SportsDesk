/**
 * Time helpers scoped to F1 feature. Time zone comes from localStorage
 * `sportsdesk.timezone` (default Asia/Yakutsk). All upstream times are UTC.
 */

import { formatHumanDate, formatHumanDateTime } from '../../lib/humanDate';
import { isValidTimezone } from '../football/storage';

export const DEFAULT_TZ = 'Asia/Yakutsk';

export function getTimeZone(): string {
  try {
    const raw = localStorage.getItem('sportsdesk.timezone');
    if (raw && raw.trim() && isValidTimezone(raw.trim())) return raw.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_TZ;
}

export function parseUtc(date?: string | null, time?: string | null): Date | null {
  if (!date) return null;
  let iso = date;
  if (time) {
    const t = time.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(time) ? time : time + 'Z';
    iso = `${date}T${t}`;
  } else {
    iso = `${date}T00:00:00Z`;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «сегодня 12:00», «сб, 22 нояб., 12:00»; без даты — «—». */
export function formatDateTime(d: Date | null, tz = getTimeZone()): string {
  return formatHumanDateTime(d, tz);
}

/** «сегодня», «сб, 22 нояб.», для другого года — с годом. */
export function formatDate(d: Date | null, tz = getTimeZone()): string {
  return formatHumanDate(d, tz);
}

/** Раньше был компактный числовой вид; теперь везде один человеческий формат. */
export function formatShort(d: Date | null, tz = getTimeZone()): string {
  return formatHumanDateTime(d, tz);
}

export function formatFetchedAt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: getTimeZone(),
    }).format(d);
  } catch {
    return iso;
  }
}
