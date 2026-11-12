import { formatHumanDateTime } from '../../lib/humanDate';

const PREFIX = 'sportsdesk.';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (window.localStorage.getItem(key) === value) {
      // Restores observe even a no-op write: it can be a user edit made while
      // the restored value happens to match the value they just selected.
      window.dispatchEvent(new CustomEvent('sportsdesk-storage-write-intent', { detail: { key } }));
      return;
    }
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent('sportsdesk-storage-changed', { detail: { key } }));
  } catch {
    /* storage may be unavailable; silently ignore */
  }
}

export function getString(key: string): string | null {
  return safeGet(key);
}

export function setString(key: string, value: string): void {
  safeSet(key, value);
}

export function getJson<T>(key: string, fallback: T): T {
  const raw = safeGet(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function setJson(key: string, value: unknown): void {
  try {
    safeSet(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const STORAGE_KEYS = {
  favoritesTeams: PREFIX + 'football.favorites.teams',
  favoritePlayers: PREFIX + 'football.favorites.players',
  /** Nonsecret team catalogue snapshot (id/name) used to resolve favourite ids to names. */
  catalogue: PREFIX + 'football.catalogue',
  timezone: PREFIX + 'timezone',
  notifications: PREFIX + 'notifications.enabled',
  trayMode: PREFIX + 'tray.mode',
  selectedLeague: PREFIX + 'football.selected.league',
  selectedTeam: PREFIX + 'football.selected.team',
};

const DEFAULT_TZ = 'Asia/Yakutsk';

export function isValidTimezone(timezone: string): boolean {
  if (!timezone || timezone !== timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function getUserTimezone(): string {
  const tz = getString(STORAGE_KEYS.timezone);
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TZ;
}

const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const RU_MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

export function formatDateTime(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatShortDate(iso, timezone);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    return fmt.format(date);
  } catch {
    return date.toISOString();
  }
}

/** День по календарю часового пояса в виде «2026-11-10» — для сравнения «сегодня / вчера». */
function dayKey(date: Date, timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return null;
  }
}

/**
 * Время последнего обновления человеческим языком: «18:42» сегодня, «вчера 18:42»,
 * иначе «сб, 7 нояб., 18:42». Пустое или неразборчивое значение даёт «—».
 */
export function formatUpdatedAt(
  iso: string | null | undefined,
  timezone: string,
  now: number = Date.now(),
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || /^\d{4}-\d{2}-\d{2}$/.test(iso))
    return formatHumanDateTime(iso, timezone, now);
  const time = (() => {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return null;
    }
  })();
  const day = dayKey(date, timezone);
  if (!time || !day) return formatHumanDateTime(iso, timezone, now);
  if (day === dayKey(new Date(now), timezone)) return time;
  if (day === dayKey(new Date(now - 24 * 60 * 60 * 1000), timezone)) return `вчера ${time}`;
  return formatHumanDateTime(iso, timezone, now);
}

export function formatDate(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '—';
  const calendar = calendarDate(iso);
  if (calendar) return `${calendar.day} ${RU_MONTHS[calendar.month - 1]} ${calendar.year}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const monthNum = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'numeric' }).format(d),
    );
    return `${get('day')} ${RU_MONTHS[monthNum - 1] ?? ''} ${get('year')}`.trim();
  } catch {
    return iso;
  }
}

export function formatShortDate(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '—';
  const calendar = calendarDate(iso);
  if (calendar) return `${calendar.day} ${RU_MONTHS_SHORT[calendar.month - 1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    const day = new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, day: 'numeric' }).format(d);
    const monthNum = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'numeric' }).format(d),
    );
    return `${day} ${RU_MONTHS_SHORT[monthNum - 1] ?? ''}`;
  } catch {
    return iso;
  }
}

/** Calendar-only values have no timezone and must never be shifted to another day. */
function calendarDate(value: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яё\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function safeText(value: string): string {
  return value.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c);
}
