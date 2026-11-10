import { buildOfflineSeason } from './offlineSource';
import { useSyncExternalStore } from 'react';
import { api, rpc } from '../../lib/bridge';
import { bounded, instant, isObject, seasonKey, MAX_OFFLINE_SEASONS } from './offlineModel';

export const OFFLINE_QUEUE_KEY = 'sportsdesk.view.offline';
export type JobState = 'queued' | 'downloading' | 'saving' | 'done' | 'error';
export interface OfflineJob {
  leagueId: string;
  leagueName: string;
  season: string;
  attempt: string;
  pin: boolean;
  state: JobState;
  error: string | null;
  addedAt: string;
}
export interface OfflineQueue {
  version: 1;
  paused: boolean;
  jobs: OfflineJob[];
}
const empty = (): OfflineQueue => ({ version: 1, paused: true, jobs: [] });
export function parseOfflineQueue(raw: string): OfflineQueue | null {
  try {
    if (new TextEncoder().encode(raw).length > 100_000) return null;
    const v: unknown = JSON.parse(raw);
    if (
      !isObject(v) ||
      v.version !== 1 ||
      typeof v.paused !== 'boolean' ||
      !Array.isArray(v.jobs) ||
      v.jobs.length > MAX_OFFLINE_SEASONS
    )
      return null;
    const ids = new Set<string>();
    for (const j of v.jobs) {
      if (
        !isObject(j) ||
        !bounded(j.leagueId, 100) ||
        !bounded(j.leagueName, 200) ||
        !bounded(j.season, 30) ||
        !bounded(j.attempt, 100) ||
        typeof j.pin !== 'boolean' ||
        !['queued', 'downloading', 'saving', 'done', 'error'].includes(String(j.state)) ||
        !(j.error === null || bounded(j.error, 500, true)) ||
        !instant(j.addedAt)
      )
        return null;
      const key = seasonKey(j.leagueId, j.season);
      if (ids.has(key)) return null;
      ids.add(key);
    }
    return v as unknown as OfflineQueue;
  } catch {
    return null;
  }
}
export const validOfflineQueueValue = (raw: string) => parseOfflineQueue(raw) !== null;
export function offlineQueueError(raw: string) {
  try {
    if (JSON.parse(raw)?.version > 1)
      return 'Очередь создана новой версией SportsDesk. Обновите приложение.';
  } catch {
    /* invalid */
  }
  return 'Очередь офлайн-сезонов повреждена или недоступна. Сохранённые пакеты можно читать; очередь не перезаписана.';
}
let lastRaw: string | null | undefined;
let lastError: string | null = null;
let snapshot: { queue: OfflineQueue; error: string | null; writable: boolean };
let runtimeError: string | null = null;
export function readOfflineQueue() {
  let raw: string | null;
  try {
    raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
  } catch {
    raw = '@unavailable';
  }
  if (snapshot && raw === lastRaw && runtimeError === lastError) return snapshot;
  const parsed = raw === null ? empty() : parseOfflineQueue(raw);
  lastRaw = raw;
  lastError = runtimeError;
  snapshot = {
    queue: parsed ?? empty(),
    error: parsed ? runtimeError : offlineQueueError(raw!),
    writable: !!parsed,
  };
  return snapshot;
}
function changedKey(event: Event) {
  return event instanceof StorageEvent
    ? event.key
    : (event as CustomEvent<{ key?: string }>).detail?.key;
}
function subscribe(listener: () => void) {
  const changed = (e: Event) => {
    if (changedKey(e) === OFFLINE_QUEUE_KEY || changedKey(e) === null) listener();
  };
  window.addEventListener('storage', changed);
  window.addEventListener('sportsdesk-storage-changed', changed);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener('sportsdesk-storage-changed', changed);
  };
}
export const useOfflineQueue = () =>
  useSyncExternalStore(subscribe, readOfflineQueue, readOfflineQueue);
function signal() {
  window.dispatchEvent(
    new CustomEvent('sportsdesk-storage-changed', { detail: { key: OFFLINE_QUEUE_KEY } }),
  );
}
function write(queue: OfflineQueue) {
  const state = readOfflineQueue();
  if (!state.writable) throw new Error(state.error!);
  const raw = JSON.stringify(queue);
  if (!validOfflineQueueValue(raw))
    throw new Error('Лимит очереди — 60 сезонов. Удалите завершённую запись из очереди.');
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, raw);
  } catch {
    throw new Error('Не удалось сохранить очередь. Загрузка остановлена.');
  }
  runtimeError = null;
  signal();
}
export function enqueueSeason(leagueId: string, leagueName: string, season: string, pin = true) {
  const q = readOfflineQueue().queue;
  const old = q.jobs.find((j) => seasonKey(j.leagueId, j.season) === seasonKey(leagueId, season));
  if (old && ['queued', 'downloading', 'saving'].includes(old.state)) return;
  const job: OfflineJob = {
    leagueId,
    leagueName,
    season,
    attempt: crypto.randomUUID(),
    pin,
    state: 'queued',
    error: null,
    addedAt: new Date().toISOString(),
  };
  write({ ...q, paused: false, jobs: [...q.jobs.filter((j) => j !== old), job] });
}
export function pauseOfflineQueue(paused: boolean) {
  write({ ...readOfflineQueue().queue, paused });
}
export function removeOfflineJob(job: OfflineJob) {
  if (['downloading', 'saving'].includes(job.state))
    throw new Error('Дождитесь завершения текущего запроса или поставьте очередь на паузу.');
  write({
    ...readOfflineQueue().queue,
    jobs: readOfflineQueue().queue.jobs.filter((j) => j.attempt !== job.attempt),
  });
}

/** One request/atomic commit at a time, including across page navigation and pause/resume. */
let runners = 0;
let running = false;
let unsubscribe: (() => void) | null = null;
let epoch = 0;
function current(job: OfflineJob) {
  return readOfflineQueue().queue.jobs.find((j) => j.attempt === job.attempt);
}
function update(job: OfflineJob, patch: Partial<OfflineJob>) {
  const q = readOfflineQueue().queue;
  write({ ...q, jobs: q.jobs.map((j) => (j.attempt === job.attempt ? { ...j, ...patch } : j)) });
}
async function pump() {
  if (running || !runners || runtimeError) return;
  const state = readOfflineQueue();
  if (!state.writable || state.queue.paused) return;
  const job = state.queue.jobs.find((j) => j.state === 'queued');
  if (!job) return;
  const generation = epoch;
  running = true;
  try {
    update(job, { state: 'downloading', error: null });
    const reply = await api(
      'pitch',
      `leagues/${encodeURIComponent(job.leagueId)}/matches?season=${encodeURIComponent(job.season)}&status=all`,
    );
    if (!runners || generation !== epoch || !current(job)) return;
    if (readOfflineQueue().queue.paused) {
      update(job, { state: 'queued' });
      return;
    }
    if (reply.stale)
      throw new Error(
        'Источник недоступен: получен устаревший кеш. Прежний офлайн-пакет сохранён.',
      );
    const packageData = buildOfflineSeason(
      reply.payload,
      job.leagueId,
      job.leagueName,
      job.season,
      reply.fetchedAt,
    );
    packageData.pinned = job.pin;
    update(job, { state: 'saving' });
    await rpc('offline_put', { package: packageData });
    window.dispatchEvent(new Event('sportsdesk-offline-changed'));
    if (runners && generation === epoch && current(job)) update(job, { state: 'done' });
  } catch (e) {
    if (runners && generation === epoch && current(job)) {
      try {
        update(job, {
          state: 'error',
          error: (e instanceof Error ? e.message : 'Загрузка не удалась.').slice(0, 500),
        });
      } catch (error) {
        runtimeError = error instanceof Error ? error.message : 'Очередь недоступна.';
        signal();
      }
    }
  } finally {
    running = false;
    if (runners) void pump();
  }
}
export function startOfflineRunner() {
  if (runners++ === 0) {
    epoch++;
    const state = readOfflineQueue();
    if (state.writable) {
      try {
        // Every application launch requires explicit resume; a request may have committed before exit.
        write({
          ...state.queue,
          paused: true,
          jobs: state.queue.jobs.map((j) =>
            ['downloading', 'saving'].includes(j.state)
              ? { ...j, state: 'queued', error: null }
              : j,
          ),
        });
      } catch (e) {
        runtimeError = e instanceof Error ? e.message : 'Очередь недоступна.';
        signal();
      }
    }
    unsubscribe = subscribe(() => {
      void pump();
    });
  }
  return () => {
    if (--runners === 0) {
      epoch++;
      unsubscribe?.();
      unsubscribe = null;
    }
  };
}
