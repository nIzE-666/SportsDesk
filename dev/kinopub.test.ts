import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  writes: vi.fn(),
  deletes: vi.fn(),
}));
vi.mock('./secrets', () => ({
  SECRET_FILES: { kinoClient: 'client', kinoTokens: 'tokens' },
  readJsonSecret: (name: string) => {
    const value = storage.values.get(name);
    return value ? JSON.parse(value) : null;
  },
  writeSecret: (name: string, value: string) => {
    storage.writes(name, value);
    storage.values.set(name, value);
  },
  deleteSecret: (name: string) => {
    storage.deletes(name);
    storage.values.delete(name);
  },
  secretPath: (name: string) => name,
}));

function response(value: object): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const device = { code: 'device', user_code: 'TEST', expires_in: 3, interval: 2 };
const tokens = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 };

beforeEach(() => {
  vi.resetModules();
  storage.values.clear();
  storage.writes.mockReset();
  storage.deletes.mockReset();
  storage.values.set(
    'client',
    JSON.stringify({ baseUrl: 'https://example.test', clientId: 'id', clientSecret: 'secret' }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('never saves a poll response after cancellation or a newer attempt', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const kino = await import('./kinopub');
  const first = kino.beginAuth().sessionId;
  fetchMock.mockResolvedValueOnce(response(device));
  await kino.startAuth(first);
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const poll = kino.pollAuth(first);
  kino.cancelAuth(first);
  const second = kino.beginAuth().sessionId;
  fetchMock.mockResolvedValueOnce(response(device));
  await kino.startAuth(second);
  pending.resolve(response(tokens));
  await expect(poll).rejects.toThrow();
  expect(storage.writes).not.toHaveBeenCalled();
  expect(() => kino.commitAuth(first)).toThrow();
  fetchMock.mockResolvedValueOnce(response(tokens));
  expect(await kino.pollAuth(second)).toEqual({ pending: false, authenticated: true });
  expect(storage.writes).not.toHaveBeenCalled();
  kino.commitAuth(second);
  expect(JSON.parse(storage.values.get('tokens')!).access_token).toBe('new-access');
});

it('rejects a poll that finishes after the device code expires', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const kino = await import('./kinopub');
  const id = kino.beginAuth().sessionId;
  fetchMock.mockResolvedValueOnce(response(device));
  await kino.startAuth(id);
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const poll = kino.pollAuth(id);
  await vi.advanceTimersByTimeAsync(3000);
  pending.resolve(response(tokens));
  await expect(poll).rejects.toThrow('истёк');
  expect(storage.writes).not.toHaveBeenCalled();
});

it('restores earlier credentials if a commit is cancelled before acknowledgement', async () => {
  storage.values.set(
    'tokens',
    JSON.stringify({
      access_token: 'old',
      refresh_token: 'old-refresh',
      expires_at: Date.now() + 60000,
      baseUrl: 'https://example.test',
    }),
  );
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(device))
    .mockResolvedValueOnce(response(tokens));
  vi.stubGlobal('fetch', fetchMock);
  const kino = await import('./kinopub');
  const id = kino.beginAuth().sessionId;
  await kino.startAuth(id);
  await kino.pollAuth(id);
  kino.commitAuth(id);
  expect(JSON.parse(storage.values.get('tokens')!).access_token).toBe('new-access');
  kino.cancelAuth(id);
  expect(JSON.parse(storage.values.get('tokens')!).access_token).toBe('old');
});

it.each([true, false])(
  'retries a failed expiry rollback after writing the candidate (previous credentials: %s)',
  async (hasPrevious) => {
    vi.useFakeTimers();
    if (hasPrevious) {
      storage.values.set(
        'tokens',
        JSON.stringify({
          access_token: 'old',
          refresh_token: 'old-refresh',
          expires_at: Date.now() + 60000,
          baseUrl: 'https://example.test',
        }),
      );
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(device))
      .mockResolvedValueOnce(response(tokens));
    vi.stubGlobal('fetch', fetchMock);
    const kino = await import('./kinopub');
    const id = kino.beginAuth().sessionId;
    await kino.startAuth(id);
    await kino.pollAuth(id);
    storage.writes.mockImplementationOnce(() => vi.setSystemTime(Date.now() + 3000));
    if (hasPrevious) {
      storage.writes.mockImplementationOnce(() => {
        throw new Error('rollback failed');
      });
    } else {
      storage.deletes.mockImplementationOnce(() => {
        throw new Error('rollback failed');
      });
    }

    expect(() => kino.commitAuth(id)).toThrow('rollback failed');
    expect(JSON.parse(storage.values.get('tokens')!).access_token).toBe('new-access');
    expect(storage.writes).toHaveBeenCalledTimes(hasPrevious ? 2 : 1);
    expect(storage.deletes).toHaveBeenCalledTimes(hasPrevious ? 0 : 1);

    kino.cancelAuth(id);
    if (hasPrevious) expect(JSON.parse(storage.values.get('tokens')!).access_token).toBe('old');
    else expect(storage.values.has('tokens')).toBe(false);
  },
);

it('does not restore a logged-out session when refresh completes later', async () => {
  storage.values.set(
    'tokens',
    JSON.stringify({
      access_token: 'old',
      refresh_token: 'old-refresh',
      expires_at: 0,
      baseUrl: 'https://example.test',
    }),
  );
  const pending = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(pending.promise));
  const kino = await import('./kinopub');
  const channels = kino.getChannels();
  await kino.logout();
  pending.resolve(response(tokens));
  await expect(channels).rejects.toThrow('Нет активной сессии');
  expect(storage.values.has('tokens')).toBe(false);
  expect(storage.writes).not.toHaveBeenCalled();
});
