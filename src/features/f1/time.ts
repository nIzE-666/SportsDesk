/**
 * Time helpers scoped to F1 feature. Time zone comes from localStorage
 * `sportsdesk.timezone` (default Asia/Yakutsk). All upstream times are UTC.
 */

export const DEFAULT_TZ = 'Asia/Yakutsk';

export function getTimeZone(): string {
  try {
    const raw = localStorage.getItem('sportsdesk.timezone');
    if (raw && raw.trim()) return raw.trim();
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

export function formatDateTime(d: Date | null, tz = getTimeZone()): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function formatDate(d: Date | null, tz = getTimeZone()): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatShort(d: Date | null, tz = getTimeZone()): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString().slice(5, 16).replace('T', ' ');
  }
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
