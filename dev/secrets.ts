/**
 * Node-side helper to read/write DPAPI-protected secret files in the same
 * PowerShell ConvertFrom-SecureString hex format the native layer uses. Used
 * only by the localhost dev bridge. PowerShell always runs hidden with a fixed
 * -Command string; the secret material is fed via stdin, never argv. The
 * plaintext is never logged.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function appDataDir(): string {
  const local =
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local');
  return path.join(local, 'SportsDesk');
}

export function secretsDir(): string {
  return path.join(appDataDir(), 'secrets');
}

export function secretPath(name: string): string {
  return path.join(secretsDir(), `${name}.dpapi`);
}

/** Decrypt a DPAPI hex payload fed via stdin. Output forced to UTF-8. */
const DECRYPT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$in = [Console]::In.ReadToEnd().Trim()',
  'if (-not $in) { exit 2 }',
  '$secure = ConvertTo-SecureString -String $in -ErrorAction Stop',
  '$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
  'try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr); [Console]::Out.Write($plain) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }',
].join('; ');

/** Encrypt a plaintext payload fed via stdin. */
const ENCRYPT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$plain = [Console]::In.ReadToEnd()',
  'if ($null -eq $plain -or $plain.Length -eq 0) { exit 2 }',
  '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force -ErrorAction Stop',
  '[Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure))',
].join('; ');

const BOM = '\uFEFF';
const HEX_RE = /^[0-9a-fA-F]+$/;
// Only the dev helper retains plaintext. Ciphertext identity detects external
// rotation; writes/deletes invalidate it immediately. Never expose this map.
const decrypted = new Map<string, { cipher: string; value: string | null }>();

function powershell(): string {
  if (process.env.SystemRoot) {
    return path.join(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
  }
  return 'powershell.exe';
}

/** Run a fixed PowerShell program with stdin payload; hidden window. */
function runPsi(program: string, input: string): string {
  const out = execFileSync(
    powershell(),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "$env:PSModulePath = Join-Path $PSHOME 'Modules'; " + program,
    ],
    {
      input,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 256,
      timeout: 15000,
      env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' },
    },
  );
  return out;
}

function stripBom(s: string): string {
  return s.startsWith(BOM) ? s.slice(BOM.length) : s;
}

export type SecretReadResult =
  { status: 'ok'; value: string } | { status: 'missing' | 'unreadable' | 'unsupported' };

/** Distinguish absent files from damaged/inaccessible secrets without exposing details. */
export function readSecretResult(name: string): SecretReadResult {
  if (process.platform !== 'win32') return { status: 'unsupported' };
  const p = secretPath(name);
  try {
    const raw = stripBom(readFileSync(p, 'utf8')).trim();
    const hex = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    if (!hex || hex.length > 65_536 || hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
      decrypted.delete(p);
      return { status: 'unreadable' };
    }
    const hit = decrypted.get(p);
    if (hit?.cipher === hex)
      return hit.value ? { status: 'ok', value: hit.value } : { status: 'unreadable' };
    try {
      const plain = runPsi(DECRYPT_SCRIPT, hex);
      const cleaned = stripBom(plain).trimEnd();
      const value = cleaned.length ? cleaned : null;
      decrypted.set(p, { cipher: hex, value });
      return value ? { status: 'ok', value } : { status: 'unreadable' };
    } catch {
      decrypted.set(p, { cipher: hex, value: null });
      return { status: 'unreadable' };
    }
  } catch (error) {
    decrypted.delete(p);
    return {
      status:
        error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
          ? 'missing'
          : 'unreadable',
    };
  }
}

/** Compatibility helper for callers that treat any unavailable secret as signed out. */
export function readSecret(name: string): string | null {
  const result = readSecretResult(name);
  return result.status === 'ok' ? result.value : null;
}

export function readJsonSecret<T>(name: string): T | null {
  const plain = readSecret(name);
  if (!plain) return null;
  try {
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

export function writeSecret(name: string, value: string): void {
  if (process.platform !== 'win32') {
    throw new Error('Хранилище секретов доступно только в Windows.');
  }
  const raw = runPsi(ENCRYPT_SCRIPT, value);
  const hex = stripBom(raw).trim();
  if (!hex || hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    throw new Error('Не удалось зашифровать секрет.');
  }
  mkdirSync(secretsDir(), { recursive: true });
  writeFileSync(secretPath(name), hex, { encoding: 'utf8' });
  decrypted.delete(secretPath(name));
}

export function deleteSecret(name: string): void {
  decrypted.delete(secretPath(name));
  try {
    rmSync(secretPath(name), { force: true });
  } catch {
    /* ignore */
  }
}

/** Names used by SportsDesk. */
export const SECRET_FILES = {
  pitch: 'pitchapi',
  kinoClient: 'kinoclient',
  kinoTokens: 'kino',
} as const;

/** Kino client config comes from kinoclient.dpapi (JSON). Never hardcoded. */
export interface KinoClientConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}
