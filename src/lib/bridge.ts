import type { Source } from './types';
import { ApiError, asApiError, type ApiFailure } from './apiError';
import { registerRetry, requestResource, beginAutomaticRequest } from './resourceHealth';
import { indexSportsPayload } from './searchIndex';

export type { Source };

export interface ApiReply {
  payload: any;
  source: string;
  fetchedAt: string;
  stale: boolean;
  failure?: ApiFailure;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Public helper for feature code that needs the runtime check. */
export function isTauriRuntime(): boolean {
  return isTauri();
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke<T>(command, args);
}

function friendly(message: string): Error {
  return new Error(message);
}

function browserFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

/** Raw transport for data requests. Never used for rpc. */
async function rawApi(source: Source, path: string): Promise<ApiReply> {
  if (isTauri()) {
    try {
      const reply = await invokeTauri<ApiReply>('api_request', { source, path });
      try {
        indexSportsPayload(source, path, reply.payload);
      } catch {
        /* Search cannot block sports data. */
      }
      return reply;
    } catch (err) {
      throw asApiError(err);
    }
  }
  let res: Response;
  try {
    const q = new URLSearchParams({ source, path });
    res = await browserFetch(`/bridge/api?${q.toString()}`);
  } catch {
    throw new ApiError('Upstream', 'Нет связи с локальным мостом разработки.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw body?.error
      ? asApiError(body.error)
      : new ApiError(
          res.status === 401 || res.status === 403
            ? 'Unauthorized'
            : res.status === 404
              ? 'NotFound'
              : res.status === 429
                ? 'RateLimited'
                : 'Upstream',
        );
  if (
    !body ||
    typeof body !== 'object' ||
    !('payload' in body) ||
    typeof body.fetchedAt !== 'string'
  )
    throw new ApiError('BadPayload');
  try {
    indexSportsPayload(source, path, body.payload);
  } catch {
    /* Search cannot block sports data. */
  }
  return body as ApiReply;
}

/**
 * Data request with per-resource health tracking and automatic background retry.
 * rpc() (credentials/Kino/writes) never goes through this path.
 */
export async function api(
  source: Source,
  path: string,
  options: { automatic?: boolean } = {},
): Promise<ApiReply> {
  if (options.automatic) {
    const failure = beginAutomaticRequest(source, path);
    if (failure) throw asApiError(failure);
  }
  const call = () => rawApi(source, path);
  registerRetry(source, path, call);
  return requestResource(source, path, call, options.automatic);
}

export async function rpc<T = any>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (isTauri()) {
    try {
      return await invokeTauri<T>(command, args);
    } catch (err) {
      throw friendly(typeof err === 'string' ? err : 'Локальная операция не удалась.');
    }
  }
  let res: Response;
  try {
    res = await browserFetch('/bridge/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, args }),
    });
  } catch {
    throw friendly('Нет связи с локальным мостом разработки.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      body && typeof body.error === 'string' ? body.error : 'Локальная операция не удалась.';
    throw friendly(msg);
  }
  return body as T;
}

export async function openExternal(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw friendly('Некорректная ссылка.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw friendly('Разрешены только http/https ссылки.');
  }
  if (isTauri()) {
    await invokeTauri<void>('open_external', { url: parsed.toString() });
    return;
  }
  window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
}

export async function notify(title: string, body: string): Promise<void> {
  if (isTauri()) {
    await invokeTauri<void>('send_notification', { title, body });
    return;
  }
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}
