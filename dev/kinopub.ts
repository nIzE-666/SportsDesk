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

function loadConfig(): KinoClientConfig {
  if (cachedConfig) return cachedConfig;
  const cfg = readJsonSecret<KinoClientConfig>(SECRET_FILES.kinoClient);
  if (!cfg || !cfg.baseUrl || !cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      'Конфигурация клиента KinoPub не найдена. Обратитесь к администратору установки.',
    );
  }
  const base = cfg.baseUrl.replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('Некорректный адрес клиента KinoPub.');
  cachedConfig = { ...cfg, baseUrl: base };
  return cachedConfig;
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

function saveTokens(
  payload: { access_token: string; refresh_token: string; expires_in?: number },
  baseUrl: string,
): KinoTokens {
  const expiresAt = Date.now() + Math.max(60, (payload.expires_in || 86400) - 60) * 1000;
  const out: KinoTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt,
    baseUrl,
  };
  writeSecret(
    SECRET_FILES.kinoTokens,
    JSON.stringify({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_in: payload.expires_in,
      expires_at: expiresAt,
      baseUrl,
    }),
  );
  // Only cache in memory after DPAPI write succeeded.
  cachedTokens = out;
  return out;
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
  refreshInFlight = (async () => {
    const res = await formPost(cfg, '/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: tokens.refreshToken,
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error('Не удалось обновить сессию KinoPub. Войдите заново.');
    const access = typeof data.access_token === 'string' ? data.access_token : '';
    const refreshTok = typeof data.refresh_token === 'string' ? data.refresh_token : '';
    if (!access || !refreshTok) {
      throw new Error('Не удалось обновить сессию KinoPub. Войдите заново.');
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;
    return saveTokens(
      { access_token: access, refresh_token: refreshTok, expires_in: expiresIn },
      cfg.baseUrl,
    );
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

export async function startAuth(): Promise<{
  code: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  const cfg = loadConfig();
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
  return { code, userCode, verificationUri, expiresIn, interval };
}

export async function pollAuth(
  code: string,
): Promise<{ pending: boolean; authenticated: boolean }> {
  if (!code) throw new Error('Код авторизации не указан. Запросите новый.');
  const cfg = loadConfig();
  const res = await formPost(cfg, '/oauth2/device', {
    grant_type: 'device_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
  });
  const data = await readJson(res);
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
  saveTokens(
    { access_token: access, refresh_token: refreshTok, expires_in: expiresIn },
    cfg.baseUrl,
  );
  return { pending: false, authenticated: true };
}

export function hasTokens(): boolean {
  return loadTokens() !== null;
}

export async function logout(): Promise<{ ok: boolean }> {
  cachedTokens = null;
  deleteSecret(SECRET_FILES.kinoTokens);
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
