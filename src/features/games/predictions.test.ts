// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { LEAGUES } from '../../lib/navigationMetadata';
import {
  EMPTY_PREDICTIONS,
  MAX_PREDICTIONS,
  PREDICTION_LEAGUES,
  PREDICTIONS_KEY,
  SETTLE_AFTER_MS,
  availability,
  isValidPredictionsValue,
  needsCheck,
  observeMatchResult,
  observed,
  parsePredictions,
  reachedExtraTime,
  readPredictions,
  removePrediction,
  resetPredictions,
  savePrediction,
  scoreGuess,
  settle,
  summarize,
  withPrediction,
  withoutPrediction,
  type ObservedMatch,
  type Prediction,
} from './predictions';

const NOW = Date.UTC(2026, 10, 9, 12, 0);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const PL = 'l_4WFCIZ';

const match = (patch: Partial<ObservedMatch> = {}): ObservedMatch => ({
  id: 'm1',
  leagueId: PL,
  status: 'scheduled',
  timeUtc: iso(NOW + 5 * HOUR),
  homeName: 'Arsenal',
  awayName: 'Chelsea',
  scoreHome: null,
  scoreAway: null,
  ...patch,
});

function predicted(guess = { home: 2, away: 1 }, m = match(), at = NOW) {
  const result = withPrediction([], m, guess, at);
  if (!result.ok) throw new Error(`not saved: ${result.reason}`);
  return result.items;
}

const finished = (home: number, away: number, patch: Partial<ObservedMatch> = {}) =>
  match({ status: 'finished', scoreHome: home, scoreAway: away, ...patch });

beforeEach(() => localStorage.clear());

describe('points', () => {
  it('gives 3 for the exact score, 1 for the outcome, 0 otherwise', () => {
    expect(scoreGuess({ home: 2, away: 1 }, { home: 2, away: 1 })).toEqual({
      points: 3,
      kind: 'exact',
    });
    expect(scoreGuess({ home: 2, away: 0 }, { home: 3, away: 1 })).toEqual({
      points: 1,
      kind: 'outcome',
    });
    expect(scoreGuess({ home: 0, away: 3 }, { home: 1, away: 2 })).toEqual({
      points: 1,
      kind: 'outcome',
    });
    expect(scoreGuess({ home: 1, away: 1 }, { home: 0, away: 0 })).toEqual({
      points: 1,
      kind: 'outcome',
    });
    expect(scoreGuess({ home: 1, away: 0 }, { home: 0, away: 1 })).toEqual({
      points: 0,
      kind: 'miss',
    });
    expect(scoreGuess({ home: 1, away: 1 }, { home: 2, away: 1 })).toEqual({
      points: 0,
      kind: 'miss',
    });
  });

  it('keeps a versioned rule table and falls back safely for an unknown version', () => {
    expect(scoreGuess({ home: 1, away: 0 }, { home: 1, away: 0 }, 1).points).toBe(3);
    expect(scoreGuess({ home: 1, away: 0 }, { home: 1, away: 0 }, 99).points).toBe(3);
  });

  it('only offers championships that cannot have extra time', () => {
    const known = new Set<string>(LEAGUES.map((league) => league.id));
    for (const id of PREDICTION_LEAGUES) expect(known.has(id)).toBe(true);
    expect(PREDICTION_LEAGUES).not.toContain('l_0eg6C9'); // MLS: плей-офф с дополнительным временем
    expect(PREDICTION_LEAGUES).toHaveLength(5);
  });
});

describe('availability', () => {
  it('opens only for a supported scheduled match with a future start', () => {
    expect(availability(match(), NOW)).toEqual({ open: true });
  });

  it('closes when the match has started by time or by status', () => {
    expect(availability(match({ timeUtc: iso(NOW) }), NOW)).toEqual({
      open: false,
      reason: 'started',
    });
    expect(availability(match({ timeUtc: iso(NOW - HOUR) }), NOW)).toMatchObject({
      reason: 'started',
    });
    expect(availability(match({ status: 'live' }), NOW)).toMatchObject({ reason: 'started' });
    expect(availability(match({ status: 'HT' }), NOW)).toMatchObject({ reason: 'started' });
  });

  it('does not accept a prediction while the start time is unknown', () => {
    expect(availability(match({ timeUtc: null }), NOW)).toMatchObject({
      reason: 'unknown-kickoff',
    });
    expect(availability(match({ timeUtc: undefined }), NOW)).toMatchObject({
      reason: 'unknown-kickoff',
    });
    expect(availability(match({ timeUtc: '2026-11-09' }), NOW)).toMatchObject({
      reason: 'unknown-kickoff',
    });
    expect(availability(match({ timeUtc: 'soon' }), NOW)).toMatchObject({
      reason: 'unknown-kickoff',
    });
  });

  it('closes finished, cancelled, postponed and unclear matches', () => {
    expect(availability(finished(1, 0), NOW)).toMatchObject({ reason: 'finished' });
    expect(availability(match({ status: 'cancelled' }), NOW)).toMatchObject({
      reason: 'cancelled',
    });
    expect(availability(match({ status: 'postponed' }), NOW)).toMatchObject({
      reason: 'postponed',
    });
    expect(availability(match({ status: 'something odd' }), NOW)).toMatchObject({
      reason: 'unknown-status',
    });
  });

  it('refuses other competitions and unknown ones', () => {
    for (const leagueId of ['l_0eg6C9', 'l_38d9HA', 'l_2WZ2tt', '', undefined])
      expect(availability(match({ leagueId }), NOW)).toEqual({
        open: false,
        reason: 'unsupported',
      });
  });

  it('notices matches that reached extra time or penalties', () => {
    expect(reachedExtraTime('AET')).toBe(true);
    expect(reachedExtraTime('finished', 'After Penalties')).toBe(true);
    expect(reachedExtraTime('afterextratime')).toBe(true);
    expect(reachedExtraTime('finished', 'FT')).toBe(false);
    expect(reachedExtraTime('finished')).toBe(false);
  });
});

describe('saving', () => {
  it('stores one prediction per match and keeps its creation time when edited', () => {
    const first = predicted({ home: 2, away: 1 }, match(), NOW);
    const edited = withPrediction(first, match(), { home: 0, away: 0 }, NOW + HOUR);
    if (!edited.ok) throw new Error('edit failed');
    expect(edited.items).toHaveLength(1);
    expect(edited.items[0]).toMatchObject({
      home: 0,
      away: 0,
      createdAt: iso(NOW),
      updatedAt: iso(NOW + HOUR),
      rules: 1,
      kickoff: iso(NOW + 5 * HOUR),
    });
  });

  it('rejects scores that are not whole numbers from 0 to 20', () => {
    for (const guess of [
      { home: -1, away: 0 },
      { home: 21, away: 0 },
      { home: 1.5, away: 0 },
      { home: Number.NaN, away: 0 },
      { home: 0, away: Number.POSITIVE_INFINITY },
    ])
      expect(withPrediction([], match(), guess, NOW)).toEqual({
        ok: false,
        reason: 'invalid-score',
      });
  });

  it('refuses to save after the match started or when it cannot be predicted', () => {
    const closed = withPrediction([], match({ timeUtc: iso(NOW - 1) }), { home: 1, away: 0 }, NOW);
    expect(closed).toEqual({ ok: false, reason: 'started' });
    expect(withPrediction([], match({ leagueId: 'l_0eg6C9' }), { home: 1, away: 0 }, NOW)).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('follows a rescheduled start', () => {
    const items = predicted();
    const later = observed(items, match({ timeUtc: iso(NOW + 30 * HOUR) }), iso(NOW));
    expect(later[0]?.kickoff).toBe(iso(NOW + 30 * HOUR));
    expect(settle(later[0] as Prediction)).toEqual({ state: 'pending' });
  });
});

describe('results', () => {
  it('scores from the final result of the match, once', () => {
    const items = predicted({ home: 2, away: 1 });
    const done = observed(items, finished(2, 1), iso(NOW + 8 * HOUR));
    const settled = settle(done[0] as Prediction);
    expect(settled).toMatchObject({ state: 'scored', points: 3, kind: 'exact' });
    // Повторное наблюдение того же итога ничего не меняет и очки не удваивает.
    const again = observed(done, finished(2, 1), iso(NOW + 9 * HOUR));
    expect(again).toBe(done);
    expect(summarize(again).points).toBe(3);
  });

  it('recalculates when the result is corrected instead of adding points', () => {
    let items = observed(predicted({ home: 2, away: 1 }), finished(2, 1), iso(NOW + 8 * HOUR));
    expect(summarize(items)).toMatchObject({ points: 3, exact: 1, scored: 1 });
    items = observed(items, finished(2, 2), iso(NOW + 24 * HOUR));
    expect(summarize(items)).toMatchObject({ points: 0, miss: 1, scored: 1, exact: 0 });
    expect(items[0]?.result).toMatchObject({ home: 2, away: 2 });
    items = observed(items, finished(3, 0), iso(NOW + 30 * HOUR));
    expect(summarize(items)).toMatchObject({ points: 1, outcome: 1, scored: 1 });
  });

  it('waits when the finished match has no usable score', () => {
    const items = predicted();
    const noScore = observed(items, finished(0, 0, { scoreHome: null, scoreAway: null }), iso(NOW));
    expect(noScore).toBe(items);
    expect(settle(items[0] as Prediction)).toEqual({ state: 'pending' });
    expect(observed(items, finished(-1, 2), iso(NOW))).toBe(items);
    expect(observed(items, finished(1.5, 2), iso(NOW))).toBe(items);
  });

  it('does not count a cancelled match, and counts it again if it is back on', () => {
    let items = observed(predicted(), match({ status: 'cancelled' }), iso(NOW));
    expect(settle(items[0] as Prediction)).toEqual({ state: 'void', reason: 'cancelled' });
    expect(summarize(items)).toMatchObject({ voided: 1, scored: 0, points: 0 });
    items = observed(items, match({ status: 'scheduled' }), iso(NOW));
    expect(settle(items[0] as Prediction)).toEqual({ state: 'pending' });
  });

  it('does not count a match that went to extra time or penalties', () => {
    const items = observed(predicted(), finished(1, 1, { status: 'AET' }), iso(NOW + 8 * HOUR));
    expect(settle(items[0] as Prediction)).toEqual({ state: 'void', reason: 'extra-time' });
    expect(items[0]?.result).toBeUndefined();
    const penalties = observed(
      predicted(),
      finished(1, 1, { status: 'finished', statusText: 'After penalties' }),
      iso(NOW),
    );
    expect(settle(penalties[0] as Prediction)).toMatchObject({ reason: 'extra-time' });
  });

  it('ignores a prediction that was edited after the start', () => {
    const items = predicted({ home: 1, away: 0 });
    const tampered = items.map((item) => ({
      ...item,
      updatedAt: iso(NOW + 6 * HOUR),
      result: { home: 1, away: 0, seenAt: iso(NOW + 8 * HOUR) },
    }));
    expect(settle(tampered[0] as Prediction)).toEqual({ state: 'void', reason: 'late' });
  });

  it('does not touch matches it has no prediction for', () => {
    const items = predicted();
    expect(observed(items, finished(1, 0, { id: 'other' }), iso(NOW))).toBe(items);
  });

  it('knows which predictions are due for a check', () => {
    const items = predicted();
    const kickoff = NOW + 5 * HOUR;
    expect(needsCheck(items, kickoff + SETTLE_AFTER_MS - 1)).toEqual([]);
    expect(needsCheck(items, kickoff + SETTLE_AFTER_MS)).toHaveLength(1);
    const voided = observed(items, match({ status: 'cancelled' }), iso(NOW));
    expect(needsCheck(voided, kickoff + SETTLE_AFTER_MS)).toEqual([]);
  });
});

describe('summary', () => {
  it('counts only visible scored matches and reports hidden ones separately', () => {
    const base = (id: string, guess: { home: number; away: number }, kickoff: number) => {
      const m = match({ id, timeUtc: iso(kickoff) });
      const saved = withPrediction([], m, guess, kickoff - 2 * HOUR);
      if (!saved.ok) throw new Error('not saved');
      return saved.items[0] as Prediction;
    };
    let items: Prediction[] = [
      base('a', { home: 1, away: 0 }, NOW + 3 * HOUR),
      base('b', { home: 2, away: 2 }, NOW + 4 * HOUR),
      base('c', { home: 0, away: 1 }, NOW + 5 * HOUR),
      base('d', { home: 0, away: 0 }, NOW + 6 * HOUR),
      base('e', { home: 3, away: 0 }, NOW + 7 * HOUR),
    ];
    items = observed(items, finished(1, 0, { id: 'a' }), iso(NOW));
    items = observed(items, finished(1, 1, { id: 'b' }), iso(NOW));
    items = observed(items, finished(2, 0, { id: 'c' }), iso(NOW));
    items = observed(items, match({ id: 'd', status: 'cancelled' }), iso(NOW));
    expect(summarize(items)).toEqual({
      scored: 3,
      points: 3 + 1 + 0,
      exact: 1,
      outcome: 1,
      miss: 1,
      pending: 1,
      voided: 1,
      hidden: 0,
    });
    expect(summarize(items, (id) => id === 'a')).toMatchObject({
      scored: 2,
      points: 1,
      hidden: 1,
    });
  });
});

describe('removing', () => {
  it('lets you remove a prediction only while it can still change', () => {
    const items = predicted();
    expect(withoutPrediction(items, 'm1', NOW)).toEqual([]);
    const kickoff = NOW + 5 * HOUR;
    // Матч идёт, итога нет: убрать нельзя.
    expect(withoutPrediction(items, 'm1', kickoff + HOUR)).toBe(items);
    const scored = observed(items, finished(2, 1), iso(kickoff + 2 * HOUR));
    expect(withoutPrediction(scored, 'm1', kickoff + 3 * HOUR)).toBe(scored);
    const voided = observed(items, match({ status: 'cancelled' }), iso(kickoff));
    expect(withoutPrediction(voided, 'm1', kickoff + 3 * HOUR)).toEqual([]);
    expect(withoutPrediction(items, 'unknown', NOW)).toBe(items);
  });
});

describe('stored value', () => {
  it('rejects values that are not a prediction list', () => {
    expect(parsePredictions(null)).toBeNull();
    expect(parsePredictions([])).toBeNull();
    expect(parsePredictions({ items: [] })).toBeNull();
    expect(parsePredictions({ version: 0, items: [] })).toBeNull();
    expect(isValidPredictionsValue('{broken')).toBe(false);
    expect(isValidPredictionsValue(JSON.stringify(EMPTY_PREDICTIONS))).toBe(true);
  });

  it('drops broken items and keeps the latest of duplicates', () => {
    const good = predicted()[0] as Prediction;
    const newer = { ...good, home: 5, updatedAt: iso(NOW + HOUR) };
    const parsed = parsePredictions({
      version: 1,
      items: [
        good,
        newer,
        { ...good, matchId: 'x', home: 99 },
        { ...good, matchId: 'y', kickoff: 'tomorrow' },
        { ...good, matchId: 'z', rules: 0 },
        { ...good, matchId: 'w', result: { home: -1, away: 0, seenAt: iso(NOW) } },
        'text',
      ],
    });
    expect(parsed?.items.map((item) => [item.matchId, item.home])).toEqual([
      ['m1', 5],
      ['w', 2],
    ]);
    expect(parsed?.items[1]?.result).toBeUndefined();
  });

  it('limits the list, dropping the oldest finished predictions first', () => {
    const items: Prediction[] = [];
    for (let i = 0; i < MAX_PREDICTIONS + 20; i++) {
      const m = match({ id: `m${i}`, timeUtc: iso(NOW + (i + 1) * HOUR) });
      const saved = withPrediction(items, m, { home: 1, away: 0 }, NOW);
      if (!saved.ok) throw new Error('not saved');
      items.splice(0, items.length, ...saved.items);
    }
    expect(items.length).toBeLessThanOrEqual(MAX_PREDICTIONS);
    // Ожидающие матчи не вытесняются рассчитанными.
    expect(items.some((item) => item.matchId === `m${MAX_PREDICTIONS + 19}`)).toBe(true);
  });

  it('saves, reads back, observes results and resets', () => {
    expect(savePrediction(match(), { home: 2, away: 1 }, NOW)).toEqual({ ok: true });
    expect(readPredictions().items).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(PREDICTIONS_KEY) ?? '{}')).toMatchObject({ version: 1 });
    observeMatchResult(finished(2, 1), iso(NOW + 8 * HOUR));
    expect(summarize(readPredictions().items)).toMatchObject({ points: 3 });
    const stored = localStorage.getItem(PREDICTIONS_KEY);
    observeMatchResult(finished(2, 1), iso(NOW + 9 * HOUR));
    expect(localStorage.getItem(PREDICTIONS_KEY)).toBe(stored);
    // Рассчитанный прогноз убрать нельзя, стереть всё можно.
    expect(removePrediction('m1', NOW + 10 * HOUR)).toBe(false);
    resetPredictions();
    expect(readPredictions().items).toEqual([]);
  });

  it('refuses to save a closed match', () => {
    expect(savePrediction(match({ timeUtc: iso(NOW - 1) }), { home: 1, away: 0 }, NOW)).toEqual({
      ok: false,
      reason: 'started',
    });
    expect(localStorage.getItem(PREDICTIONS_KEY)).toBeNull();
  });

  it('survives a broken stored value', () => {
    localStorage.setItem(PREDICTIONS_KEY, '{broken');
    expect(readPredictions()).toEqual(EMPTY_PREDICTIONS);
  });
});
