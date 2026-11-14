// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rpc } from '../../lib/bridge';
import { saveFavDrivers } from '../f1/prefs';
import { setString } from '../football/storage';
import { writeFavorites, writeRecent } from '../watch/watchShared';
import { diaryFixture } from '../../test/fixtures/diary';
import { schemeFromLineups } from '../tactics/tacticsModel';
import { tacticLineups, tacticMatch } from '../../test/fixtures/tactics';
import {
  applyProfile,
  profileEntries,
  recoverInterruptedRestore,
  replaceProfile,
  restoreFullBackup,
  useProfileMirror,
  withProfileMirrorPaused,
} from './profileBackup';

vi.mock('../../lib/bridge', () => ({ isTauriRuntime: () => true, rpc: vi.fn() }));
const eventState = vi.hoisted(() => ({
  callback: undefined as undefined | ((event: { payload: number }) => void),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, callback: (event: { payload: number }) => void) => {
    eventState.callback = callback;
    return () => {
      eventState.callback = undefined;
    };
  },
}));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(rpc).mockReset();
  eventState.callback = undefined;
});
afterEach(() => vi.restoreAllMocks());

it('round-trips the module switches and rejects a damaged value', () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  const modules = JSON.stringify({
    version: 1,
    modules: { watch: false, atmosphere: false, 'league.l_4WFCIZ': false },
  });
  replaceProfile({ 'sportsdesk.scheme': 'dark', 'sportsdesk.modules': modules });
  expect(localStorage.getItem('sportsdesk.modules')).toBe(modules);
  expect(profileEntries()).toContainEqual(['sportsdesk.modules', modules]);

  expect(() =>
    replaceProfile({
      'sportsdesk.modules': '{"version":1,"modules":{"watch":1}}',
    }),
  ).toThrow('модулей');
  expect(localStorage.getItem('sportsdesk.modules')).toBe(modules);
});

it('restores a 1.7.0 profile with the old sport and sidebar keys', () => {
  const scheme = {
    ...schemeFromLineups(tacticMatch, tacticLineups, 'old-scheme'),
    title: 'Старая схема',
    updatedAt: '2026-11-09T00:00:00Z',
  };
  const prediction = {
    matchId: 'old-match',
    leagueId: 'l_4WFCIZ',
    home: 2,
    away: 1,
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    kickoff: '2099-01-01T12:00:00Z',
    createdAt: '2026-11-09T00:00:00Z',
    updatedAt: '2026-11-09T00:00:00Z',
    rules: 1,
  };
  const settings = {
    'sportsdesk.sport': 'ucl',
    'sportsdesk.league': 'l_4WFCIZ',
    'sportsdesk.cup.current': 'l_38d9HA',
    'sportsdesk.sidebar.collapsed': '1',
    'sportsdesk.sidebar.competitionsOpen': '0',
    'sportsdesk.sidebar.teamsOpen': '0',
    'sportsdesk.football.favorites.teams': JSON.stringify({ ids: ['arsenal'] }),
    'sportsdesk.view.navigation.football': JSON.stringify({
      kind: 'football',
      section: 'dashboard',
    }),
    'sportsdesk.view.navigation2.football': JSON.stringify({ kind: 'ucl', tab: 'bracket' }),
    'sportsdesk.view.diary': JSON.stringify(diaryFixture),
    'sportsdesk.view.games.predictions': JSON.stringify({ version: 1, items: [prediction] }),
    'sportsdesk.football.tactics': JSON.stringify({ version: 1, schemes: [scheme] }),
  };

  expect(() => replaceProfile(settings)).not.toThrow();
  for (const [key, value] of Object.entries(settings))
    expect(localStorage.getItem(key)).toBe(value);
  expect(
    profileEntries()
      .map(([key]) => key)
      .sort(),
  ).toEqual(Object.keys(settings).sort());
});

it('validates all keys before changing the existing profile', () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  expect(() =>
    replaceProfile({ 'sportsdesk.scheme': 'light', 'sportsdesk.api_key': 'secret' }),
  ).toThrow();
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
  expect(localStorage.getItem('sportsdesk.api_key')).toBeNull();
});

it('rejects an invalid timezone before applying a profile or committing restored history', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  localStorage.setItem('sportsdesk.timezone', 'UTC');
  const settings = { 'sportsdesk.scheme': 'light', 'sportsdesk.timezone': 'Not/A_Zone' };
  await expect(applyProfile(settings)).rejects.toThrow('неверный часовой пояс');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
  expect(localStorage.getItem('sportsdesk.timezone')).toBe('UTC');
  expect(rpc).not.toHaveBeenCalled();

  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'prepare_backup_restore')
      return { id: 55, profile: { settings }, safetyFile: 'safe.json' };
  });
  await expect(restoreFullBackup('bad.json')).rejects.toThrow('неверный часовой пояс');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
  expect(localStorage.getItem('sportsdesk.timezone')).toBe('UTC');
  expect(rpc).toHaveBeenCalledWith('cancel_backup_restore', { id: 55 });
  expect(rpc).not.toHaveBeenCalledWith('commit_backup_restore', expect.anything());
});

it('rolls back all profile keys after a quota failure and keeps unrelated keys', () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  localStorage.setItem('sportsdesk.f1.favorite', 'old');
  localStorage.setItem('unrelated', 'keep');
  const original = Storage.prototype.setItem;
  let failed = false;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'sportsdesk.f1.favorite' && value === 'new' && !failed) {
      failed = true;
      throw new DOMException('quota', 'QuotaExceededError');
    }
    original.call(this, key, value);
  });
  expect(() =>
    replaceProfile({ 'sportsdesk.scheme': 'light', 'sportsdesk.f1.favorite': 'new' }),
  ).toThrow('Прежние настройки восстановлены');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
  expect(localStorage.getItem('sportsdesk.f1.favorite')).toBe('old');
  expect(localStorage.getItem('unrelated')).toBe('keep');
});

it('reports a failed rollback instead of claiming the old profile was restored', () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  expect(() => replaceProfile({ 'sportsdesk.scheme': 'light' })).toThrow(
    'Не удалось применить профиль и вернуть прежние настройки',
  );
});

it('rolls back a standalone profile import when its mirror cannot be saved', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  vi.mocked(rpc).mockRejectedValue(new Error('mirror unavailable'));
  await expect(applyProfile({ 'sportsdesk.scheme': 'light' })).rejects.toThrow(
    'mirror unavailable',
  );
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
});

it('reverts the profile and cancels the prepared restore when history commit fails', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'prepare_backup_restore')
      return {
        id: 42,
        profile: { settings: { 'sportsdesk.scheme': 'light' } },
        safetyFile: 'safe.json',
      };
    if (name === 'commit_backup_restore') throw new Error('history failed');
  });
  await expect(restoreFullBackup('old.json')).rejects.toThrow('history failed');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
  expect(vi.mocked(rpc)).toHaveBeenCalledWith('cancel_backup_restore', { id: 42 });
});

it('reports profile rollback and cancellation failures together with the safety copy', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (value === 'dark') throw new Error('rollback unavailable');
    original.call(this, key, value);
  });
  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'prepare_backup_restore')
      return {
        id: 42,
        profile: { settings: { 'sportsdesk.scheme': 'light' } },
        safetyFile: 'safe.json',
      };
    if (name === 'commit_backup_restore') throw new Error('history failed');
    if (name === 'cancel_backup_restore') throw new Error('cancel failed');
  });
  await expect(restoreFullBackup('old.json')).rejects.toThrow(
    /history failed.*rollback unavailable.*cancel failed.*safe\.json/,
  );
});

it('aborts before changing anything when the profile changes while its safety copy is prepared', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  let finish!: (value: unknown) => void;
  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'prepare_backup_restore')
      return new Promise((resolve) => {
        finish = resolve;
      });
  });
  const restoring = restoreFullBackup('old.json');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  setString('sportsdesk.scheme', 'changed-during-prepare');
  finish({
    id: 42,
    profile: { settings: { 'sportsdesk.scheme': 'light' } },
    safetyFile: 'safe.json',
  });
  await expect(restoring).rejects.toThrow('Настройки изменились');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('changed-during-prepare');
  expect(vi.mocked(rpc)).toHaveBeenCalledWith('cancel_backup_restore', { id: 42 });
  expect(vi.mocked(rpc)).not.toHaveBeenCalledWith('commit_backup_restore', expect.anything());
});

it('preserves edits during a failed history commit, including a write matching the temporary profile', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  localStorage.setItem('sportsdesk.timezone', 'UTC');
  let fail!: (error: Error) => void;
  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'prepare_backup_restore')
      return {
        id: 42,
        profile: {
          settings: { 'sportsdesk.scheme': 'light', 'sportsdesk.timezone': 'Europe/London' },
        },
        safetyFile: 'safe.json',
      };
    if (name === 'commit_backup_restore')
      return new Promise((_resolve, reject) => {
        fail = reject;
      });
  });
  const restoring = restoreFullBackup('old.json');
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
  setString('sportsdesk.scheme', 'light'); // no-op in storage, but still a user intent
  setString('sportsdesk.watch.view', 'list');
  fail(new Error('history changed'));
  await expect(restoring).rejects.toThrow('history changed');
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('light');
  expect(localStorage.getItem('sportsdesk.timezone')).toBe('UTC');
  expect(localStorage.getItem('sportsdesk.watch.view')).toBe('list');
});

it('reports a failed concurrent-write replay after commit without rolling back only the profile', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  let finish!: () => void;
  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'prepare_backup_restore')
      return {
        id: 42,
        profile: { settings: { 'sportsdesk.scheme': 'light' } },
        safetyFile: 'safe.json',
      };
    if (name === 'commit_backup_restore')
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (value === 'later') throw new Error('quota while retaining edit');
    original.call(this, key, value);
  });
  const restoring = restoreFullBackup('old.json');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'sportsdesk.scheme', oldValue: 'light', newValue: 'later' }),
  );
  finish();
  await expect(restoring).rejects.toThrow(
    /История восстановлена.*quota while retaining edit.*safe\.json/,
  );
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('light');
  expect(vi.mocked(rpc)).not.toHaveBeenCalledWith('cancel_backup_restore', expect.anything());
});

it('answers the automatic backup request with the live profile before the debounce expires', async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(rpc).mockResolvedValue(undefined);
  const host = document.createElement('div');
  const root = createRoot(host);
  function Probe() {
    useProfileMirror();
    return null;
  }
  try {
    localStorage.setItem('sportsdesk.scheme', 'dark');
    await act(async () => {
      root.render(<Probe />);
      await vi.dynamicImportSettled();
    });
    expect(eventState.callback).toBeTypeOf('function');
    setString('sportsdesk.scheme', 'light');
    await act(async () => {
      eventState.callback!({ payload: 91 });
      await Promise.resolve();
    });
    expect(vi.mocked(rpc)).toHaveBeenCalledWith('provide_backup_profile', {
      id: 91,
      settings: [['sportsdesk.scheme', 'light']],
    });
    expect(vi.mocked(rpc).mock.calls.filter(([name]) => name === 'sync_profile')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});

it('mirrors F1 and Kino writes while excluding secrets', async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(rpc).mockResolvedValue(undefined);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Probe() {
    useProfileMirror();
    return null;
  }
  try {
    localStorage.setItem('sportsdesk.scheme', 'dark');
    localStorage.setItem('sportsdesk.f1.api_token', 'secret');
    await act(async () => root.render(<Probe />));
    saveFavDrivers(['driver']);
    writeFavorites(new Set([7]));
    writeRecent([7, 8]);
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    const writes = vi.mocked(rpc).mock.calls;
    expect(
      Object.fromEntries(writes[writes.length - 1]![1]!.settings as [string, string][]),
    ).toEqual({
      'sportsdesk.scheme': 'dark',
      'sportsdesk.f1.favDrivers': '["driver"]',
      'sportsdesk.watch.favorites': '[7]',
      'sportsdesk.watch.recent': '[7,8]',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});

it('drains an in-flight mirror write and sends the latest profile after the pause', async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let finishFirst!: () => void;
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  // No interrupted restore; the first mirror write then stays in flight.
  vi.mocked(rpc).mockResolvedValueOnce(null);
  vi.mocked(rpc).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishFirst = resolve;
      }),
  );
  vi.mocked(rpc).mockResolvedValue(undefined);
  function Probe() {
    useProfileMirror();
    return null;
  }
  try {
    localStorage.setItem('sportsdesk.scheme', 'dark');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Probe />));
    let actionStarted = false;
    const paused = withProfileMirrorPaused(async () => {
      actionStarted = true;
      localStorage.setItem('sportsdesk.scheme', 'light');
    });
    await Promise.resolve();
    expect(actionStarted).toBe(false);
    finishFirst();
    await act(async () => {
      await paused;
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(actionStarted).toBe(true);
    expect(vi.mocked(rpc).mock.calls).toEqual([
      ['backup_recovery'],
      ['sync_profile', { settings: [['sportsdesk.scheme', 'dark']] }],
      ['sync_profile', { settings: [['sportsdesk.scheme', 'light']] }],
    ]);
  } finally {
    if (root) await act(async () => root!.unmount());
    host?.remove();
    vi.useRealTimers();
  }
});

it('applies the profile of a crash-interrupted restore before closing the journal', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  const order: string[] = [];
  vi.mocked(rpc).mockImplementation(async (name) => {
    order.push(`${String(name)}:${localStorage.getItem('sportsdesk.scheme')}`);
    if (name === 'backup_recovery')
      return { id: 7, profile: { settings: { 'sportsdesk.scheme': 'light' } }, completed: true };
  });
  await expect(recoverInterruptedRestore()).resolves.toBe(true);
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('light');
  expect(rpc).toHaveBeenCalledWith('finish_backup_restore', { id: 7 });
  expect(order).toEqual(['backup_recovery:dark', 'finish_backup_restore:light']);
});

it('keeps the journal open when the recovered profile cannot be applied', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'backup_recovery')
      return { id: 8, profile: { settings: { 'sportsdesk.api_key': 'x' } }, completed: true };
  });
  await expect(recoverInterruptedRestore()).rejects.toThrow();
  expect(localStorage.getItem('sportsdesk.scheme')).toBe('dark');
  expect(rpc).not.toHaveBeenCalledWith('finish_backup_restore', expect.anything());
});

it('closes the journal after a successful restore', async () => {
  localStorage.setItem('sportsdesk.scheme', 'dark');
  vi.mocked(rpc).mockImplementation(async (name) => {
    if (name === 'prepare_backup_restore')
      return { id: 9, profile: { settings: { 'sportsdesk.scheme': 'light' } }, safetyFile: 's' };
  });
  await restoreFullBackup('copy.json');
  const names = vi.mocked(rpc).mock.calls.map(([name]) => name);
  expect(names).toEqual([
    'prepare_backup_restore',
    'commit_backup_restore',
    'finish_backup_restore',
  ]);
});
