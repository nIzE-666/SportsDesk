// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown } from './index';
import { createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
  vi.useRealTimers();
});

const NOW = new Date(2026, 10, 16, 12, 0, 0, 0).getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function targetFrom(offset: number): string {
  return new Date(NOW + offset).toISOString();
}

const digits = () => app.host.querySelector('.ui-countdown__digits')?.textContent;

describe('Countdown', () => {
  it('shows whole days and the time left', async () => {
    await app.render(
      <Countdown
        target={targetFrom(2 * DAY + 14 * HOUR + 5 * MINUTE + 32 * SECOND)}
        endedLabel="Матч начался"
        now={() => NOW}
      />,
    );
    expect(digits()).toBe('через 2 дня · 14:05:32');
    expect(app.host.querySelector('.ui-countdown')?.getAttribute('aria-label')).toBe(
      'через 2 дня · 14:05',
    );
    expect(app.host.querySelector('.ui-countdown__digits')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('shows only the clock under a day', async () => {
    await app.render(
      <Countdown
        target={targetFrom(14 * HOUR + 5 * MINUTE + 32 * SECOND)}
        endedLabel="Матч начался"
        now={() => NOW}
      />,
    );
    expect(digits()).toBe('14:05:32');
    expect(app.host.querySelector('.ui-countdown')?.getAttribute('aria-label')).toBe('14:05');
  });

  it('splits the same time into scoreboard cells in the board form', async () => {
    await app.render(
      <Countdown
        variant="board"
        target={targetFrom(2 * DAY + 14 * HOUR + 5 * MINUTE + 32 * SECOND)}
        endedLabel="Матч начался"
        now={() => NOW}
      />,
    );
    const countdown = app.host.querySelector('.ui-countdown')!;
    expect(countdown.classList.contains('ui-countdown--board')).toBe(true);
    expect(countdown.getAttribute('aria-label')).toBe('через 2 дня · 14:05');
    const cells = [...app.host.querySelectorAll('.ui-countdown__cell')];
    expect(cells.map((cell) => cell.querySelector('.ui-countdown__value')?.textContent)).toEqual([
      '2',
      '14',
      '05',
      '32',
    ]);
    expect(cells.map((cell) => cell.querySelector('.ui-countdown__unit')?.textContent)).toEqual([
      'дн',
      'ч',
      'мин',
      'сек',
    ]);
    expect(app.host.querySelector('.ui-countdown__cells')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('drops the day cell of the board under one day and keeps the text after the start', async () => {
    await app.render(
      <Countdown
        variant="board"
        target={targetFrom(14 * HOUR + 5 * MINUTE + 32 * SECOND)}
        endedLabel="Матч начался"
        now={() => NOW}
      />,
    );
    expect(app.host.querySelectorAll('.ui-countdown__cell')).toHaveLength(3);
    expect(app.host.querySelector('.ui-countdown__unit')?.textContent).toBe('ч');

    await app.render(
      <Countdown
        variant="board"
        target={targetFrom(0)}
        endedLabel="Матч начался"
        now={() => NOW}
      />,
    );
    expect(app.host.querySelector('.ui-countdown__cell')).toBeNull();
    expect(digits()).toBe('Матч начался');
  });

  it('uses the Russian plurals for the days', async () => {
    await app.render(
      <Countdown target={targetFrom(DAY + 2 * HOUR)} endedLabel="Начался" now={() => NOW} />,
    );
    expect(digits()).toBe('через 1 день · 02:00:00');
    await app.render(
      <Countdown target={targetFrom(2 * DAY + 2 * HOUR)} endedLabel="Начался" now={() => NOW} />,
    );
    expect(digits()).toBe('через 2 дня · 02:00:00');
    await app.render(
      <Countdown target={targetFrom(5 * DAY + 2 * HOUR)} endedLabel="Начался" now={() => NOW} />,
    );
    expect(digits()).toBe('через 5 дней · 02:00:00');
  });

  it('shows the ended label at and after the target', async () => {
    await app.render(
      <Countdown target={targetFrom(0)} endedLabel="Матч начался" now={() => NOW} />,
    );
    expect(digits()).toBe('Матч начался');
    expect(app.host.querySelector('.ui-countdown')?.getAttribute('aria-label')).toBe(
      'Матч начался',
    );
    await app.render(
      <Countdown target={targetFrom(-HOUR)} endedLabel="Матч начался" now={() => NOW} />,
    );
    expect(digits()).toBe('Матч начался');
  });

  it('renders nothing for an invalid target', async () => {
    await app.render(<Countdown target="не дата" endedLabel="Матч начался" now={() => NOW} />);
    expect(app.host.querySelector('.ui-countdown')).toBeNull();
    expect(app.host.textContent).toBe('');
  });

  it('ticks once a second while mounted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await app.render(<Countdown target={targetFrom(10 * SECOND)} endedLabel="Матч начался" />);
    expect(digits()).toBe('00:00:10');
    await act(async () => {
      vi.advanceTimersByTime(SECOND);
    });
    expect(digits()).toBe('00:00:09');
    await act(async () => {
      vi.advanceTimersByTime(4 * SECOND);
    });
    expect(digits()).toBe('00:00:05');
  });

  it('stops ticking while the document is hidden and catches up when visible', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await app.render(<Countdown target={targetFrom(20 * SECOND)} endedLabel="Матч начался" />);
    expect(digits()).toBe('00:00:20');

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(3 * SECOND);
    });
    expect(digits()).toBe('00:00:20');

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(digits()).toBe('00:00:17');
  });
});
