// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeModules } from '../../lib/modules';
import { AmbientToggle } from './AmbientToggle';
import {
  getAmbientState,
  resetAmbientForTests,
  setAmbientSportHint,
  startAmbient,
  stopAmbient,
  toggleAmbient,
} from './ambientEngine';
import { AMBIENT_DUCK, AMBIENT_LEVEL, decideAmbient, resolveAmbientKind } from './ambientPolicy';
import { createAmbientVoice, createNoiseBuffer } from './ambientSynth';
import { resetAudioContextForTests } from './audioContext';
import { DEFAULT_ATMOSPHERE, writeAtmosphere } from './atmosphereStore';
import { FakeAudioContext, installFakeAudio, removeFakeAudio, theFakeContext } from './fakeAudio';
import {
  getPlaybackContext,
  reportVideoAudible,
  resetPlaybackContextForTests,
} from './playbackContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Первый созданный gain — общая шина фона. */
function busGain(): number {
  const bus = theFakeContext().gains[0];
  if (!bus) throw new Error('bus was not created');
  return bus.gain.value;
}

function allowAmbient(patch: Parameters<typeof writeAtmosphere>[0] = {}) {
  writeAtmosphere({ ambient: true, ...patch });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  installFakeAudio();
  resetAudioContextForTests();
  resetPlaybackContextForTests();
  resetAmbientForTests();
});

afterEach(() => {
  resetAmbientForTests();
  resetPlaybackContextForTests();
  setHidden(false);
  removeFakeAudio();
  vi.useRealTimers();
});

describe('ambient policy', () => {
  const allowed = { ...DEFAULT_ATMOSPHERE, ambient: true };
  const quiet = { videoAudible: false, windowHidden: false };

  it('plays at the chosen volume and ducks for video only when asked to', () => {
    expect(decideAmbient(allowed, quiet)).toEqual({ play: true, gain: 0.4, lowered: false });
    const lower = { ...allowed, ambientVideo: 'lower' as const };
    const decision = decideAmbient(lower, { ...quiet, videoAudible: true });
    expect(decision).toMatchObject({ play: true, lowered: true });
    expect(decision.play && decision.gain).toBeCloseTo(0.4 * AMBIENT_DUCK);
    expect(decideAmbient(allowed, { ...quiet, videoAudible: true })).toEqual({
      play: false,
      reason: 'video',
    });
  });

  it('stays silent when disabled, muted or when the window is hidden by policy', () => {
    expect(decideAmbient(DEFAULT_ATMOSPHERE, quiet)).toEqual({ play: false, reason: 'disabled' });
    expect(decideAmbient({ ...allowed, ambient: false }, quiet)).toMatchObject({ play: false });
    expect(decideAmbient({ ...allowed, ambientVolume: 0 }, quiet)).toMatchObject({ play: false });
    const hidden = { ...quiet, windowHidden: true };
    expect(decideAmbient(allowed, hidden)).toEqual({ play: false, reason: 'hidden' });
    expect(decideAmbient({ ...allowed, ambientHidden: 'keep' }, hidden)).toMatchObject({
      play: true,
    });
  });

  it('picks the engine for Formula 1 and the stadium for everything else', () => {
    expect(resolveAmbientKind('auto', 'f1')).toBe('engine');
    expect(resolveAmbientKind('auto', 'football')).toBe('stadium');
    expect(resolveAmbientKind('auto', 'cup')).toBe('stadium');
    expect(resolveAmbientKind('auto', null)).toBe('stadium');
    expect(resolveAmbientKind('stadium', 'f1')).toBe('stadium');
    expect(resolveAmbientKind('engine', 'football')).toBe('engine');
  });
});

describe('ambient synth', () => {
  it('builds both sounds, starts looping sources and releases everything on dispose', () => {
    for (const kind of ['stadium', 'engine'] as const) {
      const fake = new FakeAudioContext();
      const voice = createAmbientVoice(fake as unknown as AudioContext, kind);
      expect(fake.liveSources()).toBeGreaterThan(2);
      expect(fake.sources.some((source) => source.loop)).toBe(true);
      expect(voice.output).toBe(fake.gains[0]);
      expect(fake.gains[0]?.gain.value).toBe(0);
      voice.dispose();
      expect(fake.liveSources()).toBe(0);
      expect(() => voice.dispose()).not.toThrow();
      // Запланированные «волны» и «проезды» не должны срабатывать после остановки.
      expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
      expect(fake.liveSources()).toBe(0);
    }
  });

  it('makes loopable noise without a jump at the seam', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const ctx = new FakeAudioContext() as unknown as AudioContext;
    for (const color of ['white', 'pink', 'brown'] as const) {
      const data = createNoiseBuffer(ctx, color, random).getChannelData(0);
      expect(data.every((value) => Number.isFinite(value) && Math.abs(value) <= 1)).toBe(true);
    }
    const brown = createNoiseBuffer(ctx, 'brown', random).getChannelData(0);
    const first = brown[0] ?? 0;
    const last = brown[brown.length - 1] ?? 0;
    expect(Math.abs(first - last)).toBeLessThan(0.25);
  });
});

describe('ambient engine', () => {
  it('makes no sound and creates no audio until the user starts it', () => {
    allowAmbient();
    setAmbientSportHint('football');
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(getAmbientState().kind).toBeNull();
  });

  it('refuses to start while ambient sound is off in the settings', () => {
    expect(startAmbient()).toBe(false);
    expect(getAmbientState()).toMatchObject({ kind: null, stoppedBy: 'disabled' });
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('reports a missing audio engine instead of failing', () => {
    allowAmbient();
    removeFakeAudio();
    resetAudioContextForTests();
    expect(startAmbient()).toBe(false);
    expect(getAmbientState().stoppedBy).toBe('unsupported');
  });

  it('keeps a single instance however many times it is started', () => {
    allowAmbient();
    expect(startAmbient()).toBe(true);
    const ctx = theFakeContext();
    const once = ctx.liveSources();
    expect(once).toBeGreaterThan(0);
    startAmbient();
    startAmbient();
    toggleAmbient();
    expect(getAmbientState().kind).toBeNull();
    startAmbient();
    vi.advanceTimersByTime(3000);
    expect(ctx.liveSources()).toBe(once);
    expect(getAmbientState().kind).toBe('stadium');
  });

  it('fades out softly and then frees the voice', () => {
    allowAmbient();
    startAmbient();
    const ctx = theFakeContext();
    const playing = ctx.liveSources();
    stopAmbient();
    expect(getAmbientState()).toEqual({ kind: null, lowered: false, stoppedBy: null });
    expect(ctx.liveSources()).toBe(playing);
    vi.advanceTimersByTime(2000);
    expect(ctx.liveSources()).toBe(0);
  });

  it('crossfades to the engine when the sport changes in automatic mode', () => {
    allowAmbient();
    setAmbientSportHint('football');
    startAmbient();
    const ctx = theFakeContext();
    const stadium = [...ctx.sources];
    expect(getAmbientState().kind).toBe('stadium');
    setAmbientSportHint('f1');
    expect(getAmbientState().kind).toBe('engine');
    const engine = ctx.sources.slice(stadium.length);
    expect(engine.length).toBeGreaterThan(0);
    // Во время переключения старый голос ещё затихает, новый уже звучит.
    expect(stadium.some((source) => !source.stopped)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(stadium.every((source) => source.stopped)).toBe(true);
    expect(engine.every((source) => source.started && !source.stopped)).toBe(true);
  });

  it('lets an explicit sound choice override the sport', () => {
    allowAmbient({ ambientKind: 'engine' });
    setAmbientSportHint('football');
    startAmbient();
    expect(getAmbientState().kind).toBe('engine');
    writeAtmosphere({ ambientKind: 'stadium' });
    expect(getAmbientState().kind).toBe('stadium');
  });

  it('follows the volume setting while playing', () => {
    allowAmbient();
    startAmbient();
    expect(busGain()).toBeCloseTo(0.4 * AMBIENT_LEVEL);
    writeAtmosphere({ ambientVolume: 0.8 });
    expect(busGain()).toBeCloseTo(0.8 * AMBIENT_LEVEL);
  });

  it('stops when the atmosphere module is disabled', () => {
    allowAmbient();
    startAmbient();
    writeModules({ atmosphere: false });
    expect(getAmbientState()).toMatchObject({ kind: null, stoppedBy: 'disabled' });
    vi.advanceTimersByTime(2000);
    expect(theFakeContext().liveSources()).toBe(0);
  });

  describe('with a video playing', () => {
    it('lowers the background and restores it afterwards when ducking is chosen', () => {
      allowAmbient({ ambientVideo: 'lower' });
      startAmbient();
      reportVideoAudible('player', true);
      expect(getAmbientState()).toMatchObject({ kind: 'stadium', lowered: true });
      expect(busGain()).toBeCloseTo(0.4 * AMBIENT_DUCK * AMBIENT_LEVEL);
      reportVideoAudible('player', false);
      expect(getAmbientState()).toMatchObject({ kind: 'stadium', lowered: false });
      expect(busGain()).toBeCloseTo(0.4 * AMBIENT_LEVEL);
    });

    it('stops the background and does not bring it back on its own', () => {
      allowAmbient({ ambientVideo: 'stop' });
      startAmbient();
      reportVideoAudible('player', true);
      expect(getAmbientState()).toMatchObject({ kind: null, stoppedBy: 'video' });
      reportVideoAudible('player', false);
      vi.advanceTimersByTime(5000);
      expect(getAmbientState().kind).toBeNull();
      expect(theFakeContext().liveSources()).toBe(0);
    });

    it('does not start while the video is audible and the policy is to stop', () => {
      allowAmbient();
      reportVideoAudible('player', true);
      expect(startAmbient()).toBe(false);
      expect(getAmbientState().stoppedBy).toBe('video');
      expect(FakeAudioContext.instances).toHaveLength(0);
    });
  });

  describe('when the window is hidden', () => {
    it('stops by default and stays stopped when the window returns', () => {
      allowAmbient();
      startAmbient();
      setHidden(true);
      expect(getAmbientState()).toMatchObject({ kind: null, stoppedBy: 'hidden' });
      setHidden(false);
      vi.advanceTimersByTime(3000);
      expect(getAmbientState().kind).toBeNull();
      expect(theFakeContext().liveSources()).toBe(0);
    });

    it('keeps playing when the user chose to', () => {
      allowAmbient({ ambientHidden: 'keep' });
      startAmbient();
      setHidden(true);
      expect(getAmbientState().kind).toBe('stadium');
    });
  });

  it('stops at once when the window is closed', () => {
    allowAmbient();
    startAmbient();
    const ctx = theFakeContext();
    window.dispatchEvent(new Event('pagehide'));
    expect(ctx.liveSources()).toBe(0);
    expect(getAmbientState().kind).toBeNull();
  });

  it('forgets its watchers once stopped', () => {
    allowAmbient();
    startAmbient();
    stopAmbient();
    vi.advanceTimersByTime(2000);
    const before = theFakeContext().sources.length;
    writeAtmosphere({ ambientKind: 'engine' });
    reportVideoAudible('player', true);
    reportVideoAudible('player', false);
    expect(theFakeContext().sources).toHaveLength(before);
  });
});

describe('playback context', () => {
  it('keeps a stable snapshot until something changes', () => {
    const first = getPlaybackContext();
    expect(getPlaybackContext()).toBe(first);
    reportVideoAudible('a', true);
    reportVideoAudible('b', true);
    const audible = getPlaybackContext();
    expect(audible).not.toBe(first);
    expect(audible.videoAudible).toBe(true);
    reportVideoAudible('a', false);
    expect(getPlaybackContext().videoAudible).toBe(true);
    reportVideoAudible('b', false);
    expect(getPlaybackContext().videoAudible).toBe(false);
  });
});

describe('AmbientToggle', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  const mount = (sport = 'football') => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<AmbientToggle sport={sport} />));
  };
  const button = () => host?.querySelector<HTMLButtonElement>('button.ambient-toggle') ?? null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it('is not shown until ambient sound is allowed', () => {
    mount();
    expect(button()).toBeNull();
    act(() => {
      writeAtmosphere({ ambient: true });
    });
    expect(button()).not.toBeNull();
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      writeModules({ atmosphere: false });
    });
    expect(button()).toBeNull();
  });

  it('turns the background on and off and says which sound is playing', () => {
    allowAmbient();
    mount('f1');
    act(() => button()?.click());
    expect(button()?.getAttribute('aria-pressed')).toBe('true');
    expect(button()?.title).toContain('двигатель');
    act(() => button()?.click());
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
    expect(button()?.title).toBe('Включить фоновый звук');
  });

  it('follows the sport in automatic mode', () => {
    allowAmbient();
    mount('football');
    act(() => button()?.click());
    expect(button()?.title).toContain('стадион');
    act(() => root?.render(<AmbientToggle sport="f1" />));
    expect(button()?.title).toContain('двигатель');
  });

  it('explains why the background did not start', () => {
    allowAmbient();
    reportVideoAudible('player', true);
    mount();
    act(() => button()?.click());
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
    expect(host?.querySelector('[role="status"]')?.textContent).toContain('видео');
  });
});
