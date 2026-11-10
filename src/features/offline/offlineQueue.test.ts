// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, rpc } from '../../lib/bridge';
import { offlinePayload, offlineSeason } from '../../test/fixtures/offline';
import {
  OFFLINE_QUEUE_KEY,
  enqueueSeason,
  pauseOfflineQueue,
  readOfflineQueue,
  removeOfflineJob,
  startOfflineRunner,
  validOfflineQueueValue,
} from './offlineQueue';
import { replaceProfile } from '../settings/profileBackup';
vi.mock('../../lib/bridge', () => ({ api: vi.fn(), rpc: vi.fn(), isTauriRuntime: () => false }));
const reply = () => ({
  payload: offlinePayload(),
  source: 'pitch',
  stale: false,
  fetchedAt: offlineSeason.fetchedAt,
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let stop: (() => void) | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockReset();
  vi.mocked(rpc).mockReset();
  vi.mocked(api).mockResolvedValue(reply());
  vi.mocked(rpc).mockResolvedValue({});
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  await flush();
  vi.restoreAllMocks();
});
const enqueue = () =>
  enqueueSeason(offlineSeason.leagueId, offlineSeason.leagueName, offlineSeason.season);
it('downloads once, commits the complete package and leaves no duplicate job', async () => {
  stop = startOfflineRunner();
  enqueue();
  enqueue();
  await flush();
  expect(api).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('offline_put', { package: offlineSeason });
  expect(readOfflineQueue().queue.jobs).toHaveLength(1);
  expect(readOfflineQueue().queue.jobs[0]?.state).toBe('done');
});
it('pauses before saving, then resumes sequentially without overlapping requests', async () => {
  const pending = deferred<ReturnType<typeof reply>>();
  vi.mocked(api).mockReturnValueOnce(pending.promise);
  stop = startOfflineRunner();
  enqueue();
  pauseOfflineQueue(true);
  await flush();
  expect(api).toHaveBeenCalledTimes(1);
  pending.resolve(reply());
  await flush();
  expect(rpc).not.toHaveBeenCalled();
  expect(readOfflineQueue().queue.jobs[0]?.state).toBe('queued');
  pauseOfflineQueue(false);
  await flush();
  expect(api).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('waits for an in-flight request when quickly paused and resumed', async () => {
  const pending = deferred<ReturnType<typeof reply>>();
  vi.mocked(api).mockReturnValueOnce(pending.promise);
  stop = startOfflineRunner();
  enqueue();
  pauseOfflineQueue(true);
  pauseOfflineQueue(false);
  await flush();
  expect(api).toHaveBeenCalledTimes(1);
  pending.resolve(reply());
  await flush();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(readOfflineQueue().queue.jobs[0]?.state).toBe('done');
});
it('finishes an already started atomic save while the next season stays paused', async () => {
  const saving = deferred<unknown>();
  vi.mocked(rpc).mockReturnValueOnce(saving.promise);
  stop = startOfflineRunner();
  enqueue();
  await flush();
  expect(readOfflineQueue().queue.jobs[0]?.state).toBe('saving');
  enqueueSeason('other', 'Other', '2026');
  pauseOfflineQueue(true);
  saving.resolve({});
  await flush();
  expect(api).toHaveBeenCalledTimes(1);
  expect(readOfflineQueue().queue.jobs.map((j) => j.state)).toEqual(['done', 'queued']);
});
it('requeues interrupted requests on launch and waits for explicit resume', async () => {
  localStorage.setItem(
    OFFLINE_QUEUE_KEY,
    JSON.stringify({
      version: 1,
      paused: false,
      jobs: [
        {
          leagueId: offlineSeason.leagueId,
          leagueName: offlineSeason.leagueName,
          season: offlineSeason.season,
          attempt: 'previous',
          pin: true,
          state: 'saving',
          error: null,
          addedAt: offlineSeason.fetchedAt,
        },
      ],
    }),
  );
  stop = startOfflineRunner();
  await flush();
  expect(api).not.toHaveBeenCalled();
  expect(readOfflineQueue().queue).toMatchObject({ paused: true, jobs: [{ state: 'queued' }] });
  pauseOfflineQueue(false);
  await flush();
  expect(readOfflineQueue().queue.jobs[0]?.state).toBe('done');
});
it('keeps errors explicit and retries a failed atomic save idempotently', async () => {
  vi.mocked(rpc).mockRejectedValueOnce(new Error('Нет места на диске'));
  stop = startOfflineRunner();
  enqueue();
  await flush();
  expect(readOfflineQueue().queue.jobs[0]).toMatchObject({
    state: 'error',
    error: 'Нет места на диске',
  });
  enqueue();
  await flush();
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(readOfflineQueue().queue.jobs).toHaveLength(1);
  expect(readOfflineQueue().queue.jobs[0]?.state).toBe('done');
});
it('does not overwrite a saved package with stale or malformed source data', async () => {
  stop = startOfflineRunner();
  vi.mocked(api).mockResolvedValueOnce({ ...reply(), stale: true });
  enqueue();
  await flush();
  expect(rpc).not.toHaveBeenCalled();
  expect(readOfflineQueue().queue.jobs[0]?.error).toContain('устаревшие данные');
  vi.mocked(api).mockResolvedValueOnce({ ...reply(), payload: { data: { matches: [] } } });
  enqueue();
  await flush();
  expect(rpc).not.toHaveBeenCalled();
  expect(readOfflineQueue().queue.jobs[0]?.state).toBe('error');
});
it('leaves corrupt and future queues untouched and validates profile imports atomically', () => {
  for (const raw of ['{bad', JSON.stringify({ version: 2, paused: false, jobs: [] })]) {
    localStorage.setItem(OFFLINE_QUEUE_KEY, raw);
    expect(readOfflineQueue().writable).toBe(false);
    expect(() => enqueue()).toThrow();
    expect(localStorage.getItem(OFFLINE_QUEUE_KEY)).toBe(raw);
    expect(() =>
      replaceProfile({ 'sportsdesk.scheme': 'light', [OFFLINE_QUEUE_KEY]: raw }),
    ).toThrow();
  }
});
it('persists a bounded queue in the profile and removes only queue metadata', async () => {
  stop = startOfflineRunner();
  enqueue();
  await flush();
  const q = readOfflineQueue().queue;
  expect(validOfflineQueueValue(JSON.stringify({ ...q, jobs: [...q.jobs, ...q.jobs] }))).toBe(
    false,
  );
  expect(validOfflineQueueValue(JSON.stringify({ ...q, version: 2 }))).toBe(false);
  const raw = localStorage.getItem(OFFLINE_QUEUE_KEY)!;
  replaceProfile({ [OFFLINE_QUEUE_KEY]: raw });
  expect(readOfflineQueue().queue.jobs).toHaveLength(1);
  removeOfflineJob(readOfflineQueue().queue.jobs[0]!);
  expect(readOfflineQueue().queue.jobs).toHaveLength(0);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('stops before requesting data when the queue cannot be persisted', async () => {
  stop = startOfflineRunner();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(() => enqueue()).toThrow('сохранить очередь');
  await flush();
  expect(api).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it('refuses a 61st season without evicting any queued metadata', () => {
  const jobs = Array.from({ length: 60 }, (_, i) => ({
    leagueId: `league-${i}`,
    leagueName: `League ${i}`,
    season: '2026',
    attempt: `attempt-${i}`,
    pin: true,
    state: 'queued',
    error: null,
    addedAt: offlineSeason.fetchedAt,
  }));
  const raw = JSON.stringify({ version: 1, paused: true, jobs });
  localStorage.setItem(OFFLINE_QUEUE_KEY, raw);
  expect(() => enqueue()).toThrow('60 сезонов');
  expect(localStorage.getItem(OFFLINE_QUEUE_KEY)).toBe(raw);
});

it('preserves an unpinned package when refreshing, including a retry', async () => {
  stop = startOfflineRunner();
  vi.mocked(rpc).mockRejectedValueOnce(new Error('retry'));
  enqueueSeason(offlineSeason.leagueId, offlineSeason.leagueName, offlineSeason.season, false);
  await flush();
  const j = readOfflineQueue().queue.jobs[0]!;
  enqueueSeason(j.leagueId, j.leagueName, j.season, j.pin);
  await flush();
  expect(vi.mocked(rpc).mock.calls[1]?.[1]).toEqual({
    package: { ...offlineSeason, pinned: false },
  });
});
