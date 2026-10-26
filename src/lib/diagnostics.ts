import { isTauriRuntime, rpc } from './bridge';
export interface UiError {
  at: string;
  section: string;
  message: string;
  stack: string;
}
const errors: UiError[] = [];
/** Reports must remain safe even when a provider or video URL contains credentials. */
export function sanitizeDetails(value: string) {
  return value
    .replace(/\b(?:pk_(?:live|test)_[A-Za-z0-9_-]+|Bearer\s+[^\s"'<>]+)/gi, '[скрыто]')
    .replace(/https?:\/\/[^\s)"'<>]+/gi, (url) => {
      try {
        const u = new URL(url);
        return u.origin + u.pathname;
      } catch {
        return '[URL]';
      }
    })
    .replace(
      /(["']?(?:[a-z_-]*token|api[_-]?key|x-api-key|secret|password|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[скрыто]',
    );
}
export function recordUiError(section: string, error: unknown, stack = '') {
  const entry = {
    at: new Date().toISOString(),
    section: sanitizeDetails(section),
    message: sanitizeDetails(error instanceof Error ? error.message : String(error)),
    stack: sanitizeDetails(stack),
  };
  errors.push(entry);
  if (errors.length > 30) errors.shift();
  console.error('[SportsDesk]', entry);
  return entry;
}
export function getUiErrors() {
  return [...errors];
}
export async function readDiagnostics() {
  if (isTauriRuntime()) return rpc<BackendDiagnostics>('read_diagnostics');
  const res = await fetch('/bridge/diag');
  if (!res.ok) throw new Error('Диагностика моста недоступна.');
  return res.json() as Promise<BackendDiagnostics>;
}
export interface BackendDiagnostics {
  runtime?: string;
  network?: { inflight: number; openf1Waiting: number; openf1Recent: number; openf1NextMs: number };
  cache?: Array<{ source: string; entries: number; latestAt: number; oldestAt: number }>;
  errors?: Array<{ at: number; source: string; resource: string; code: string }>;
}
