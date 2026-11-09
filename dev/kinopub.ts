/**
 * KinoPub device-code login + stream URL retrieval, shared by the dev bridge.
 * Based on the KinoWatch project (MIT) protocol routes; only protocol logic
 * reused, credentials come from the user's own local encrypted config.
 * Tokens stay in DPAPI storage and are never returned to the browser.
 */
import type { KinoClientConfig } from './secrets';
import { readJsonSecret, writeSecret, deleteSecret, SECRET_FILES, secretPath } from './secrets';

export interface KinoChannel {
  id: number;
  title: string;
  logo?: string;
  url?: string;
}

interface KinoTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  baseUrl: string;
}

const REQUEST_TIMEOUT_MS = 20_000;
const NETWORK_ERROR = 'Сервис KinoPub недоступен. Проверьте подключение и повторите попытку.';

let cachedTokens: KinoTokens | null = null;
let cachedConfig: KinoClientConfig | null = null;
let refreshInFlight: Promise<KinoTokens> | null = null;
let credentialRevision = 0;
let nextAttempt = 0;
let activeAttempt: string | null = null;
const attempts = new Map<
  string,
  {
    code?: string;
    expiresAt?: number;
    candidate?: KinoTokens;
    committed?: { revision: number; previous: KinoTokens | null };
  }
>();

function active(id: string) {
  const attempt = attempts.get(id);
  if (!attempt || activeAttempt !== id || (attempt.expiresAt && Date.now() >= attempt.expiresAt)) {
    throw new Error('Код авторизации истёк. Запросите новый.');
  }
  return attempt;
}

function loadConfig(): KinoClientConfig {
  if (cachedConfig) return cachedConfig;
  const cfg = readJsonSecret<KinoClientConfig>(SECRET_FILES.kinoClient);
  if (!cfg || !cfg.baseUrl || !cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      'Настройки клиента KinoPub не заданы. Откройте «Настройки → Kino» и заполните их.',
    );
  }
  const base = cfg.baseUrl.replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('Некорректный адрес клиента KinoPub.');
  cachedConfig = { ...cfg, baseUrl: base };
  return cachedConfig;
}

const MAX_CLIENT_FIELD_LEN = 512;
const INVALID_CONFIG =
  'Проверьте настройки KinoPub: адрес должен начинаться с https://, Client ID и Client secret не могут быть пустыми.';

/** Validates user-entered client settings; mirrors kino.rs normalize_client_config. */
export function normalizeClientConfig(input: {
  baseUrl?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
}): KinoClientConfig {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const baseUrl = text(input.baseUrl).replace(/\/+$/, '');
  const clientId = text(input.clientId);
  const clientSecret = text(input.clientSecret);
  const hostOk = /^https:\/\/\S+$/.test(baseUrl);
  const tooLong = [baseUrl, clientId, clientSecret].some((v) => v.length > MAX_CLIENT_FIELD_LEN);
  if (!hostOk || !clientId || !clientSecret || tooLong) throw new Error(INVALID_CONFIG);
  return { baseUrl, clientId, clientSecret };
}

export function hasClientConfig(): boolean {
  try {
    loadConfig();
    return true;
  } catch {
    return false;
  }
}

/** Encrypts the client settings with DPAPI. Values are never echoed back. */
export function saveClientConfig(input: Record<string, unknown>): { ok: true } {
  const cfg = normalizeClientConfig(input);
  writeSecret(SECRET_FILES.kinoClient, JSON.stringify(cfg));
  cachedConfig = null;
  return { ok: true };
}

function loadTokens(): KinoTokens | null {
  if (cachedTokens) return cachedTokens;
  const raw = readJsonSecret<{
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    baseUrl?: string;
  }>(SECRET_FILES.kinoTokens);
  if (!raw || !raw.access_token || !raw.refresh_token) return null;
  cachedTokens = {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: typeof raw.expires_at === 'number' ? raw.expires_at : 0,
    baseUrl: raw.baseUrl || '',
  };
  return cachedTokens;
}

function makeTokens(
  payload: { access_token: string; refresh_token: string; expires_in?: number },
  baseUrl: string,
): KinoTokens {
  const expiresAt = Date.now() + Math.max(60, (payload.expires_in || 86400) - 60) * 1000;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt,
    baseUrl,
  };
}

function replaceTokens(tokens: KinoTokens | null): void {
  if (!tokens) {
    deleteSecret(SECRET_FILES.kinoTokens);
    cachedTokens = null;
    return;
  }
  writeSecret(
    SECRET_FILES.kinoTokens,
    JSON.stringify({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      baseUrl: tokens.baseUrl,
    }),
  );
  // Only cache in memory after DPAPI write succeeded.
  cachedTokens = tokens;
}

function isSafeStreamUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
  } catch (err) {
    // Never surface raw network errors (may include full URL/host details).
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Истекло время ожидания ответа KinoPub. Повторите попытку.');
    }
    throw new Error(NETWORK_ERROR);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function formPost(
  cfg: KinoClientConfig,
  path: string,
  body: Record<string, string>,
): Promise<Response> {
  return timedFetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
  });
}

async function refresh(cfg: KinoClientConfig, tokens: KinoTokens): Promise<KinoTokens> {
  if (refreshInFlight) return refreshInFlight;
  const current = loadTokens();
  if (!current) throw new Error('Нет активной сессии KinoPub. Войдите по коду.');
  if (current.refreshToken !== tokens.refreshToken && Date.now() < current.expiresAt)
    return current;
  const revision = credentialRevision;
  refreshInFlight = (async () => {
    const res = await formPost(cfg, '/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: current.refreshToken,
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error('Не удалось обновить сессию KinoPub. Войдите заново.');
    const access = typeof data.access_token === 'string' ? data.access_token : '';
    const refreshTok = typeof data.refresh_token === 'string' ? data.refresh_token : '';
    if (!access || !refreshTok) {
      throw new Error('Не удалось обновить сессию KinoPub. Войдите заново.');
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;
    if (revision !== credentialRevision) {
      const latest = loadTokens();
      if (!latest) throw new Error('Нет активной сессии KinoPub. Войдите по коду.');
      return latest;
    }
    const saved = makeTokens(
      { access_token: access, refresh_token: refreshTok, expires_in: expiresIn },
      cfg.baseUrl,
    );
    replaceTokens(saved);
    credentialRevision += 1;
    for (const attempt of attempts.values()) {
      if (attempt.committed?.revision === revision) attempt.committed.revision = credentialRevision;
    }
    return saved;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function activeTokens(cfg: KinoClientConfig): Promise<KinoTokens> {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Нет активной сессии KinoPub. Войдите по коду.');
  if (Date.now() < tokens.expiresAt || !tokens.refreshToken) return tokens;
  return refresh(cfg, tokens);
}

export function beginAuth(): { sessionId: string } {
  const sessionId = String(++nextAttempt);
  for (const [id, attempt] of attempts) if (!attempt.committed) attempts.delete(id);
  attempts.set(sessionId, {});
  activeAttempt = sessionId;
  return { sessionId };
}

export function cancelAuth(id: string): { ok: boolean } {
  const committed = attempts.get(id)?.committed;
  if (committed?.revision === credentialRevision) {
    replaceTokens(committed.previous);
    credentialRevision += 1;
  }
  attempts.delete(id);
  if (activeAttempt === id) activeAttempt = null;
  return { ok: true };
}

export function finishAuth(id: string): { ok: boolean } {
  attempts.delete(id);
  if (activeAttempt === id) activeAttempt = null;
  return { ok: true };
}

export function commitAuth(id: string): { ok: boolean } {
  const attempt = active(id);
  if (!attempt.candidate || attempt.committed)
    throw new Error('Ошибка опроса авторизации KinoPub.');
  const previous = loadTokens();
  replaceTokens(attempt.candidate);
  // Preserve rollback information even if the first rollback attempt fails.
  credentialRevision += 1;
  attempt.committed = { revision: credentialRevision, previous };
  if (attempt.expiresAt && Date.now() >= attempt.expiresAt) {
    cancelAuth(id);
    throw new Error('Код авторизации истёк. Запросите новый.');
  }
  return { ok: true };
}

export async function startAuth(sessionId: string): Promise<{
  code: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  active(sessionId);
  const cfg = loadConfig();
  const requestedAt = Date.now();
  const res = await formPost(cfg, '/oauth2/device', {
    grant_type: 'device_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  if (!res.ok) throw new Error('Не удалось запустить авторизацию KinoPub.');
  const data = await readJson(res);
  const code = typeof data.code === 'string' ? data.code : '';
  const userCode = typeof data.user_code === 'string' ? data.user_code : '';
  if (!code || !userCode) {
    throw new Error('Неожиданный ответ авторизации KinoPub.');
  }
  const verificationUri =
    typeof data.verification_uri === 'string' && isSafeStreamUrl(data.verification_uri)
      ? data.verification_uri
      : 'https://kino.pub/device';
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 600;
  const interval = typeof data.interval === 'number' ? data.interval : 5;
  const attempt = active(sessionId);
  attempt.code = code;
  attempt.expiresAt =
    requestedAt +
    Math.min(Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 600, 86400) * 1000;
  if (Date.now() >= attempt.expiresAt) throw new Error('Код авторизации истёк. Запросите новый.');
  const remaining = Math.ceil((attempt.expiresAt - Date.now()) / 1000);
  return { code, userCode, verificationUri, expiresIn: remaining, interval };
}

export async function pollAuth(
  sessionId: string,
): Promise<{ pending: boolean; authenticated: boolean }> {
  const code = active(sessionId).code;
  if (!code) throw new Error('Код авторизации не указан. Запросите новый.');
  const cfg = loadConfig();
  const res = await formPost(cfg, '/oauth2/device', {
    grant_type: 'device_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
  });
  const data = await readJson(res);
  const attempt = active(sessionId);
  if (res.status === 400 || res.status === 401) {
    const err = typeof data.error === 'string' ? data.error : '';
    if (err === 'access_denied') throw new Error('Доступ отклонён пользователем.');
    if (err === 'expired_token') throw new Error('Код авторизации истёк. Запросите новый.');
    if (err === 'authorization_pending' || err === 'slow_down') {
      return { pending: true, authenticated: false };
    }
    throw new Error('Не удалось подтвердить авторизацию KinoPub. Запросите новый код.');
  }
  if (!res.ok) throw new Error('Ошибка опроса авторизации KinoPub.');
  const access = typeof data.access_token === 'string' ? data.access_token : '';
  const refreshTok = typeof data.refresh_token === 'string' ? data.refresh_token : '';
  if (!access || !refreshTok) {
    throw new Error('Неожиданный ответ авторизации KinoPub. Запросите новый код.');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;
  attempt.candidate = makeTokens(
    { access_token: access, refresh_token: refreshTok, expires_in: expiresIn },
    cfg.baseUrl,
  );
  return { pending: false, authenticated: true };
}

export function hasTokens(): boolean {
  return loadTokens() !== null;
}

export async function logout(): Promise<{ ok: boolean }> {
  activeAttempt = null;
  attempts.clear();
  credentialRevision += 1;
  deleteSecret(SECRET_FILES.kinoTokens);
  cachedTokens = null;
  return { ok: true };
}

interface RawChannel {
  id?: number;
  title?: string;
  name?: string;
  stream?: string;
  url?: string;
  logo?: string;
  logos?: { s?: string; m?: string };
}

function mapChannel(raw: RawChannel): KinoChannel | null {
  if (typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || raw.id <= 0) return null;
  const title = raw.title || raw.name || `Канал ${raw.id}`;
  const logoRaw = raw.logos?.m || raw.logos?.s || raw.logo;
  const urlRaw = raw.stream || raw.url;
  const logo = logoRaw && isSafeStreamUrl(logoRaw) ? logoRaw : undefined;
  const url = urlRaw && isSafeStreamUrl(urlRaw) ? urlRaw : undefined;
  return {
    id: raw.id,
    title,
    ...(logo ? { logo } : {}),
    ...(url ? { url } : {}),
  };
}

export async function getChannels(): Promise<KinoChannel[]> {
  const cfg = loadConfig();
  let tokens = await activeTokens(cfg);
  const doFetch = async (): Promise<Response> =>
    timedFetch(`${cfg.baseUrl}/v1/tv`, {
      method: 'GET',
      headers: { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/json' },
    });
  let res = await doFetch();
  if (res.status === 401) {
    tokens = await refresh(cfg, tokens);
    res = await doFetch();
  }
  if (!res.ok) throw new Error('Не удалось получить список каналов KinoPub.');
  const body = await readJson(res);
  const items = Array.isArray(body.items) ? (body.items as RawChannel[]) : [];
  const channels = Array.isArray(body.channels) ? (body.channels as RawChannel[]) : [];
  const list = items.length ? items : channels;
  return list.map(mapChannel).filter((c): c is KinoChannel => c !== null);
}

// Re-exported for callers that may want to know the on-disk path without
// exposing token material.
export function tokenFilePath(): string {
  return secretPath(SECRET_FILES.kinoTokens);
}
