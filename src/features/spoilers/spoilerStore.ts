import { useSyncExternalStore } from 'react';
import { getJson, getString, setJson } from '../football/storage';

/**
 * Режим без спойлеров (первая версия).
 *
 * Пользователь отмечает конкретный матч или сессию Формулы-1, и их результат
 * скрывается на всех экранах до явного «Показать результат». Список хранится
 * в localStorage, версионирован и входит в резервную копию профиля. Записи
 * сами исчезают через SPOILER_TTL_DAYS после события, чтобы список не рос.
 */

export const SPOILERS_KEY = 'sportsdesk.view.spoilers';
export const SPOILERS_VERSION = 1;
export const SPOILER_TTL_DAYS = 7;
export const SPOILERS_CHANGED_EVENT = 'sportsdesk-spoilers-changed';
export const SPOILER_MASK = '? : ?';

export type SpoilerKind = 'football' | 'f1';

export interface SpoilerEntry {
  kind: SpoilerKind;
  id: string;
  /** Подпись для настроек и уведомлений, например «Арсенал — Челси». */
  label?: string;
  /** Время события (ISO). От него считается срок хранения. */
  eventTime?: string;
  addedAt: string;
}

export interface StoredSpoilers {
  version: number;
  items: SpoilerEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isKind(value: unknown): value is SpoilerKind {
  return value === 'football' || value === 'f1';
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseEntry(value: unknown): SpoilerEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isKind(raw.kind) || typeof raw.id !== 'string' || raw.id.trim() === '') return null;
  if (!validTime(raw.addedAt)) return null;
  const entry: SpoilerEntry = { kind: raw.kind, id: raw.id, addedAt: raw.addedAt };
  if (typeof raw.label === 'string' && raw.label.trim() !== '')
    entry.label = raw.label.slice(0, 200);
  if (validTime(raw.eventTime)) entry.eventTime = raw.eventTime;
  return entry;
}

export function spoilerKey(kind: SpoilerKind, id: string): string {
  return `${kind}:${id}`;
}

/** Разбирает сохранённое значение. null — значение не похоже на список спойлеров. */
export function parseSpoilers(value: unknown): StoredSpoilers | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 1)
    return null;
  if (!Array.isArray(raw.items)) return null;
  const seen = new Set<string>();
  const items: SpoilerEntry[] = [];
  for (const item of raw.items) {
    const entry = parseEntry(item);
    if (!entry) continue;
    const key = spoilerKey(entry.kind, entry.id);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(entry);
  }
  return { version: raw.version, items };
}

/** Для проверки резервной копии: строка JSON, которую можно разобрать. */
export function isValidSpoilersValue(value: string): boolean {
  try {
    return parseSpoilers(JSON.parse(value)) !== null;
  } catch {
    return false;
  }
}

export function isExpired(entry: SpoilerEntry, now = Date.now()): boolean {
  const base = Date.parse(entry.eventTime ?? entry.addedAt);
  return now - base > SPOILER_TTL_DAYS * DAY_MS;
}

/** Актуальные записи без истёкших. */
export function readSpoilers(now = Date.now()): SpoilerEntry[] {
  const parsed = parseSpoilers(getJson<unknown>(SPOILERS_KEY, null));
  if (!parsed) return [];
  return parsed.items.filter((e) => !isExpired(e, now));
}

let cacheRaw: string | null | undefined;
let cacheSet: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function write(items: SpoilerEntry[]): void {
  setJson(SPOILERS_KEY, { version: SPOILERS_VERSION, items });
  cacheRaw = undefined;
  emit();
  // Фоновый опрос на Rust получает новый список сразу.
  window.dispatchEvent(new Event(SPOILERS_CHANGED_EVENT));
}

/** Удаляет истёкшие записи из хранилища. Возвращает число удалённых. */
export function pruneSpoilers(now = Date.now()): number {
  const parsed = parseSpoilers(getJson<unknown>(SPOILERS_KEY, null));
  if (!parsed) return 0;
  const kept = parsed.items.filter((e) => !isExpired(e, now));
  const removed = parsed.items.length - kept.length;
  if (removed > 0) write(kept);
  return removed;
}

export function hideResult(entry: Omit<SpoilerEntry, 'addedAt'> & { addedAt?: string }): void {
  const clean = parseEntry({ ...entry, addedAt: entry.addedAt ?? new Date().toISOString() });
  if (!clean) return;
  const key = spoilerKey(clean.kind, clean.id);
  const next = readSpoilers().filter((e) => spoilerKey(e.kind, e.id) !== key);
  next.push(clean);
  write(next);
}

export function revealResult(kind: SpoilerKind, id: string): void {
  const items = readSpoilers();
  const key = spoilerKey(kind, id);
  const next = items.filter((e) => spoilerKey(e.kind, e.id) !== key);
  if (next.length !== items.length) write(next);
}

/** Стабильный снимок множества скрытых ключей. */
export function getSpoilerSnapshot(): ReadonlySet<string> {
  const raw = getString(SPOILERS_KEY);
  if (raw === cacheRaw) return cacheSet;
  cacheRaw = raw;
  cacheSet = new Set(readSpoilers().map((e) => spoilerKey(e.kind, e.id)));
  return cacheSet;
}

export function isResultHidden(kind: SpoilerKind, id: string | null | undefined): boolean {
  if (!id) return false;
  return getSpoilerSnapshot().has(spoilerKey(kind, id));
}

/** Скрытые id матчей футбола — для фильтров вне React (поиск, уведомления, Rust). */
export function hiddenFootballIds(): string[] {
  return readSpoilers()
    .filter((e) => e.kind === 'football')
    .map((e) => e.id);
}

export function subscribeSpoilers(listener: () => void): () => void {
  listeners.add(listener);
  const onWindow = () => listener();
  window.addEventListener('storage', onWindow);
  window.addEventListener('sportsdesk-storage-changed', onWindow);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onWindow);
    window.removeEventListener('sportsdesk-storage-changed', onWindow);
  };
}

export function useSpoilerSet(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeSpoilers, getSpoilerSnapshot, getSpoilerSnapshot);
}

export function useResultHidden(kind: SpoilerKind, id: string | null | undefined): boolean {
  const set = useSpoilerSet();
  return !!id && set.has(spoilerKey(kind, id));
}

/** Счёт для показа: маска, если результат скрыт. */
export function scoreText(
  home: number | null | undefined,
  away: number | null | undefined,
  hidden: boolean,
  empty = 'VS',
): string {
  if (home == null || away == null) return empty;
  return hidden ? SPOILER_MASK : `${home} : ${away}`;
}

export const HIDDEN_EVENT_BODY = 'Результат скрыт — откройте матч и нажмите «Показать результат».';

/** Текст события ленты без спойлера: напоминания безопасны, остальное скрывается. */
export function spoilerSafeBody(
  hidden: ReadonlySet<string>,
  event: { sport: string; kind: string; body: string; matchId?: string },
): string {
  if (event.kind === 'reminder' || !event.matchId) return event.body;
  const kind: SpoilerKind = event.sport === 'f1' ? 'f1' : 'football';
  return hidden.has(spoilerKey(kind, event.matchId)) ? HIDDEN_EVENT_BODY : event.body;
}
