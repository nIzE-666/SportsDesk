// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_START_LIGHTS,
  GOAL_MS,
  HOLD_MAX_MS,
  HOLD_MIN_MS,
  MAX_HISTORY,
  START_LIGHTS_KEY,
  applyOutcome,
  averageOfLast,
  classifyPress,
  holdDelay,
  isValidStartLightsValue,
  parseStartLights,
  readStartLights,
  recordStartLights,
  resetStartLights,
  type StartLightsStats,
} from './startLights';

const AT = '2026-11-09T12:00:00.000Z';

beforeEach(() => localStorage.clear());

describe('classifyPress', () => {
  it('measures the time from the frame in which the lights went out', () => {
    expect(classifyPress(1230, 1000)).toEqual({ kind: 'time', ms: 230 });
    expect(classifyPress(1231.6, 1000)).toEqual({ kind: 'time', ms: 232 });
  });

  it('counts a press before the lights-out frame was shown as a guess', () => {
    expect(classifyPress(1100, null)).toEqual({ kind: 'false-start', reason: 'anticipation' });
  });

  it('counts a press faster than a human can answer as a guess, with the limit inclusive', () => {
    expect(classifyPress(1099, 1000)).toEqual({ kind: 'false-start', reason: 'anticipation' });
    expect(classifyPress(990, 1000)).toEqual({ kind: 'false-start', reason: 'anticipation' });
    expect(classifyPress(1100, 1000)).toEqual({ kind: 'time', ms: 100 });
  });

  it('ends a late press without a time', () => {
    expect(classifyPress(3000, 1000)).toEqual({ kind: 'time', ms: 2000 });
    expect(classifyPress(3001, 1000)).toEqual({ kind: 'too-slow' });
  });
});

describe('holdDelay', () => {
  it('spreads the delay over the allowed range and survives odd input', () => {
    expect(holdDelay(0)).toBe(HOLD_MIN_MS);
    expect(holdDelay(0.5)).toBe((HOLD_MIN_MS + HOLD_MAX_MS) / 2);
    expect(holdDelay(0.999999)).toBeLessThanOrEqual(HOLD_MAX_MS);
    expect(holdDelay(1)).toBeLessThanOrEqual(HOLD_MAX_MS);
    expect(holdDelay(-3)).toBe(HOLD_MIN_MS);
    expect(holdDelay(Number.NaN)).toBe(HOLD_MIN_MS);
  });
});

describe('statistics', () => {
  const stats = (patch: Partial<StartLightsStats> = {}): StartLightsStats => ({
    ...EMPTY_START_LIGHTS,
    ...patch,
  });

  it('records times, the personal best and false starts', () => {
    let result = applyOutcome(stats(), { kind: 'time', ms: 300 }, AT);
    expect(result.personalBest).toBe(true);
    expect(result.stats).toMatchObject({ rounds: 1, best: { ms: 300 }, history: [{ ms: 300 }] });
    result = applyOutcome(result.stats, { kind: 'time', ms: 340 }, AT);
    expect(result.personalBest).toBe(false);
    expect(result.stats.best?.ms).toBe(300);
    result = applyOutcome(result.stats, { kind: 'time', ms: 250 }, AT);
    expect(result.personalBest).toBe(true);
    expect(result.stats.best?.ms).toBe(250);
    result = applyOutcome(result.stats, { kind: 'false-start', reason: 'early' }, AT);
    expect(result.stats).toMatchObject({ rounds: 4, falseStarts: 1 });
    expect(result.stats.history).toHaveLength(3);
    result = applyOutcome(result.stats, { kind: 'too-slow' }, AT);
    expect(result.stats).toMatchObject({ rounds: 5, falseStarts: 1 });
    expect(result.stats.history).toHaveLength(3);
  });

  it('does not count an interrupted attempt at all', () => {
    const before = stats({ rounds: 2 });
    const result = applyOutcome(before, { kind: 'interrupted' }, AT);
    expect(result.stats).toBe(before);
    expect(result.personalBest).toBe(false);
  });

  it('keeps only the latest attempts but remembers a record that fell off the list', () => {
    let current = stats();
    current = applyOutcome(current, { kind: 'time', ms: 200 }, AT).stats;
    for (let i = 0; i < MAX_HISTORY + 5; i++)
      current = applyOutcome(current, { kind: 'time', ms: 400 + i }, AT).stats;
    expect(current.history).toHaveLength(MAX_HISTORY);
    expect(current.history[0]?.ms).toBeGreaterThan(200);
    expect(current.best?.ms).toBe(200);
    expect(parseStartLights(JSON.parse(JSON.stringify(current)))?.best?.ms).toBe(200);
  });

  it('averages the last five times', () => {
    expect(averageOfLast([])).toBeNull();
    const history = [100, 200, 300, 400, 500, 600].map((ms) => ({ ms, at: AT }));
    expect(averageOfLast(history)).toBe(400);
    expect(averageOfLast(history, 2)).toBe(550);
  });
});

describe('stored value', () => {
  it('rejects values that are not game statistics', () => {
    expect(parseStartLights(null)).toBeNull();
    expect(parseStartLights([])).toBeNull();
    expect(parseStartLights({ rounds: 1 })).toBeNull();
    expect(parseStartLights({ version: 0 })).toBeNull();
    expect(isValidStartLightsValue('{broken')).toBe(false);
    expect(isValidStartLightsValue('[]')).toBe(false);
    expect(isValidStartLightsValue(JSON.stringify(EMPTY_START_LIGHTS))).toBe(true);
  });

  it('drops impossible attempts and repairs counters', () => {
    const parsed = parseStartLights({
      version: 1,
      rounds: -4,
      falseStarts: 'many',
      best: { ms: 5, at: AT },
      history: [
        { ms: 250, at: AT },
        { ms: 99, at: AT },
        { ms: 5000, at: AT },
        { ms: 300, at: 'yesterday' },
        'x',
        { ms: 312.4, at: AT },
      ],
    });
    expect(parsed).toMatchObject({ rounds: 0, falseStarts: 0, best: { ms: 250 } });
    expect(parsed?.history.map((attempt) => attempt.ms)).toEqual([250, 312]);
  });

  it('survives a broken stored value', () => {
    localStorage.setItem(START_LIGHTS_KEY, '{broken');
    expect(readStartLights()).toEqual(EMPTY_START_LIGHTS);
  });

  it('is saved, read back and reset', () => {
    const first = recordStartLights({ kind: 'time', ms: 280 }, AT);
    expect(first.personalBest).toBe(true);
    expect(readStartLights().best?.ms).toBe(280);
    expect(JSON.parse(localStorage.getItem(START_LIGHTS_KEY) ?? '{}')).toMatchObject({
      version: 1,
      rounds: 1,
    });
    // Прерванная попытка ничего не пишет.
    const before = localStorage.getItem(START_LIGHTS_KEY);
    recordStartLights({ kind: 'interrupted' }, AT);
    expect(localStorage.getItem(START_LIGHTS_KEY)).toBe(before);
    resetStartLights();
    expect(readStartLights()).toEqual(EMPTY_START_LIGHTS);
  });

  it('has a fixed, positive game goal that is not tied to anyone', () => {
    expect(GOAL_MS).toBeGreaterThan(100);
  });
});
