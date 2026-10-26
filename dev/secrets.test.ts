import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ files: new Map<string, string>(), exec: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: fake.exec }));
vi.mock('node:fs', () => ({
  existsSync: (p: string) => fake.files.has(p),
  mkdirSync: vi.fn(),
  readFileSync: (p: string) => {
    if (!fake.files.has(p)) throw new Error('missing');
    return fake.files.get(p);
  },
  writeFileSync: (p: string, value: string) => {
    fake.files.set(p, value);
  },
  rmSync: (p: string) => {
    fake.files.delete(p);
  },
}));
beforeEach(() => {
  fake.files.clear();
  fake.exec.mockReset();
  vi.resetModules();
  vi.stubEnv('LOCALAPPDATA', 'C:/SportsDesk-unit-test');
});
afterEach(() => vi.unstubAllEnvs());
const windowsTest = it.skipIf(process.platform !== 'win32');
windowsTest(
  'decrypts once per ciphertext and detects rotation outside the application',
  async () => {
    const secrets = await import('./secrets');
    const path = secrets.secretPath('pitchapi');
    fake.files.set(path, 'aa00');
    fake.exec.mockReturnValueOnce('unit-old').mockReturnValueOnce('unit-new');
    expect(secrets.readSecret('pitchapi')).toBe('unit-old');
    expect(secrets.readSecret('pitchapi')).toBe('unit-old');
    expect(fake.exec).toHaveBeenCalledOnce();
    fake.files.set(path, 'bb00');
    expect(secrets.readSecret('pitchapi')).toBe('unit-new');
    expect(fake.exec).toHaveBeenCalledTimes(2);
  },
);
windowsTest(
  'invalidates plaintext immediately after a successful set_pitch_key write',
  async () => {
    const secrets = await import('./secrets');
    const path = secrets.secretPath('pitchapi');
    fake.files.set(path, 'aa00');
    fake.exec
      .mockReturnValueOnce('unit-old')
      .mockReturnValueOnce('bb00')
      .mockReturnValueOnce('unit-new');
    expect(secrets.readSecret('pitchapi')).toBe('unit-old');
    secrets.writeSecret('pitchapi', 'unit-new');
    expect(secrets.readSecret('pitchapi')).toBe('unit-new');
    expect(fake.exec).toHaveBeenCalledTimes(3);
    expect(fake.exec.mock.calls.every((call) => !(call[1] as string[]).includes('unit-new'))).toBe(
      true,
    );
  },
);
windowsTest(
  'does not repeatedly invoke PowerShell for unreadable unchanged ciphertext and forgets deleted secrets',
  async () => {
    const secrets = await import('./secrets');
    const path = secrets.secretPath('pitchapi');
    fake.files.set(path, 'aa00');
    fake.exec.mockImplementationOnce(() => {
      throw new Error('decrypt unavailable');
    });
    expect(secrets.readSecret('pitchapi')).toBeNull();
    expect(secrets.readSecret('pitchapi')).toBeNull();
    expect(fake.exec).toHaveBeenCalledOnce();
    fake.files.set(path, 'bb00');
    fake.exec.mockReturnValue('unit-value');
    expect(secrets.readSecret('pitchapi')).toBe('unit-value');
    secrets.deleteSecret('pitchapi');
    expect(secrets.readSecret('pitchapi')).toBeNull();
    fake.files.set(path, 'bb00');
    expect(secrets.readSecret('pitchapi')).toBe('unit-value');
    expect(fake.exec).toHaveBeenCalledTimes(3);
  },
);
