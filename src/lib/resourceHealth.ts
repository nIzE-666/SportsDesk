/** Shared data transport health. RPC commands never enter this retry registry. */
import { toApiFailure, type ApiFailure } from './apiError';
export interface HealthFailure {
  key: string;
  fetchedAt: string | null;
  code?: string;
}
export interface HealthSnapshot {
  failures: ReadonlyArray<HealthFailure>;
  lastFetchedAt: string | null;
  retrying: boolean;
  autoRetryPending: boolean;
}
interface Reply {
  fetchedAt: string;
  stale: boolean;
  failure?: ApiFailure;
}
interface ResourceState {
  key: string;
  failed: boolean;
  fetchedAt: string | null;
  failure: ApiFailure | null;
  retry: (() => Promise<Reply>) | null;
  attempt: number;
  lastAttempt: number;
  nextAt: number;
  managed: boolean;
  consumers: number;
}
const states = new Map<string, ResourceState>(),
  requests = new Map<string, Promise<Reply>>();
const listeners = new Set<() => void>(),
  BACKOFF = [5000, 10000, 20000, 40000, 60000];
export const MAX_AUTO_RETRIES = 5;
export function beginAutomaticRequest(source: string, path: string): ApiFailure | null {
  const state = states.get(resourceKey(source, path));
  if (!state?.failed) return null;
  if (!eligible(state))
    return (
      state.failure ?? {
        code: 'Upstream',
        message: 'Автоматические повторы остановлены. Обновите данные вручную.',
        retryable: true,
      }
    );
  state.attempt++;
  return null;
}
let snapshot: HealthSnapshot = Object.freeze({
  failures: Object.freeze([]),
  lastFetchedAt: null,
  retrying: false,
  autoRetryPending: false,
});
let lastFetchedAt: string | null = null,
  timer: ReturnType<typeof setTimeout> | null = null;
let cycling = false,
  onlineBound = false,
  sequence = 0,
  activeSources: Set<string> | null = null;
export function resourceKey(source: string, path: string) {
  return source + ':' + path;
}
export function getHealthSnapshot() {
  return snapshot;
}
export function subscribeHealth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function visible(s: ResourceState) {
  return (
    (!s.managed || s.consumers > 0) &&
    (!activeSources || activeSources.has(s.key.split(':', 1)[0]!))
  );
}
function eligible(s: ResourceState) {
  return (
    s.failed &&
    s.retry &&
    visible(s) &&
    s.failure?.retryable !== false &&
    s.attempt < MAX_AUTO_RETRIES
  );
}
function emit() {
  const lastFetchedAt =
    [...states.values()]
      .filter(visible)
      .map((s) => s.fetchedAt)
      .filter((s): s is string => !!s)
      .sort()
      .at(-1) ?? null;
  const failures = [...states.values()]
    .filter((s) => s.failed && visible(s))
    .map((s) =>
      Object.freeze({
        key: s.key,
        fetchedAt: s.fetchedAt,
        ...(s.failure ? { code: s.failure.code } : {}),
      }),
    )
    .sort((a, b) => a.key.localeCompare(b.key));
  const retrying = [...requests.keys()].some((key) => {
    const s = states.get(key);
    return s?.failed && visible(s);
  });
  const autoRetryPending = [...states.values()].some(eligible);
  if (
    lastFetchedAt === snapshot.lastFetchedAt &&
    retrying === snapshot.retrying &&
    autoRetryPending === snapshot.autoRetryPending &&
    failures.length === snapshot.failures.length &&
    failures.every(
      (f, i) =>
        f.key === snapshot.failures[i]?.key &&
        f.fetchedAt === snapshot.failures[i]?.fetchedAt &&
        f.code === snapshot.failures[i]?.code,
    )
  )
    return;
  snapshot = Object.freeze({
    failures: Object.freeze(failures),
    lastFetchedAt,
    retrying,
    autoRetryPending,
  });
  for (const listener of listeners) listener();
}
function ensure(source: string, path: string) {
  const key = resourceKey(source, path),
    existing = states.get(key);
  if (existing) return existing;
  if (states.size >= 256) {
    const victim = [...states.values()].find((s) => !s.consumers && !requests.has(s.key));
    if (victim) states.delete(victim.key);
  }
  const s: ResourceState = {
    key,
    failed: false,
    fetchedAt: null,
    failure: null,
    retry: null,
    attempt: 0,
    lastAttempt: 0,
    nextAt: 0,
    managed: false,
    consumers: 0,
  };
  states.set(key, s);
  return s;
}
function noteTime(value: string) {
  if (value && (!lastFetchedAt || value > lastFetchedAt)) lastFetchedAt = value;
}
function recovered(key: string) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('sportsdesk-data-recovered', { detail: { key } }));
}
export function setActiveSources(sources: readonly string[] | null) {
  activeSources = sources ? new Set(sources) : null;
  clearTimer();
  emit();
  scheduleRetry();
}
/** A mounted hook owns its retries; its last unmount immediately stops them. */
export function retainResource(source: string, path: string) {
  const s = ensure(source, path);
  s.managed = true;
  s.consumers++;
  emit();
  scheduleRetry();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    s.consumers = Math.max(0, s.consumers - 1);
    clearTimer();
    emit();
    scheduleRetry();
  };
}
export function recordFreshSuccess(source: string, path: string, fetchedAt: string) {
  const s = ensure(source, path),
    failed = s.failed;
  s.failed = false;
  s.failure = null;
  s.fetchedAt = fetchedAt;
  s.attempt = 0;
  s.nextAt = 0;
  noteTime(fetchedAt);
  emit();
  if (failed) recovered(s.key);
  clearTimer();
  scheduleRetry();
}
export function recordStale(source: string, path: string, fetchedAt: string, failure?: ApiFailure) {
  const s = ensure(source, path);
  s.failed = true;
  s.fetchedAt = fetchedAt;
  s.failure = failure ? toApiFailure(failure) : null;
  s.nextAt = Date.now() + (BACKOFF[Math.min(s.attempt, 4)] ?? 60000);
  noteTime(fetchedAt);
  emit();
  scheduleRetry();
}
export function recordFailure(source: string, path: string, error?: unknown) {
  const s = ensure(source, path);
  s.failed = true;
  s.failure = error === undefined ? null : toApiFailure(error);
  s.nextAt = Date.now() + (BACKOFF[Math.min(s.attempt, 4)] ?? 60000);
  emit();
  scheduleRetry();
}
const onOnline = () => retryFailedResources({ manual: false });
export function registerRetry(source: string, path: string, retry: () => Promise<Reply>) {
  ensure(source, path).retry = retry;
  if (!onlineBound && typeof window !== 'undefined') {
    onlineBound = true;
    window.addEventListener('online', onOnline);
  }
  scheduleRetry();
}
export function requestResource<T extends Reply>(
  source: string,
  path: string,
  call: () => Promise<T>,
  automatic = false,
): Promise<T> {
  const key = resourceKey(source, path),
    pending = requests.get(key);
  if (pending) return pending as Promise<T>;
  if (!automatic) {
    const s = ensure(source, path);
    s.attempt = 0;
  }
  const promise = Promise.resolve()
    .then(call)
    .then((reply) => {
      if (reply.stale) recordStale(source, path, reply.fetchedAt, reply.failure);
      else recordFreshSuccess(source, path, reply.fetchedAt);
      return reply;
    })
    .catch((error) => {
      recordFailure(source, path, error);
      throw error;
    })
    .finally(() => {
      requests.delete(key);
      emit();
      scheduleRetry();
    });
  requests.set(key, promise);
  emit();
  return promise;
}
function clearTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
function scheduleRetry() {
  if (timer !== null || cycling) return;
  const failed = [...states.values()].filter(eligible);
  if (!failed.length) return;
  const earliest = Math.min(...failed.map((s) => s.nextAt || Date.now() + BACKOFF[0]!));
  timer = setTimeout(
    () => {
      timer = null;
      void runRetryCycle();
    },
    Math.max(1, earliest - Date.now()),
  );
  (timer as unknown as { unref?: () => void }).unref?.();
}
async function runRetryCycle(manual = false, sources?: readonly string[]) {
  if (cycling) return;
  cycling = true;
  const candidates = [...states.values()]
    .filter(
      (s) =>
        s.failed &&
        s.retry &&
        visible(s) &&
        !requests.has(s.key) &&
        (!sources || sources.includes(s.key.split(':', 1)[0]!)) &&
        (manual || (eligible(s) && s.nextAt <= Date.now())),
    )
    .sort((a, b) => a.lastAttempt - b.lastAttempt)
    .slice(0, 3);
  await Promise.allSettled(
    candidates.map((s) => {
      if (manual) s.attempt = 0;
      s.attempt++;
      s.lastAttempt = ++sequence;
      const separator = s.key.indexOf(':');
      return requestResource(s.key.slice(0, separator), s.key.slice(separator + 1), s.retry!, true);
    }),
  );
  cycling = false;
  emit();
  scheduleRetry();
}
export function retryFailedResources(
  options: { manual?: boolean; sources?: readonly string[] } = {},
) {
  clearTimer();
  void runRetryCycle(options.manual !== false, options.sources);
}
export function getResourceDiagnostics() {
  return [...states.values()].map((s) => ({
    key: s.key,
    failed: s.failed,
    fetchedAt: s.fetchedAt,
    code: s.failure?.code ?? null,
    message: s.failure?.message ?? null,
    attempt: s.attempt,
    automatic: !!eligible(s),
    active: visible(s),
    consumers: s.consumers,
  }));
}
export function __resetForTest() {
  clearTimer();
  if (onlineBound && typeof window !== 'undefined')
    window.removeEventListener?.('online', onOnline);
  states.clear();
  requests.clear();
  listeners.clear();
  onlineBound = false;
  cycling = false;
  sequence = 0;
  lastFetchedAt = null;
  activeSources = null;
  snapshot = Object.freeze({
    failures: Object.freeze([]),
    lastFetchedAt: null,
    retrying: false,
    autoRetryPending: false,
  });
}
