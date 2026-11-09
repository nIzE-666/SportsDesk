// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  ATMOSPHERE_KEY,
  DEFAULT_ATMOSPHERE,
  celebrationsAllowed,
  isValidAtmosphereValue,
  motionReduced,
  parseAtmosphere,
  readAtmosphere,
  soundsAllowed,
  writeAtmosphere,
} from './atmosphereStore';
import {
  CELEBRATE_PREVIEW_EVENT,
  FRESH_WINDOW_MS,
  MAX_CELEBRATED,
  pickCelebrations,
  readCelebrated,
  rememberCelebrated,
} from './celebrationRules';
import { GoalCelebration } from './GoalCelebration';
import { getSpoilerSnapshot, hideResult } from '../spoilers/spoilerStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

it('defaults keep sounds off and survive broken values', () => {
  expect(readAtmosphere()).toEqual(DEFAULT_ATMOSPHERE);
  expect(DEFAULT_ATMOSPHERE.sounds).toBe(false);
  expect(DEFAULT_ATMOSPHERE.ambient).toBe(false);
  localStorage.setItem(ATMOSPHERE_KEY, '{broken');
  expect(readAtmosphere()).toEqual(DEFAULT_ATMOSPHERE);
  expect(isValidAtmosphereValue('{broken')).toBe(false);
  expect(isValidAtmosphereValue('[]')).toBe(false);
  expect(isValidAtmosphereValue(JSON.stringify(DEFAULT_ATMOSPHERE))).toBe(true);
});

it('parse clamps volume and ignores unknown motion', () => {
  const parsed = parseAtmosphere({ version: 1, volume: 7, motion: 'wild', sounds: true });
  expect(parsed?.volume).toBe(1);
  expect(parsed?.motion).toBe('system');
  expect(parsed?.sounds).toBe(true);
  expect(parseAtmosphere({ volume: 1 })).toBeNull();
});

it('master switch and motion settings control effects', () => {
  expect(celebrationsAllowed()).toBe(true);
  expect(soundsAllowed()).toBe(false);
  writeAtmosphere({ sounds: true });
  expect(soundsAllowed()).toBe(true);
  writeAtmosphere({ enabled: false });
  expect(celebrationsAllowed()).toBe(false);
  expect(soundsAllowed()).toBe(false);
  writeAtmosphere({ enabled: true, motion: 'reduced' });
  expect(motionReduced()).toBe(true);
  writeAtmosphere({ motion: 'full' });
  expect(motionReduced()).toBe(false);
});

it('celebrates only fresh confirmed goals that were not shown and are not hidden', () => {
  const now = 1_000_000_000;
  const base = { sport: 'football' as const, kind: 'goal', occurredAt: now - 1000 };
  const events = [
    { ...base, id: 'football|goal|m1|e1', matchId: 'm1' },
    { ...base, id: 'football|score|m1|1|0', matchId: 'm1' },
    { ...base, id: 'football|goal|m1|e2', matchId: 'm1' },
    { ...base, id: 'football|goal|m1|e3', matchId: 'm1', occurredAt: now - FRESH_WINDOW_MS - 1 },
    { ...base, id: 'football|goal|m1|e4', matchId: 'm1', occurredAt: now - 50_000 },
    { ...base, id: 'football|goal|m2|e5', matchId: 'm2' },
    { ...base, id: 'f1|goal|x', sport: 'f1' as const },
  ];
  hideResult({ kind: 'football', id: 'm2' });
  const picked = pickCelebrations(events, {
    seen: new Set(['football|goal|m1|e2']),
    hidden: getSpoilerSnapshot(),
    now,
    since: now - 10_000,
  });
  expect(picked.map((e) => e.id)).toEqual(['football|goal|m1|e1']);
});

it('remembers shown goals without duplicates and with a cap', () => {
  rememberCelebrated(['a', 'a', 'b']);
  expect(readCelebrated()).toEqual(['a', 'b']);
  rememberCelebrated(Array.from({ length: MAX_CELEBRATED + 20 }, (_, i) => `id-${i}`));
  const stored = readCelebrated();
  expect(stored).toHaveLength(MAX_CELEBRATED);
  expect(stored.at(-1)).toBe(`id-${MAX_CELEBRATED + 19}`);
});

it('preview shows a calm card without particles in reduced motion', () => {
  writeAtmosphere({ motion: 'reduced' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<GoalCelebration />));
  expect(host.textContent).toBe('');
  act(() => {
    window.dispatchEvent(new Event(CELEBRATE_PREVIEW_EVENT));
  });
  expect(host.textContent).toContain('Гол!');
  expect(host.querySelector('canvas')).toBeNull();
  expect(host.querySelector('.goal-celebration-card.static')).not.toBeNull();
});
