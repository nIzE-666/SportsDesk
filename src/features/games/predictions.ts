import { useSyncExternalStore } from 'react';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { getString, setJson } from '../football/storage';

/**
 * «Угадай счёт»: личные прогнозы пользователя и игровые очки.
 *
 * Угадывается счёт ОСНОВНОГО времени. Источник отдаёт только итоговый счёт
 * без разделения на основное и дополнительное время, поэтому прогнозы
 * принимаются только в чемпионатах, где дополнительного времени нет, а матч,
 * который источник пометил как дошедший до дополнительного времени или
 * пенальти, не считается. Очки не накапливаются в записи, а выводятся из
 * прогноза и последнего известного итога: повторный расчёт не удваивает их, а
 * исправленный итог пересчитывает запись. К каждому прогнозу прикреплена
 * версия правил очков, чтобы старая статистика оставалась понятной.
 *
 * Это игра пользователя и она не связана с автоматическими моделями приложения.
 */

export const PREDICTIONS_KEY = 'sportsdesk.view.games.predictions';
export const PREDICTIONS_VERSION = 1;
export const PREDICTIONS_CHANGED_EVENT = 'sportsdesk-predictions-changed';
/** Версия правил очков, под которой создаётся новый прогноз. */
export const RULES_VERSION = 1;
export const MAX_GOALS = 20;
export const MAX_PREDICTIONS = 300;
/** Через сколько после начала матч считается закончившимся, чтобы проверить итог. */
export const SETTLE_AFTER_MS = 105 * 60 * 1000;

/**
 * Чемпионаты без дополнительного времени: Premier League, Ла Лига, Серия A,
 * Бундеслига, Лига 1. MLS не входит: в его плей-офф бывают дополнительное
 * время и пенальти, а источник их не отделяет.
 */
export const PREDICTION_LEAGUES: readonly string[] = [
  'l_4WFCIZ',
  'l_0ErfuF',
  'l_0ALvwF',
  'l_1Isor4',
  'l_3FJFUl',
];

export type VoidReason = 'cancelled' | 'extra-time';

export interface PredictionResult {
  home: number;
  away: number;
  /** Когда приложение увидело этот итог. */
  seenAt: string;
}

export interface Prediction {
  matchId: string;
  leagueId: string;
  /** Прогноз: голы хозяев и гостей в основное время. */
  home: number;
  away: number;
  homeTeam: string;
  awayTeam: string;
  /** Начало матча (ISO, UTC) по последнему наблюдению. */
  kickoff: string;
  createdAt: string;
  updatedAt: string;
  /** Версия правил очков на момент создания. */
  rules: number;
  /** Последний известный итог матча. */
  result?: PredictionResult;
  /** Очки не начисляются: матч отменён или дошёл до дополнительного времени. */
  void?: VoidReason;
}

export interface PredictionsFile {
  version: number;
  items: Prediction[];
}

export const EMPTY_PREDICTIONS: PredictionsFile = { version: PREDICTIONS_VERSION, items: [] };

/** То, что приложение знает о матче в момент наблюдения. */
export interface ObservedMatch {
  id: string;
  leagueId?: string;
  status: string;
  statusText?: string;
  timeUtc?: string | null;
  homeName: string;
  awayName: string;
  scoreHome: number | null;
  scoreAway: number | null;
}

// ---------------------------------------------------------------------------
// Правила
// ---------------------------------------------------------------------------

export type Outcome = 'home' | 'draw' | 'away';

export function outcomeOf(home: number, away: number): Outcome {
  return home > away ? 'home' : home < away ? 'away' : 'draw';
}

export type HitKind = 'exact' | 'outcome' | 'miss';

interface Rules {
  exact: number;
  outcome: number;
}

/** Правила очков по версиям. Новые правила — новая запись, старые не меняются. */
const RULES: Record<number, Rules> = { 1: { exact: 3, outcome: 1 } };

export function scoreGuess(
  guess: { home: number; away: number },
  result: { home: number; away: number },
  rules: number = RULES_VERSION,
): { points: number; kind: HitKind } {
  const table = RULES[rules] ?? RULES[RULES_VERSION]!;
  if (guess.home === result.home && guess.away === result.away)
    return { points: table.exact, kind: 'exact' };
  if (outcomeOf(guess.home, guess.away) === outcomeOf(result.home, result.away))
    return { points: table.outcome, kind: 'outcome' };
  return { points: 0, kind: 'miss' };
}

const statusKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const EXTRA_TIME_STATUSES = [
  'aet',
  'afterextratime',
  'extratime',
  'afterpenalties',
  'afterpen',
  'pen',
  'penalties',
];

/** Источник пометил матч как дошедший до дополнительного времени или пенальти. */
export function reachedExtraTime(status: string, statusText?: string): boolean {
  return [status, statusText ?? ''].map(statusKey).some((key) => EXTRA_TIME_STATUSES.includes(key));
}

export function kickoffMs(timeUtc: string | null | undefined): number | null {
  if (typeof timeUtc !== 'string' || !timeUtc.includes('T')) return null;
  const parsed = Date.parse(timeUtc);
  return Number.isNaN(parsed) ? null : parsed;
}

export type ClosedReason =
  | 'unsupported'
  | 'unknown-kickoff'
  | 'started'
  | 'finished'
  | 'cancelled'
  | 'postponed'
  | 'unknown-status';

export type Availability = { open: true } | { open: false; reason: ClosedReason };

/**
 * Можно ли ставить и менять прогноз. Матч, который начался (по статусу или по
 * времени начала), закрывает редактирование. Без известного времени начала
 * прогноз не принимается: нельзя понять, не начался ли матч.
 */
export function availability(match: ObservedMatch, now: number): Availability {
  if (!match.leagueId || !PREDICTION_LEAGUES.includes(match.leagueId))
    return { open: false, reason: 'unsupported' };
  switch (classifyMatchStatus(match.status, match.statusText)) {
    case 'finished':
      return { open: false, reason: 'finished' };
    case 'cancelled':
      return { open: false, reason: 'cancelled' };
    case 'postponed':
      return { open: false, reason: 'postponed' };
    case 'live':
      return { open: false, reason: 'started' };
    case 'unknown':
      return { open: false, reason: 'unknown-status' };
    case 'scheduled':
      break;
  }
  const start = kickoffMs(match.timeUtc);
  if (start === null) return { open: false, reason: 'unknown-kickoff' };
  return start > now ? { open: true } : { open: false, reason: 'started' };
}

export type Settled =
  | { state: 'pending' }
  | { state: 'void'; reason: VoidReason | 'late' }
  | { state: 'scored'; points: number; kind: HitKind; result: { home: number; away: number } };

/** Очки прогноза, выведенные из последнего известного итога. */
export function settle(prediction: Prediction): Settled {
  if (prediction.void) return { state: 'void', reason: prediction.void };
  if (!prediction.result) return { state: 'pending' };
  const start = Date.parse(prediction.kickoff);
  const edited = Date.parse(prediction.updatedAt);
  // Прогноз, изменённый не раньше начала матча, не может считаться (часы, переносы).
  if (Number.isFinite(start) && Number.isFinite(edited) && edited >= start)
    return { state: 'void', reason: 'late' };
  return {
    state: 'scored',
    result: { home: prediction.result.home, away: prediction.result.away },
    ...scoreGuess(prediction, prediction.result, prediction.rules),
  };
}

export interface PredictionStats {
  scored: number;
  points: number;
  exact: number;
  outcome: number;
  miss: number;
  pending: number;
  voided: number;
  /** Рассчитанные прогнозы по матчам, скрытым режимом без спойлеров: в итоги не входят. */
  hidden: number;
}

export function summarize(
  items: readonly Prediction[],
  isHidden: (matchId: string) => boolean = () => false,
): PredictionStats {
  const stats: PredictionStats = {
    scored: 0,
    points: 0,
    exact: 0,
    outcome: 0,
    miss: 0,
    pending: 0,
    voided: 0,
    hidden: 0,
  };
  for (const item of items) {
    const settled = settle(item);
    if (settled.state === 'pending') stats.pending += 1;
    else if (settled.state === 'void') stats.voided += 1;
    else if (isHidden(item.matchId)) stats.hidden += 1;
    else {
      stats.scored += 1;
      stats.points += settled.points;
      if (settled.kind === 'exact') stats.exact += 1;
      else if (settled.kind === 'outcome') stats.outcome += 1;
      else stats.miss += 1;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Изменения списка (чистые функции)
// ---------------------------------------------------------------------------

function validGoals(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_GOALS;
}

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 99;
}

export type SaveFailure = ClosedReason | 'invalid-score';

/** Ставит или меняет прогноз. Возвращает новый список или причину отказа. */
export function withPrediction(
  items: readonly Prediction[],
  match: ObservedMatch,
  guess: { home: number; away: number },
  now: number,
): { ok: true; items: Prediction[] } | { ok: false; reason: SaveFailure } {
  if (!validGoals(guess.home) || !validGoals(guess.away))
    return { ok: false, reason: 'invalid-score' };
  const open = availability(match, now);
  if (!open.open) return { ok: false, reason: open.reason };
  const kickoff = new Date(kickoffMs(match.timeUtc) ?? now).toISOString();
  const stamp = new Date(now).toISOString();
  const existing = items.find((item) => item.matchId === match.id);
  const next: Prediction = {
    matchId: match.id,
    leagueId: match.leagueId ?? '',
    home: guess.home,
    away: guess.away,
    homeTeam: match.homeName,
    awayTeam: match.awayName,
    kickoff,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
    rules: existing?.rules ?? RULES_VERSION,
  };
  const rest = items.filter((item) => item.matchId !== match.id);
  return { ok: true, items: prune([...rest, next]) };
}

/** Хранится не больше MAX_PREDICTIONS записей: сначала уходят старые рассчитанные и неучтённые. */
function prune(items: Prediction[]): Prediction[] {
  if (items.length <= MAX_PREDICTIONS) return items;
  const done = items
    .filter((item) => settle(item).state !== 'pending')
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const drop = new Set(done.slice(0, items.length - MAX_PREDICTIONS).map((item) => item.matchId));
  return items.filter((item) => !drop.has(item.matchId)).slice(-MAX_PREDICTIONS);
}

/**
 * Убрать прогноз можно, пока матч не начался или пока он не учитывается.
 * Рассчитанный прогноз убрать нельзя: нельзя стереть неудачный.
 */
export function withoutPrediction(
  items: readonly Prediction[],
  matchId: string,
  now: number,
): Prediction[] {
  const target = items.find((item) => item.matchId === matchId);
  if (!target) return items as Prediction[];
  const settled = settle(target);
  const started = Date.parse(target.kickoff) <= now;
  if (settled.state === 'scored' || (started && settled.state === 'pending')) {
    return items as Prediction[];
  }
  return items.filter((item) => item.matchId !== matchId);
}

/**
 * Обновляет прогноз по свежему наблюдению матча: перенос начала, название,
 * итог, отмена. Побеждает последнее наблюдение: исправленный итог заменяет
 * прежний, возврат к обычному статусу снимает пометку «не учитывается».
 */
export function observed(
  items: readonly Prediction[],
  match: ObservedMatch,
  nowIso: string,
): Prediction[] {
  const index = items.findIndex((item) => item.matchId === match.id);
  if (index < 0) return items as Prediction[];
  const current = items[index]!;
  const next: Prediction = { ...current };
  const state = classifyMatchStatus(match.status, match.statusText);
  const start = kickoffMs(match.timeUtc);
  if ((state === 'scheduled' || state === 'postponed') && start !== null)
    next.kickoff = new Date(start).toISOString();
  if (match.homeName) next.homeTeam = match.homeName;
  if (match.awayName) next.awayTeam = match.awayName;
  if (state === 'cancelled') {
    next.void = 'cancelled';
  } else if (state === 'finished') {
    if (reachedExtraTime(match.status, match.statusText)) {
      next.void = 'extra-time';
      delete next.result;
    } else if (validScore(match.scoreHome) && validScore(match.scoreAway)) {
      delete next.void;
      if (
        !current.result ||
        current.result.home !== match.scoreHome ||
        current.result.away !== match.scoreAway
      )
        next.result = { home: match.scoreHome, away: match.scoreAway, seenAt: nowIso };
    }
  } else if (state === 'scheduled' || state === 'postponed' || state === 'live') {
    delete next.void;
  }
  const same = JSON.stringify(next) === JSON.stringify(current);
  if (same) return items as Prediction[];
  return items.map((item, i) => (i === index ? next : item));
}

/** Прогнозы, итог которых стоит проверить: матч уже должен был закончиться. */
export function needsCheck(items: readonly Prediction[], now: number): Prediction[] {
  return items.filter((item) => {
    if (item.void) return false;
    const start = Date.parse(item.kickoff);
    return Number.isFinite(start) && start + SETTLE_AFTER_MS <= now;
  });
}

// ---------------------------------------------------------------------------
// Разбор и хранение
// ---------------------------------------------------------------------------

function iso(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = Array.from(value)
    .filter((ch) => ch >= ' ' && ch !== '\u007f')
    .join('')
    .trim();
  return clean && clean.length <= max ? clean : null;
}

function parseItem(value: unknown): Prediction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const matchId = text(raw.matchId, 80);
  const leagueId = text(raw.leagueId, 40);
  const homeTeam = text(raw.homeTeam, 80);
  const awayTeam = text(raw.awayTeam, 80);
  const kickoff = iso(raw.kickoff);
  const createdAt = iso(raw.createdAt);
  const updatedAt = iso(raw.updatedAt);
  if (!matchId || !leagueId || !homeTeam || !awayTeam || !kickoff || !createdAt || !updatedAt)
    return null;
  if (!validGoals(raw.home) || !validGoals(raw.away)) return null;
  if (typeof raw.rules !== 'number' || !Number.isInteger(raw.rules) || raw.rules < 1) return null;
  const item: Prediction = {
    matchId,
    leagueId,
    home: raw.home,
    away: raw.away,
    homeTeam,
    awayTeam,
    kickoff,
    createdAt,
    updatedAt,
    rules: raw.rules,
  };
  const result = raw.result as Record<string, unknown> | undefined;
  if (result && typeof result === 'object') {
    const seenAt = iso(result.seenAt);
    if (validScore(result.home) && validScore(result.away) && seenAt)
      item.result = { home: result.home, away: result.away, seenAt };
  }
  if (raw.void === 'cancelled' || raw.void === 'extra-time') item.void = raw.void;
  return item;
}

/** Разбирает сохранённое значение. null — значение не похоже на список прогнозов. */
export function parsePredictions(value: unknown): PredictionsFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version < 1)
    return null;
  const byMatch = new Map<string, Prediction>();
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const item = parseItem(entry);
    if (!item) continue;
    const previous = byMatch.get(item.matchId);
    if (!previous || Date.parse(item.updatedAt) >= Date.parse(previous.updatedAt))
      byMatch.set(item.matchId, item);
  }
  return { version: raw.version, items: prune([...byMatch.values()]) };
}

export function isValidPredictionsValue(value: string): boolean {
  try {
    return parsePredictions(JSON.parse(value)) !== null;
  } catch {
    return false;
  }
}

let cachedRaw: string | null | undefined;
let cachedValue: PredictionsFile = EMPTY_PREDICTIONS;

export function readPredictions(): PredictionsFile {
  const raw = getString(PREDICTIONS_KEY);
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  let parsed: PredictionsFile | null = null;
  if (raw) {
    try {
      parsed = parsePredictions(JSON.parse(raw));
    } catch {
      parsed = null;
    }
  }
  cachedValue = parsed ?? EMPTY_PREDICTIONS;
  return cachedValue;
}

function write(items: Prediction[]): void {
  setJson(PREDICTIONS_KEY, { version: PREDICTIONS_VERSION, items });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PREDICTIONS_CHANGED_EVENT));
}

export function savePrediction(
  match: ObservedMatch,
  guess: { home: number; away: number },
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: SaveFailure } {
  const result = withPrediction(readPredictions().items, match, guess, now);
  if (!result.ok) return result;
  write(result.items);
  return { ok: true };
}

export function removePrediction(matchId: string, now: number = Date.now()): boolean {
  const before = readPredictions().items;
  const after = withoutPrediction(before, matchId, now);
  if (after === before || after.length === before.length) return false;
  write(after);
  return true;
}

/** Применяет свежее наблюдение матча к сохранённому прогнозу, если оно что-то меняет. */
export function observeMatchResult(
  match: ObservedMatch,
  nowIso: string = new Date().toISOString(),
): void {
  const before = readPredictions().items;
  const after = observed(before, match, nowIso);
  if (after !== before) write(after);
}

export function resetPredictions(): void {
  write([]);
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(PREDICTIONS_CHANGED_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(PREDICTIONS_CHANGED_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function usePredictions(): PredictionsFile {
  return useSyncExternalStore(subscribe, readPredictions, () => EMPTY_PREDICTIONS);
}
