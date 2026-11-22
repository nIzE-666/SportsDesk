// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeModules } from '../../lib/modules';
import { POLICY_KEY } from '../settings/notificationPolicy';
import { resetAudioContextForTests } from './audioContext';
import { writeAtmosphere } from './atmosphereStore';
import { FakeAudioContext, installFakeAudio, removeFakeAudio, theFakeContext } from './fakeAudio';
import {
  reportVideoAudible,
  resetPlaybackContextForTests,
  subscribePlaybackContext,
} from './playbackContext';
import {
  playGoalHorn,
  playRadioSignal,
  resetSoundEngineForTests,
  shortSignalAllowed,
} from './soundEngine';

const NOON = Date.UTC(2026, 10, 9, 12, 0);
const NIGHT = Date.UTC(2026, 10, 9, 23, 30);
const native = vi.hoisted(() => ({
  onVisibility: undefined as ((event: { payload: { visible: boolean } }) => void) | undefined,
}));

vi.mock('../../lib/bridge', () => ({ isTauriRuntime: () => true }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_event: string, callback: typeof native.onVisibility) => {
    native.onVisibility = callback;
    return () => {
      native.onVisibility = undefined;
    };
  },
}));

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

beforeEach(() => {
  localStorage.clear();
  installFakeAudio();
  resetAudioContextForTests();
  resetPlaybackContextForTests();
  resetSoundEngineForTests();
});

afterEach(() => {
  setHidden(false);
  resetPlaybackContextForTests();
  removeFakeAudio();
});

it('plays nothing and creates no audio while short sounds are off', () => {
  expect(shortSignalAllowed({ now: NOON })).toBe(false);
  expect(playGoalHorn({ now: NOON })).toBe(false);
  expect(playRadioSignal(NOON)).toBe(false);
  expect(FakeAudioContext.instances).toHaveLength(0);
});

it('plays the goal horn and the radio signal when sounds are on', () => {
  writeAtmosphere({ sounds: true });
  expect(playGoalHorn({ now: NOON })).toBe(true);
  const ctx = theFakeContext();
  // Два гудка по три тона аккорда.
  expect(ctx.sources).toHaveLength(6);
  expect(ctx.sources.every((source) => source.started)).toBe(true);
  expect(playRadioSignal(NOON + 5000)).toBe(true);
  expect(ctx.sources).toHaveLength(7);
});

it('does not stack signals on top of each other', () => {
  writeAtmosphere({ sounds: true });
  expect(playGoalHorn({ now: NOON })).toBe(true);
  expect(playRadioSignal(NOON + 500)).toBe(false);
  expect(playGoalHorn({ now: NOON + 1000 })).toBe(false);
  expect(playGoalHorn({ now: NOON + 2000 })).toBe(true);
});

it('stays silent when the atmosphere module is off or the volume is zero', () => {
  writeAtmosphere({ sounds: true });
  writeModules({ atmosphere: false });
  expect(playGoalHorn({ now: NOON })).toBe(false);
  writeModules({ atmosphere: true });
  writeAtmosphere({ volume: 0 });
  expect(playGoalHorn({ now: NOON })).toBe(false);
});

it('respects quiet hours', () => {
  localStorage.setItem('sportsdesk.timezone', 'UTC');
  localStorage.setItem(
    POLICY_KEY,
    JSON.stringify({ quietEnabled: true, quietStart: '23:00', quietEnd: '08:00' }),
  );
  writeAtmosphere({ sounds: true });
  expect(playGoalHorn({ now: NIGHT })).toBe(false);
  expect(playGoalHorn({ now: NOON })).toBe(true);
});

it('does not play over a video with sound or from a hidden window', () => {
  writeAtmosphere({ sounds: true });
  reportVideoAudible('player', true);
  expect(playGoalHorn({ now: NOON })).toBe(false);
  reportVideoAudible('player', false);
  setHidden(true);
  expect(playRadioSignal(NOON)).toBe(false);
  setHidden(false);
  expect(playRadioSignal(NOON)).toBe(true);
});

it('silences automatic signals while the native window is hidden and the document stays visible', async () => {
  writeAtmosphere({ sounds: true });
  setHidden(false);
  const unsubscribe = subscribePlaybackContext(() => undefined);
  try {
    await vi.waitFor(() => expect(native.onVisibility).toBeTypeOf('function'));
    native.onVisibility!({ payload: { visible: false } });
    expect(shortSignalAllowed({ now: NOON })).toBe(false);
    native.onVisibility!({ payload: { visible: true } });
    expect(shortSignalAllowed({ now: NOON })).toBe(true);
  } finally {
    unsubscribe();
  }
});

it('lets a preview from the settings through, but never when sounds are off', () => {
  localStorage.setItem('sportsdesk.timezone', 'UTC');
  localStorage.setItem(
    POLICY_KEY,
    JSON.stringify({ quietEnabled: true, quietStart: '00:00', quietEnd: '23:59' }),
  );
  expect(playGoalHorn({ preview: true })).toBe(false);
  writeAtmosphere({ sounds: true });
  reportVideoAudible('player', true);
  expect(playGoalHorn({ preview: true })).toBe(true);
});
