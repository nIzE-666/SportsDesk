// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeModules } from '../../lib/modules';
import { GamesView } from './GamesView';
import { StartLights, type GameClock } from './StartLightsGame';
import { START_LIGHTS_KEY, readStartLights } from './startLights';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const time = { now: 0 };
const clock: GameClock = { now: () => time.now, pressTime: () => time.now };

const pad = () => host?.querySelector<HTMLElement>('.lights-pad') as HTMLElement;
const lamps = () => host?.querySelectorAll('.lamp.on').length ?? 0;
const status = () => host?.querySelector('.lights-status')?.textContent ?? '';
const text = () => host?.textContent ?? '';

function press(repeat = false, key = ' ') {
  act(() => {
    pad().dispatchEvent(
      new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }),
    );
  });
}
/** Время идёт только вперёд: и часы игры, и таймеры. */
function advance(ms: number) {
  time.now += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
function mount(random = () => 0) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<StartLights clock={clock} random={random} />));
}
/**
 * Запускает попытку и доводит её до погасших огней (random → 0: пауза 200 мс).
 * Возвращает время кадра, в котором огни погасли на экране: от него идёт отсчёт.
 */
function toLightsOut(): number {
  press();
  advance(800 * 5);
  advance(200);
  advance(16);
  return time.now;
}
function reactAfter(lightsOut: number, ms: number) {
  time.now = lightsOut + ms;
  press();
}

beforeEach(() => {
  localStorage.clear();
  time.now = 0;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('StartLights', () => {
  it('waits for the player, lights five lamps one by one and then puts them out', () => {
    mount();
    expect(status()).toContain('Нажмите пробел');
    expect(lamps()).toBe(0);
    press();
    expect(status()).toContain('Не нажимайте');
    for (let lit = 1; lit <= 5; lit++) {
      advance(800);
      expect(lamps()).toBe(lit);
    }
    advance(199);
    expect(lamps()).toBe(5);
    advance(1);
    expect(lamps()).toBe(0);
    expect(pad().className).toContain('go');
    expect(status()).toContain('Огни погасли');
  });

  it('measures the reaction from the frame where the lights went out', () => {
    mount();
    reactAfter(toLightsOut(), 230);
    expect(text()).toContain('230 мс');
    expect(status()).toContain('230 мс');
    expect(text()).toContain('Первое время записано');
    expect(readStartLights()).toMatchObject({ rounds: 1, best: { ms: 230 } });
  });

  it('shows a record only when it is improved', () => {
    mount();
    for (const [reaction, badge] of [
      [300, 'Первое время записано'],
      [350, ''],
      [280, 'Новый личный рекорд'],
    ] as const) {
      reactAfter(toLightsOut(), reaction);
      if (badge) expect(text()).toContain(badge);
      else expect(text()).not.toMatch(/рекорд|Первое время/);
      advance(700);
    }
    expect(readStartLights().best?.ms).toBe(280);
    expect(readStartLights().history.map((attempt) => attempt.ms)).toEqual([300, 350, 280]);
  });

  it('calls a press while the lights are still on a false start', () => {
    mount();
    press();
    advance(1700);
    expect(lamps()).toBe(2);
    press();
    expect(text()).toContain('Фальстарт');
    expect(status()).toContain('ещё горели');
    expect(readStartLights()).toMatchObject({ rounds: 1, falseStarts: 1, history: [] });
    // Попытка закончена: огни и таймеры больше ничего не меняют.
    advance(10_000);
    expect(readStartLights().rounds).toBe(1);
  });

  it('calls a press faster than the limit a guess', () => {
    mount();
    reactAfter(toLightsOut(), 60);
    expect(text()).toContain('Фальстарт');
    expect(status()).toContain('угадыванием');
    expect(readStartLights().falseStarts).toBe(1);
  });

  it('does not count a press before the lights-out frame was even shown', () => {
    mount();
    press();
    advance(4000);
    advance(200);
    // Огни погасли в DOM, но кадр с этим ещё не показан.
    expect(pad().className).toContain('go');
    press();
    expect(text()).toContain('Фальстарт');
    expect(readStartLights().history).toEqual([]);
  });

  it('ignores a held key: only the press itself counts', () => {
    mount();
    press();
    // Клавиша остаётся зажатой — приходят только повторы.
    press(true);
    press(true);
    expect(status()).toContain('Не нажимайте');
    advance(4200);
    advance(16);
    const lightsOut = time.now;
    press(true);
    press(true);
    expect(pad().className).toContain('go');
    expect(readStartLights().rounds).toBe(0);
    reactAfter(lightsOut, 260);
    expect(text()).toContain('260 мс');
  });

  it('ends the attempt without a time when nobody presses in two seconds', () => {
    mount();
    toLightsOut();
    advance(2000);
    expect(text()).toContain('Не успели');
    expect(readStartLights()).toMatchObject({ rounds: 1, falseStarts: 0, history: [] });
  });

  it('does not start a new attempt from the taps that follow a result', () => {
    mount();
    const lightsOut = toLightsOut();
    reactAfter(lightsOut, 250);
    expect(text()).toContain('250 мс');
    reactAfter(lightsOut, 400);
    expect(status()).toContain('250 мс');
    expect(lamps()).toBe(0);
    reactAfter(lightsOut, 900);
    expect(status()).toContain('Не нажимайте');
  });

  it('interrupts the attempt, without counting it, when the window loses focus', () => {
    mount();
    press();
    advance(1700);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(text()).toContain('Попытка прервана');
    expect(text()).toContain('не засчитана');
    expect(readStartLights()).toMatchObject({ rounds: 0, falseStarts: 0 });
    advance(10_000);
    expect(readStartLights().rounds).toBe(0);
    expect(lamps()).toBe(2);
  });

  it('interrupts when the field itself loses focus or the page is hidden', () => {
    mount();
    press();
    act(() => {
      pad().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(text()).toContain('Попытка прервана');
    press();
    expect(status()).toContain('Не нажимайте');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    expect(text()).toContain('Попытка прервана');
    expect(readStartLights().rounds).toBe(0);
  });

  it('starts from a click too', () => {
    mount();
    act(() => {
      pad().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    expect(status()).toContain('Не нажимайте');
    act(() => {
      pad().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }));
    });
    expect(status()).toContain('Не нажимайте');
  });

  it('leaves nothing running and records nothing when it is closed mid-attempt', () => {
    mount();
    press();
    advance(1700);
    act(() => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
    expect(localStorage.getItem(START_LIGHTS_KEY)).toBeNull();
  });

  it('resets statistics only after a second confirming click', () => {
    mount();
    reactAfter(toLightsOut(), 300);
    const reset = [...(host?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes('Сбросить'),
    ) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    act(() => reset.click());
    expect(reset.textContent).toContain('Точно сбросить');
    expect(readStartLights().rounds).toBe(1);
    act(() => reset.click());
    expect(readStartLights().rounds).toBe(0);
    expect(text()).toContain('—');
  });

  it('never claims to compare you with real drivers', () => {
    mount();
    reactAfter(toLightsOut(), 200);
    expect(text()).not.toMatch(/пилот[а-я]* (реагир|быстр)|0[,.]2 с у пилотов/i);
    expect(text()).toContain('не с пилотами');
    expect(text()).toContain('задержки');
  });
});

describe('GamesView', () => {
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('opens the game only on demand and says so when both games are switched off', async () => {
    vi.useRealTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    writeModules({ games: false, predictions: false });
    act(() => root?.render(<GamesView />));
    expect(host.textContent).toContain('Игры выключены');
    expect(host.querySelector('.lights-pad')).toBeNull();
    act(() => {
      writeModules({ games: true });
    });
    await flush();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'Стартовые огни',
    );
    expect(host.querySelector('.lights-pad')).not.toBeNull();
  });
});
