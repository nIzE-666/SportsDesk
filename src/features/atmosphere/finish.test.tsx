// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeModules } from '../../lib/modules';
import { f1SpoilerId, hideResult } from '../spoilers/spoilerStore';
import { writeAtmosphere } from './atmosphereStore';
import { readCelebrated, rememberCelebrated } from './celebrationRules';
import { FinishCelebration } from './FinishCelebration';
import {
  FINISH_EVENT,
  FINISH_PREVIEW_EVENT,
  decideFinish,
  parseFinish,
  type FinishPayload,
} from './finishRules';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    mocks.handlers.set(name, callback);
    return mocks.unlisten;
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const raw = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1|result|2026|21|race',
  season: '2026',
  round: '21',
  session: 'race',
  label: 'Гонка',
  raceName: 'Abu Dhabi Grand Prix',
  podium: [
    { position: 1, driver: 'Max Verstappen', team: 'Red Bull', constructorId: 'red_bull' },
    { position: 2, driver: 'Lando Norris', team: 'McLaren', constructorId: 'mclaren' },
    { position: 3, driver: 'Charles Leclerc', team: 'Ferrari', constructorId: 'ferrari' },
  ],
  ...overrides,
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

describe('parseFinish', () => {
  it('accepts a complete podium from Rust', () => {
    const parsed = parseFinish(raw());
    expect(parsed).toMatchObject({ id: 'f1|result|2026|21|race', session: 'race' });
    expect(parsed?.podium.map((place) => place.driver)).toEqual([
      'Max Verstappen',
      'Lando Norris',
      'Charles Leclerc',
    ]);
    expect(parsed?.podium[0]?.constructorId).toBe('red_bull');
  });

  it('accepts a sprint and rejects an id that does not match the session', () => {
    expect(
      parseFinish(raw({ id: 'f1|result|2026|21|sprint', session: 'sprint', label: 'Спринт' })),
    ).toMatchObject({ session: 'sprint' });
    expect(parseFinish(raw({ session: 'sprint' }))).toBeNull();
    expect(parseFinish(raw({ id: 'f1|result|2026|20|race' }))).toBeNull();
  });

  it('rejects anything that is not a full podium', () => {
    expect(parseFinish(null)).toBeNull();
    expect(parseFinish('race')).toBeNull();
    expect(parseFinish(raw({ session: 'qualifying' }))).toBeNull();
    expect(parseFinish(raw({ podium: [] }))).toBeNull();
    expect(parseFinish(raw({ podium: (raw().podium as unknown[]).slice(0, 2) }))).toBeNull();
    expect(parseFinish(raw({ raceName: '' }))).toBeNull();
    expect(parseFinish(raw({ label: 'x'.repeat(40) }))).toBeNull();
    const swapped = raw().podium.slice().reverse();
    expect(parseFinish(raw({ podium: swapped }))).toBeNull();
    const nameless = raw().podium.map((place, i) => (i === 0 ? { ...place, driver: '  ' } : place));
    expect(parseFinish(raw({ podium: nameless }))).toBeNull();
  });

  it('cleans control characters and ignores odd constructor ids', () => {
    const podium = raw().podium.map((place, i) =>
      i === 0 ? { ...place, driver: 'Max\u0007 Verstappen', constructorId: '../etc' } : place,
    );
    const parsed = parseFinish(raw({ podium }));
    expect(parsed?.podium[0]?.driver).toBe('Max Verstappen');
    expect(parsed?.podium[0]?.constructorId).toBeUndefined();
  });
});

describe('decideFinish', () => {
  const payload = parseFinish(raw()) as FinishPayload;
  beforeEach(() => localStorage.clear());
  afterEach(() => setHidden(false));

  it('shows a fresh podium', () => {
    expect(decideFinish(payload, { windowHidden: false })).toBe('show');
  });

  it('never repeats a podium that was already celebrated', () => {
    rememberCelebrated([payload.id]);
    expect(decideFinish(payload, { windowHidden: false })).toBe('seen');
  });

  it('stays quiet when celebrations are off, the window is hidden or the weekend is hidden', () => {
    writeAtmosphere({ celebrations: false });
    expect(decideFinish(payload, { windowHidden: false })).toBe('quiet');
    writeAtmosphere({ celebrations: true });
    writeModules({ atmosphere: false });
    expect(decideFinish(payload, { windowHidden: false })).toBe('quiet');
    writeModules({ atmosphere: true });
    expect(decideFinish(payload, { windowHidden: true })).toBe('quiet');
    hideResult({ kind: 'f1', id: f1SpoilerId('2026', '21') });
    expect(decideFinish(payload, { windowHidden: false })).toBe('quiet');
    // Скрыт другой этап: этот можно праздновать.
    expect(decideFinish({ ...payload, round: '20' }, { windowHidden: false })).toBe('show');
  });
});

describe('FinishCelebration', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  const send = (payload: unknown) => {
    const handler = mocks.handlers.get(FINISH_EVENT);
    if (!handler) throw new Error('listener was not registered');
    act(() => handler({ payload }));
  };
  const mount = async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<FinishCelebration />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  beforeEach(() => {
    localStorage.clear();
    mocks.handlers.clear();
    mocks.unlisten.mockClear();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    setHidden(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waves the flag and shows the podium for a podium that just became published', async () => {
    writeAtmosphere({ motion: 'full' });
    await mount();
    expect(host?.textContent).toBe('');
    send(raw());
    expect(host?.querySelector('.finish-flag')).not.toBeNull();
    expect(host?.querySelector('canvas')).not.toBeNull();
    const text = host?.textContent ?? '';
    expect(text).toContain('Клетчатый флаг');
    expect(text).toContain('Гран-при Абу-Даби');
    expect(text).toContain('Max Verstappen');
    expect(text).toContain('Lando Norris');
    expect(text).toContain('Charles Leclerc');
    expect(text).toContain('возможны поправки');
    // Победитель — в центре подиума.
    const steps = [...(host?.querySelectorAll('.finish-step') ?? [])].map((step) => step.className);
    expect(steps).toEqual(['finish-step place-2', 'finish-step place-1', 'finish-step place-3']);
    expect(readCelebrated()).toContain('f1|result|2026|21|race');
  });

  it('does not celebrate the same podium twice, even after it was closed', async () => {
    await mount();
    send(raw());
    act(() => host?.querySelector<HTMLButtonElement>('button[aria-label="Закрыть"]')?.click());
    expect(host?.querySelector('.finish-card')).toBeNull();
    send(raw());
    expect(host?.querySelector('.finish-card')).toBeNull();
  });

  it('ignores a malformed event completely', async () => {
    await mount();
    send({ id: 'f1|result|2026|21|race', podium: [] });
    expect(host?.querySelector('.finish-card')).toBeNull();
    expect(readCelebrated()).toEqual([]);
  });

  it('stays quiet but remembers the podium when celebrations are off', async () => {
    writeAtmosphere({ celebrations: false });
    await mount();
    send(raw());
    expect(host?.querySelector('.finish-card')).toBeNull();
    expect(readCelebrated()).toContain('f1|result|2026|21|race');
  });

  it('does not reveal a weekend that is hidden from spoilers', async () => {
    hideResult({ kind: 'f1', id: f1SpoilerId('2026', '21') });
    await mount();
    send(raw());
    expect(host?.querySelector('.finish-card')).toBeNull();
    expect(host?.textContent).not.toContain('Verstappen');
    expect(readCelebrated()).toContain('f1|result|2026|21|race');
  });

  it('does not flash a podium in a hidden window', async () => {
    await mount();
    setHidden(true);
    send(raw());
    expect(host?.querySelector('.finish-card')).toBeNull();
    setHidden(false);
    send(raw());
    expect(host?.querySelector('.finish-card')).toBeNull();
  });

  it('shows a calm static podium without particles when motion is reduced', async () => {
    writeAtmosphere({ motion: 'reduced' });
    await mount();
    send(raw());
    expect(host?.querySelector('.finish-card.static')).not.toBeNull();
    expect(host?.querySelector('.finish-flag')).toBeNull();
    expect(host?.querySelector('canvas')).toBeNull();
    expect(host?.textContent).toContain('Max Verstappen');
  });

  it('labels a sprint podium as a sprint', async () => {
    await mount();
    send(raw({ id: 'f1|result|2026|21|sprint', session: 'sprint', label: 'Спринт' }));
    expect(host?.querySelector('.finish-card-head')?.textContent).toContain('Спринт');
  });

  it('stops listening when it is removed', async () => {
    await mount();
    act(() => root?.unmount());
    root = null;
    expect(mocks.unlisten).toHaveBeenCalled();
  });

  it('previews the look with made-up names and does not remember anything', async () => {
    writeAtmosphere({ motion: 'reduced' });
    await mount();
    act(() => {
      window.dispatchEvent(new Event(FINISH_PREVIEW_EVENT));
    });
    const text = host?.textContent ?? '';
    expect(text).toContain('Победитель');
    expect(text).toContain('Это пример оформления');
    expect(text).not.toContain('возможны поправки');
    expect(readCelebrated()).toEqual([]);
  });

  it('hides the card by itself after a while', async () => {
    writeAtmosphere({ motion: 'reduced' });
    await mount();
    vi.useFakeTimers();
    act(() => {
      window.dispatchEvent(new Event(FINISH_PREVIEW_EVENT));
    });
    expect(host?.querySelector('.finish-card')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(10_001);
    });
    expect(host?.querySelector('.finish-card')).toBeNull();
  });
});
