// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MODULES,
  isCompetitionVisible,
  isValidModulesValue,
  isModuleOn,
  LEAGUE_MODULES,
  leagueModuleId,
  MODULES_KEY,
  parseModules,
  readModules,
  setModule,
  useModules,
  writeModules,
} from './modules';

const LEGACY_KEY = 'sportsdesk.view.atmosphere';
const PL = 'l_4WFCIZ';
const UCL = 'l_0bfbkO';
const CUP = 'l_38d9HA';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('modules', () => {
  it('starts with every module and league switch on', () => {
    expect(readModules()).toEqual(DEFAULT_MODULES);
    expect(Object.values(DEFAULT_MODULES).every(Boolean)).toBe(true);
    expect(Object.keys(DEFAULT_MODULES)).toHaveLength(7 + LEAGUE_MODULES.length);
    expect(isModuleOn('watch')).toBe(true);
    expect(isModuleOn(leagueModuleId(PL))).toBe(true);
  });

  it('validates the stored value and ignores unknown ids', () => {
    expect(isValidModulesValue('{broken')).toBe(false);
    expect(isValidModulesValue('[]')).toBe(false);
    expect(parseModules({ version: 1 })).toBeNull();
    expect(parseModules({ version: 1, modules: { watch: 'off' } })).toBeNull();
    expect(parseModules({ version: 1, modules: [] })).toBeNull();

    const parsed = parseModules({
      version: 1,
      modules: { watch: false, futureModule: false, atmosphere: true },
    });
    expect(parsed?.watch).toBe(false);
    expect(parsed?.atmosphere).toBe(true);
    expect(parsed && 'futureModule' in parsed).toBe(false);
    expect(isValidModulesValue(JSON.stringify({ version: 1, modules: {} }))).toBe(true);
  });

  it('falls back to defaults for malformed storage and keeps the legacy sound settings', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, enabled: false, volume: 0.8 }));
    localStorage.setItem(MODULES_KEY, '{broken');
    expect(readModules()).toEqual(DEFAULT_MODULES);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(
      JSON.stringify({ version: 1, enabled: false, volume: 0.8 }),
    );
  });

  it('migrates the old combined switch only when the modules key is absent', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, enabled: false, sounds: true }));
    const migrated = readModules();
    expect(migrated.games).toBe(false);
    expect(migrated.atmosphere).toBe(false);
    expect(migrated.watch).toBe(true);
    expect(migrated.diary).toBe(true);

    localStorage.setItem(
      MODULES_KEY,
      JSON.stringify({ version: 1, modules: { games: true, atmosphere: true } }),
    );
    expect(readModules().games).toBe(true);
    expect(readModules().atmosphere).toBe(true);
  });

  it('hides cups with europe and a league with its own switch', () => {
    expect(isCompetitionVisible(UCL)).toBe(true);
    expect(isCompetitionVisible(CUP)).toBe(true);
    expect(isCompetitionVisible(PL)).toBe(true);

    writeModules({ europe: false });
    expect(isCompetitionVisible(UCL)).toBe(false);
    expect(isCompetitionVisible(CUP)).toBe(false);
    expect(isCompetitionVisible(PL)).toBe(true);

    writeModules({ europe: true, [leagueModuleId(PL)]: false });
    expect(isCompetitionVisible(PL)).toBe(false);
    expect(isCompetitionVisible('l_0ErfuF')).toBe(true);
    expect(isCompetitionVisible('unknown-competition')).toBe(true);
  });

  it('updates a rendered hook after a change in this window and after a storage event', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    function Probe() {
      const modules = useModules();
      return <span>{`${modules.watch}/${modules[leagueModuleId(PL)]}`}</span>;
    }
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Probe />));
    expect(host.textContent).toBe('true/true');

    act(() => {
      writeModules({ watch: false });
    });
    expect(host.textContent).toBe('false/true');

    act(() => {
      setModule(leagueModuleId(PL), false);
    });
    expect(host.textContent).toBe('false/false');

    act(() => {
      localStorage.setItem(
        MODULES_KEY,
        JSON.stringify({ version: 1, modules: { watch: true, [leagueModuleId(PL)]: true } }),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: MODULES_KEY }));
    });
    expect(host.textContent).toBe('true/true');
  });

  it('ignores unknown ids on write', () => {
    const patch = { watch: false, unknown: false } as unknown as Parameters<typeof writeModules>[0];
    writeModules(patch);
    expect(readModules().watch).toBe(false);
    expect(isValidModulesValue(localStorage.getItem(MODULES_KEY) ?? '')).toBe(true);
    expect(localStorage.getItem(MODULES_KEY)).not.toContain('unknown');
  });
});
