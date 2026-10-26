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
    if (window.localStorage.getItem(key) === value) return;
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

export function getUserTimezone(): string {
  const tz = getString(STORAGE_KEYS.timezone);
  return tz && tz.trim() ? tz : DEFAULT_TZ;
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

export function formatDate(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00Z') : new Date(iso);
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
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00Z') : new Date(iso);
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
