import { readJsonBody, RequestBodyError } from './requestBody';
/**
 * Localhost-only Vite dev bridge implementing the same api/rpc contracts as the
 * Tauri native commands. Rejects non-loopback Host headers, mismatched origins
 * (including port) and cross-origin requests. Upstream responses are bounded,
 * cached in memory with TTLs, and never follow redirects when credentials are
 * attached. OpenF1 reservations are serialized and spaced >=500ms apart with a
 * <=30/min budget, so a page that loads several OpenF1 resources queues them
 * instead of failing.
 */
import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readSecret, readSecretResult, writeSecret, SECRET_FILES } from './secrets';
import { pitchDateCacheTtl } from '../src/lib/pitchDateCache';
import * as kino from './kinopub';
import { HistoryStore, InvalidArgs } from './history';
import { EventStore } from './events';

const historyStore = new HistoryStore();
const eventStore = new EventStore();

const BASES: Record<string, string> = {
  pitch: 'https://api.pitchapi.dev/v1/',
  sportscore: 'https://sportscore.com/api/widget/',
  espn: 'https://site.api.espn.com/apis/site/v2/sports/soccer/',
  jolpica: 'https://api.jolpi.ca/ergast/f1/',
  openf1: 'https://api.openf1.org/v1/',
};

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MAX_BODY = 12 * 1024 * 1024;
const FETCH_TIMEOUT = 15000;
const OPENF1_MIN_INTERVAL_MS = 500;
const OPENF1_PER_MINUTE = 30;
const OPENF1_MAX_WAIT_MS = 90_000;
class DataError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  failure() {
    return {
      code: this.code,
      message: this.message,
      retryable: ['Timeout', 'RateLimited', 'Upstream'].includes(this.code),
    };
  }
}
function dataFailure(error: unknown) {
  return error instanceof DataError
    ? error.failure()
    : { code: 'Upstream', message: 'Данные провайдера временно недоступны.', retryable: true };
}

interface CacheEntry {
  payload: unknown;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();
let inflight = 0,
  openf1Waiting = 0;
const diagnosticErrors: Array<{ at: number; source: string; resource: string; code: string }> = [];

/** Mirrors the Rust poller config for the dev bridge command surface. */
let pollerConfig: { enabled: boolean; favorites: string[] } = { enabled: false, favorites: [] };

interface OpenF1Budget {
  timestamps: number[];
  last: number;
}
const openf1Budget: OpenF1Budget = { timestamps: [], last: 0 };

/**
 * Serializes OpenF1 reservation decisions. Every reservation appends to the
 * tail of this promise chain, so concurrent requests are spaced one after
 * another rather than racing for the same slot and failing.
 */
let openf1Tail: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  });
}

function pruneOpenF1(now: number): void {
  const cutoff = now - 60_000;
  while (openf1Budget.timestamps.length && (openf1Budget.timestamps[0] ?? 0) <= cutoff) {
    openf1Budget.timestamps.shift();
  }
}

/**
 * Computes how long a caller must wait before it may reserve a slot, given the
 * current monotonic-ish clock. Returns null when the minute budget is spent and
 * cannot clear within the allowed wait.
 */
function openF1Delay(now: number): number {
  pruneOpenF1(now);
  let ready = now;
  if (openf1Budget.last && now - openf1Budget.last < OPENF1_MIN_INTERVAL_MS) {
    ready = openf1Budget.last + OPENF1_MIN_INTERVAL_MS;
  }
  if (openf1Budget.timestamps.length >= OPENF1_PER_MINUTE) {
    const oldest = openf1Budget.timestamps[0] ?? now;
    const freedAt = oldest + 60_000;
    if (freedAt > ready) ready = freedAt;
  }
  return Math.max(0, ready - now);
}

/**
 * Reserve an OpenF1 slot, waiting outside the synchronous critical section so
 * the decision tail stays short. Resolves once the requester actually holds a
 * slot, or rejects when the wait would exceed OPENF1_MAX_WAIT_MS.
 */
function reserveOpenF1(): Promise<void> {
  openf1Waiting++;
  const turn = openf1Tail.then(async () => {
    let waited = 0;
    for (;;) {
      const now = Date.now();
      const delay = openF1Delay(now);
      if (delay <= 0) {
        openf1Budget.timestamps.push(now);
        openf1Budget.last = now;
        return;
      }
      if (waited + delay > OPENF1_MAX_WAIT_MS) {
        throw new DataError('RateLimited', 'Провайдер ограничил запросы. Попробуйте позже.');
      }
      waited += delay;
      await sleep(delay);
    }
  });
  // Keep the chain alive even if this request rejects.
  openf1Tail = turn.catch(() => undefined);
  return turn.finally(() => {
    openf1Waiting--;
  });
}

function ttlFor(source: string, path: string, payload: unknown): number {
  const p = path.toLowerCase();
  if (source === 'pitch' && p.startsWith('date/')) return pitchDateCacheTtl(path, payload);
  if (source === 'pitch' && p.startsWith('matches/')) return 60_000;
  if (source === 'openf1') return 24 * 60 * 60 * 1000;
  if (p.includes('standing')) return 15 * 60 * 1000;
  if (source === 'sportscore' && (p.includes('premier-league') || p.includes('spanish-la-liga'))) {
    return 15 * 60 * 1000;
  }
  if (source === 'espn' && (p.includes('scoreboard') || p.includes('matches'))) {
    return 60 * 1000;
  }
  if (source === 'sportscore' && p.includes('match')) return 60 * 1000;
  if (payload && typeof payload === 'object' && 'live' in payload) return 60 * 1000;
  if (
    p.includes('matches') ||
    p.includes('results') ||
    p.includes('schedule') ||
    p.includes('calendar') ||
    p.includes('qualifying')
  ) {
    return 15 * 60 * 1000;
  }
  return 5 * 60 * 1000;
}

function cors(res: ServerResponse): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cache-control', 'no-store');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function hostOf(req: IncomingMessage): string | null {
  const host = (req.headers.host || '').toLowerCase();
  if (!host) return null;
  const hostname = host.replace(/:\d+$/, '');
  return ALLOWED_HOSTS.has(hostname) ? host : null;
}

function isLoopbackHost(req: IncomingMessage): boolean {
  return hostOf(req) !== null;
}

/**
 * Origin must exactly equal the dev server origin (scheme+host+port from Host
 * header). Missing Origin (same-origin simple requests, curl) is allowed.
 */
function isCrossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  const host = hostOf(req);
  if (!host) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
    return url.host.toLowerCase() !== host;
  } catch {
    return true;
  }
}

/**
 * Path security: encoded traversal is rejected on the lowercased path portion
 * BEFORE the query string, so real query values like season=2026%2F2027 (the
 * encoded slash) remain valid. Encoded dots/backslash/percent outside the
 * query are still rejected.
 */
function validPath(source: string, path: string): boolean {
  if (!path || path.length > 2048) return false;
  if (path.startsWith('/') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path)) return false;
  if (path.includes('..') || path.includes('\\') || path.includes('//')) return false;
  const qIndex = path.indexOf('?');
  const pathOnly = (qIndex === -1 ? path : path.slice(0, qIndex)).toLowerCase();
  if (
    pathOnly.includes('%2e') ||
    pathOnly.includes('%2f') ||
    pathOnly.includes('%5c') ||
    pathOnly.includes('%25')
  ) {
    return false;
  }
  // eslint-disable-next-line no-control-regex -- reject all ASCII control bytes in request paths
  if (/[\u0000-\u001f\u007f]/.test(path) || /\s/.test(path)) return false;
  return Boolean(BASES[source]);
}

async function fetchUpstream(
  source: string,
  path: string,
): Promise<{ payload: unknown; fetchedAt: number }> {
  const base = BASES[source];
  if (!base) throw new DataError('UnknownSource', 'Неизвестный источник данных.');
  if (!validPath(source, path)) throw new DataError('InvalidPath', 'Недопустимый путь запроса.');

  const baseUrl = new URL(base);
  const target = new URL(path, baseUrl);
  if (target.origin !== baseUrl.origin || !target.pathname.startsWith(baseUrl.pathname)) {
    throw new DataError('InvalidPath', 'Недопустимый путь запроса.');
  }

  if (source === 'openf1') await reserveOpenF1();

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'SportsDesk/1.0 (+personal desktop app)',
  };
  if (source === 'pitch') {
    const key = readSecretResult(SECRET_FILES.pitch);
    if (key.status === 'missing')
      throw new DataError('MissingKey', 'Ключ PitchAPI не настроен. Добавьте ключ в настройках.');
    if (key.status === 'unsupported')
      throw new DataError('Config', 'Хранилище секретов доступно только в Windows.');
    if (key.status !== 'ok')
      throw new DataError(
        'KeyUnreadable',
        'Сохранённый ключ PitchAPI не удалось прочитать или расшифровать. Введите ключ заново в настройках под текущей учётной записью Windows.',
      );
    headers['x-api-key'] = key.value;
  }

  inflight++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(target, {
      headers,
      signal: controller.signal,
      // Never auto-follow when credentials may be attached.
      redirect: 'error',
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new DataError(
          'Unauthorized',
          'Провайдер отклонил доступ. Проверьте ключ или сессию.',
        );
      }
      if (res.status === 429)
        throw new DataError('RateLimited', 'Провайдер ограничил запросы. Попробуйте позже.');
      if (res.status === 404)
        throw new DataError('NotFound', 'Запрошенные данные не найдены у провайдера.');
      if (res.status === 400 || res.status === 422)
        throw new DataError('InvalidPath', 'Недопустимые параметры запроса.');
      throw new DataError('Upstream', 'Данные провайдера временно недоступны.');
    }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BODY)
      throw new DataError('TooLarge', 'Ответ провайдера слишком большой.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) {
            await reader.cancel();
            throw new DataError('TooLarge', 'Ответ провайдера слишком большой.');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new DataError('BadPayload', 'Провайдер вернул не-JSON ответ.');
    }
    return { payload, fetchedAt: Date.now() };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DataError('Timeout', 'Провайдер не ответил вовремя.');
    }
    throw err;
  } finally {
    inflight--;
    clearTimeout(timer);
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const source = url.searchParams.get('source') || '';
  const path = url.searchParams.get('path') || '';
  if (!source || !path)
    return json(res, 400, {
      error: new DataError('InvalidPath', 'Не указан источник или путь.').failure(),
    });
  if (!BASES[source])
    return json(res, 400, {
      error: new DataError('UnknownSource', 'Неизвестный источник данных.').failure(),
    });
  if (!validPath(source, path))
    return json(res, 400, {
      error: new DataError('InvalidPath', 'Недопустимый путь запроса.').failure(),
    });

  const key = `${source}:${path}`;
  const now = Date.now();
  const entry = cache.get(key);
  if (entry) {
    const ttl = ttlFor(source, path, entry.payload);
    if (now - entry.fetchedAt < ttl) {
      return json(res, 200, {
        payload: entry.payload,
        source,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        stale: false,
      });
    }
  }
  try {
    const fresh = await fetchUpstream(source, path);
    cache.set(key, fresh);
    if (cache.size > 300) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return json(res, 200, {
      payload: fresh.payload,
      source,
      fetchedAt: new Date(fresh.fetchedAt).toISOString(),
      stale: false,
    });
  } catch (err) {
    const failure = dataFailure(err);
    diagnosticErrors.push({
      at: Date.now(),
      source,
      resource: path.split('?')[0] ?? '',
      code: failure.code,
    });
    if (diagnosticErrors.length > 50) diagnosticErrors.shift();
    if (entry) {
      const age = now - entry.fetchedAt;
      if (age < 24 * 60 * 60 * 1000) {
        return json(res, 200, {
          payload: entry.payload,
          source,
          fetchedAt: new Date(entry.fetchedAt).toISOString(),
          stale: true,
          failure,
        });
      }
    }
    return json(res, 502, { error: failure });
  }
}

export async function handleCommand(
  req: IncomingMessage,
  res: ServerResponse,
  stores = { history: historyStore, events: eventStore },
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const command = typeof body.command === 'string' ? body.command : '';
    const rawArgs = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<
      string,
      unknown
    >;
    switch (command) {
      case 'history_upsert':
      case 'history_seasons':
      case 'history_season_matches':
      case 'history_head_to_head':
      case 'history_team_matches':
        return json(res, 200, stores.history.dispatch(command, rawArgs));
      case 'event_center_list':
      case 'event_center_mark_read':
        return json(res, 200, stores.events.dispatch(command, rawArgs));
      case 'secret_status': {
        const pitch = readSecret(SECRET_FILES.pitch) !== null;
        const kinoTokens = kino.hasTokens();
        return json(res, 200, { pitch, kino: kinoTokens, kinoClient: kino.hasClientConfig() });
      }
      case 'set_kino_client':
        try {
          return json(res, 200, kino.saveClientConfig(rawArgs));
        } catch (error) {
          return json(res, 400, {
            error:
              error instanceof Error ? error.message : 'Не удалось сохранить настройки KinoPub.',
          });
        }
      case 'set_pitch_key': {
        const key = typeof rawArgs.key === 'string' ? rawArgs.key.trim() : '';
        if (!key) return json(res, 400, { error: 'Ключ не может быть пустым.' });
        if (key.length > 512) return json(res, 400, { error: 'Ключ слишком длинный.' });
        writeSecret(SECRET_FILES.pitch, key);
        return json(res, 200, { ok: true });
      }
      case 'kino_begin_auth':
        return json(res, 200, kino.beginAuth());
      case 'kino_start_auth':
        return json(res, 200, await kino.startAuth(String(rawArgs.sessionId || '')));
      case 'kino_poll_auth': {
        return json(res, 200, await kino.pollAuth(String(rawArgs.sessionId || '')));
      }
      case 'kino_commit_auth':
        return json(res, 200, kino.commitAuth(String(rawArgs.sessionId || '')));
      case 'kino_cancel_auth':
        return json(res, 200, kino.cancelAuth(String(rawArgs.sessionId || '')));
      case 'kino_finish_auth':
        return json(res, 200, kino.finishAuth(String(rawArgs.sessionId || '')));
      case 'kino_channels':
        return json(res, 200, await kino.getChannels());
      case 'kino_logout':
        return json(res, 200, await kino.logout());
      case 'open_external': {
        const url = typeof rawArgs.url === 'string' ? rawArgs.url : '';
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return json(res, 400, { error: 'Некорректная ссылка.' });
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return json(res, 400, { error: 'Разрешены только http/https.' });
        }
        return json(res, 200, { ok: true });
      }
      case 'send_notification':
        return json(res, 200, { ok: true });
      case 'set_poller_config':
      case 'get_poller_config':
        // Dev bridge: no native poller; report the pushed config back.
        if (command === 'get_poller_config') {
          return json(res, 200, pollerConfig);
        }
        if (rawArgs.config && typeof rawArgs.config === 'object') {
          const cfg = rawArgs.config as { enabled?: unknown; favorites?: unknown };
          pollerConfig = {
            enabled: cfg.enabled === true,
            favorites: Array.isArray(cfg.favorites)
              ? cfg.favorites.filter((x): x is string => typeof x === 'string')
              : [],
          };
        }
        return json(res, 200, { ok: true });
      case 'set_tray_mode':
      case 'show_window':
        return json(res, 200, { ok: true });
      default:
        return json(res, 400, { error: 'Неизвестная команда.' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Команда не выполнена.';
    return json(
      res,
      err instanceof RequestBodyError ? err.status : err instanceof InvalidArgs ? 400 : 500,
      { error: msg },
    );
  }
}

export function devBridgePlugin(): Plugin {
  return {
    name: 'sportsdesk-dev-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/bridge/api', (async (req: IncomingMessage, res: ServerResponse) => {
        if (!isLoopbackHost(req) || isCrossOrigin(req)) {
          return json(res, 403, { error: 'Мост доступен только локально.' });
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Метод не поддерживается.' });
        await handleApi(req, res, new URL(req.url || '/', `http://${req.headers.host}`));
      }) as Connect.NextHandleFunction);

      server.middlewares.use('/bridge/command', (async (
        req: IncomingMessage,
        res: ServerResponse,
      ) => {
        if (!isLoopbackHost(req) || isCrossOrigin(req)) {
          return json(res, 403, { error: 'Мост доступен только локально.' });
        }
        if (req.method !== 'POST') return json(res, 405, { error: 'Метод не поддерживается.' });
        await handleCommand(req, res);
      }) as Connect.NextHandleFunction);

      server.middlewares.use('/bridge/diag', (async (req: IncomingMessage, res: ServerResponse) => {
        if (!isLoopbackHost(req) || isCrossOrigin(req)) {
          return json(res, 403, { error: 'Доступ запрещён.' });
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Метод не поддерживается.' });
        const summaries = new Map<
          string,
          { source: string; entries: number; latestAt: number; oldestAt: number }
        >();
        for (const [key, value] of cache) {
          const source = key.split(':')[0]!;
          const previous = summaries.get(source);
          summaries.set(source, {
            source,
            entries: (previous?.entries ?? 0) + 1,
            latestAt: Math.max(previous?.latestAt ?? 0, value.fetchedAt),
            oldestAt: Math.min(previous?.oldestAt ?? Infinity, value.fetchedAt),
          });
        }
        pruneOpenF1(Date.now());
        return json(res, 200, {
          runtime: 'Браузер / локальный мост',
          network: {
            inflight,
            openf1Waiting,
            openf1Recent: openf1Budget.timestamps.length,
            openf1NextMs: openF1Delay(Date.now()),
          },
          cache: [...summaries.values()],
          errors: diagnosticErrors,
        });
      }) as Connect.NextHandleFunction);
    },
  };
}
