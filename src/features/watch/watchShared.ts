import { sanitizeDetails } from '../../lib/diagnostics';
export interface SecretStatus {
  pitch: boolean;
  kino: boolean;
}

export interface DeviceAuthStart {
  code: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceAuthPoll {
  pending: boolean;
  authenticated: boolean;
}

export interface KinoChannel {
  id: number;
  title: string;
  logo?: string;
  url?: string;
}

const BASE_SITE = 'https://kino.watch';
export const FALLBACK_SITE = `${BASE_SITE}/`;

const VERIFIED_PATHS: Record<string, string> = {
  okkofootball: '/tv/view/okkofootball',
  okkosport: '/tv/view/okkosport',
  okkoprime: '/tv/view/okkoprime',
  okkochampionat: '/tv/view/okkochampionat',
  skysportsf1: '/tv/view/skysportsf1',
  skysportsf1uhd: '/tv/view/skysportsf1uhd',
  matchtv: '/tv/view/matchtv',
  nashfootball: '/tv/view/nashfootball',
  football1: '/tv/view/football1',
  football2: '/tv/view/football2',
  football3: '/tv/view/football3',
};

export function siteUrlForChannel(channel: KinoChannel | null): string {
  if (!channel) return FALLBACK_SITE;
  const slug = channel.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const path = VERIFIED_PATHS[slug];
  return path ? `${BASE_SITE}${path}` : FALLBACK_SITE;
}

// Channel is considered sports-ish by keyword for the "sports" filter. This is
// a search helper only — we never claim a broadcast mapping.
const SPORT_KEYWORDS = [
  'sport',
  'football',
  'soccer',
  'match',
  'f1',
  'formula',
  'sky',
  'okko',
  'nash',
  'футбол',
  'спорт',
  'матч',
  'гонк',
  'арен',
  'barca',
  'real',
];

export function looksLikeSport(title: string): boolean {
  const t = title.toLowerCase();
  return SPORT_KEYWORDS.some((k) => t.includes(k));
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export const FAV_KEY = 'sportsdesk.watch.favorites';
export const RECENT_KEY = 'sportsdesk.watch.recent';

export function readRecent(): number[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      .slice(0, 6);
  } catch {
    return [];
  }
}

export function writeRecent(ids: number[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // non-critical
  }
}

export function readFavorites(): Set<number> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const ids = parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export function writeFavorites(ids: Set<number>): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage full or disabled — favourites are non-critical.
  }
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Strip anything that looks like a URL or token before surfacing.
  return sanitizeDetails(msg).slice(0, 240);
}

export function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Auth state machine panel
// ---------------------------------------------------------------------------

export type AuthPhase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'waiting'; data: DeviceAuthStart; remaining: number }
  | { kind: 'error'; message: string };
