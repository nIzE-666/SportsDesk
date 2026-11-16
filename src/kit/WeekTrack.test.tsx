// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeekTrack, type WeekTrackEvent } from './index';
import { click, createTestHost, pressKey } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

const WEEK_START = new Date(2026, 10, 9, 0, 0, 0, 0);
const NOW = new Date(2026, 10, 12, 19, 30, 0, 0);

function at(day: number, hour: number, minute = 0): string {
  const date = new Date(WEEK_START);
  date.setDate(date.getDate() + day);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const EVENTS: WeekTrackEvent[] = [
  {
    id: 'thu',
    kind: 'match',
    start: at(3, 21),
    interest: 5,
    label: 'Матч четверга',
    mine: true,
    featured: true,
  },
  { id: 'mon', kind: 'match', start: at(0, 20), interest: 2, label: 'Матч понедельника' },
  { id: 'sun', kind: 'match', start: at(6, 18), interest: null, label: 'Матч воскресенья' },
  { id: 'tue', kind: 'race', start: at(1, 18), interest: null, label: 'Гонка вторника' },
];

function render(events: WeekTrackEvent[] = EVENTS, now = NOW.toISOString()) {
  const onOpen = vi.fn();
  const onPrevWeek = vi.fn();
  const onNextWeek = vi.fn();
  return {
    onOpen,
    onPrevWeek,
    onNextWeek,
    node: (
      <WeekTrack
        weekStart={WEEK_START.toISOString()}
        now={now}
        events={events}
        onOpen={onOpen}
        onPrevWeek={onPrevWeek}
        onNextWeek={onNextWeek}
        renderPreview={(id) => <div className="preview-card">{id}</div>}
      />
    ),
  };
}

const buttons = () => [...app.host.querySelectorAll<HTMLButtonElement>('.ui-week-track__event')];

function slotPosition(label: string): number {
  const button = buttons().find((item) => item.getAttribute('aria-label') === label);
  const slot = button?.closest('.ui-week-track__slot');
  const match = slot?.className.match(/ui-week-track__at--p(\d+)/);
  if (!match) throw new Error(`No position for ${label}`);
  return Number(match[1]);
}

function nowPosition(): number {
  const now = app.host.querySelector('.ui-week-track__now');
  const match = now?.className.match(/ui-week-track__at--p(\d+)/);
  if (!match) throw new Error('No position for «сейчас»');
  return Number(match[1]);
}

describe('WeekTrack', () => {
  it('draws seven days and names the week for a screen reader', async () => {
    const { node } = render();
    await app.render(node);
    const labels = [...app.host.querySelectorAll('.ui-week-track__day-label')].map(
      (element) => element.textContent,
    );
    expect(labels).toEqual(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']);
    const group = app.host.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe(
      'Неделя 9–15 ноября, сейчас — четверг, 12 ноября',
    );
  });

  it('renders every event in time order as a named button', async () => {
    const { node } = render();
    await app.render(node);
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Матч понедельника',
      'Гонка вторника',
      'Матч четверга',
      'Матч воскресенья',
    ]);
    expect(
      app.host.querySelectorAll('.ui-week-track__day')[0]?.querySelectorAll('button'),
    ).toHaveLength(1);
  });

  it('sizes match dots by interest and marks races with a flag', async () => {
    const { node } = render();
    await app.render(node);
    const dot = (label: string) =>
      buttons()
        .find((button) => button.getAttribute('aria-label') === label)
        ?.querySelector('.ui-week-track__dot');
    expect(dot('Матч понедельника')?.classList.contains('ui-week-track__dot--interest-2')).toBe(
      true,
    );
    expect(dot('Матч четверга')?.classList.contains('ui-week-track__dot--interest-5')).toBe(true);
    expect(dot('Матч воскресенья')?.classList.contains('ui-week-track__dot--none')).toBe(true);
    expect(app.host.querySelectorAll('.ui-week-track__flag')).toHaveLength(1);
  });

  it('marks the featured match and the clubs of the user', async () => {
    const { node } = render();
    await app.render(node);
    const featured = buttons().find(
      (button) => button.getAttribute('aria-label') === 'Матч четверга',
    );
    expect(featured?.classList.contains('ui-week-track__event--featured')).toBe(true);
    expect(featured?.classList.contains('ui-week-track__event--mine')).toBe(true);
    expect(featured?.querySelector('.ui-week-track__dot--interest-5')).not.toBeNull();
    expect(app.host.querySelector('.ui-week-track__featured')?.textContent).toBe('главный матч');

    const other = buttons().find(
      (button) => button.getAttribute('aria-label') === 'Матч понедельника',
    );
    expect(other?.classList.contains('ui-week-track__event--mine')).toBe(false);
  });

  it('shows «сейчас» only inside the week and only on its day', async () => {
    const { node } = render();
    await app.render(node);
    expect(app.host.querySelectorAll('.ui-week-track__now')).toHaveLength(1);
    expect(app.host.querySelector('.ui-week-track__now-stem')).not.toBeNull();
    expect(app.host.querySelector('.ui-week-track__now-dot')).not.toBeNull();
    expect(app.host.querySelector('.ui-week-track__now-label')?.textContent).toBe('сейчас · 19:30');
    expect(
      app.host.querySelector('.ui-week-track__now')?.classList.contains('ui-week-track__at--p163'),
    ).toBe(true);
    const days = [...app.host.querySelectorAll('.ui-week-track__day')];
    const day = app.host.querySelector('.ui-week-track__now')?.closest('.ui-week-track__day');
    expect(days.indexOf(day as Element)).toBe(3);

    await app.unmount();
    app = createTestHost();
    const outside = render(EVENTS, new Date(2026, 10, 23, 12).toISOString());
    await app.render(outside.node);
    expect(app.host.querySelector('.ui-week-track__now')).toBeNull();
    expect(app.host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Неделя 9–15 ноября',
    );
  });

  it('puts an event at its time of day on a day without «сейчас»', async () => {
    const events: WeekTrackEvent[] = [
      { id: 'morning', kind: 'match', start: at(2, 6), interest: 2, label: 'Утро среды' },
      { id: 'evening', kind: 'match', start: at(2, 18), interest: 2, label: 'Вечер среды' },
    ];
    const { node } = render(events);
    await app.render(node);
    expect(slotPosition('Утро среды')).toBe(50);
    expect(slotPosition('Вечер среды')).toBe(150);
  });

  it('keeps past events left of «сейчас», ahead events right, and spreads close times', async () => {
    const events: WeekTrackEvent[] = [
      { id: 'past', kind: 'match', start: at(3, 9), interest: 2, label: 'Ранний матч' },
      { id: 'a', kind: 'match', start: at(3, 10), interest: 3, label: 'Матч в десять' },
      {
        id: 'b',
        kind: 'match',
        start: at(3, 10, 5),
        interest: 3,
        label: 'Первый в десять ноль пять',
      },
      {
        id: 'c',
        kind: 'match',
        start: at(3, 10, 5),
        interest: 3,
        label: 'Второй в десять ноль пять',
      },
      {
        id: 'd',
        kind: 'match',
        start: at(3, 10, 30),
        interest: 3,
        label: 'Матч в десять тридцать',
      },
    ];
    const { node } = render(events, new Date(2026, 10, 12, 10, 0, 0).toISOString());
    await app.render(node);

    const now = nowPosition();
    const past = slotPosition('Ранний матч');
    const ahead = [
      slotPosition('Матч в десять'),
      slotPosition('Первый в десять ноль пять'),
      slotPosition('Второй в десять ноль пять'),
      slotPosition('Матч в десять тридцать'),
    ];
    expect(now).toBe(83);
    expect(past).toBeLessThan(now);
    expect(ahead).toEqual([111, 139, 167, 195]);
    for (const position of ahead) {
      expect(position).toBeGreaterThan(now);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(200);
    }
    for (let index = 1; index < ahead.length; index += 1) {
      expect(ahead[index]! - ahead[index - 1]!).toBeGreaterThanOrEqual(28);
    }
  });

  it('hides the events of another week', async () => {
    const outside: WeekTrackEvent[] = [
      ...EVENTS,
      { id: 'before', kind: 'match', start: at(-1, 20), interest: 1, label: 'Матч до недели' },
      { id: 'after', kind: 'match', start: at(7, 20), interest: 1, label: 'Матч после недели' },
    ];
    const { node } = render(outside);
    await app.render(node);
    expect(buttons()).toHaveLength(4);
    expect(buttons().some((button) => button.getAttribute('aria-label') === 'Матч до недели')).toBe(
      false,
    );
  });

  it('opens an event by click and offers the previous and next week', async () => {
    const { node, onOpen, onPrevWeek, onNextWeek } = render();
    await app.render(node);
    await click(buttons()[0]!);
    expect(onOpen).toHaveBeenCalledWith('mon');

    const previous = app.host.querySelector<HTMLButtonElement>('[aria-label="Предыдущая неделя"]')!;
    const next = app.host.querySelector<HTMLButtonElement>('[aria-label="Следующая неделя"]')!;
    await click(previous);
    await click(next);
    expect(onPrevWeek).toHaveBeenCalledTimes(1);
    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });

  it('shows the preview as a tooltip on hover and on focus', async () => {
    const { node } = render();
    await app.render(node);
    const first = buttons()[0]!;
    await act(async () => {
      first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const tip = app.host.querySelector('.ui-week-track__tip');
    expect(tip?.getAttribute('role')).toBe('tooltip');
    expect(tip?.textContent).toBe('mon');
    expect(first.getAttribute('aria-describedby')).toBe(tip?.getAttribute('id'));

    await act(async () => {
      first.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(app.host.querySelector('.ui-week-track__tip')).toBeNull();

    await act(async () => {
      first.focus();
    });
    expect(app.host.querySelector('.ui-week-track__tip')?.textContent).toBe('mon');
    await act(async () => {
      first.blur();
    });
    expect(app.host.querySelector('.ui-week-track__tip')).toBeNull();
  });

  it('moves between events with the left and right arrows', async () => {
    const { node } = render();
    await app.render(node);
    const [first, second] = buttons();
    await act(async () => {
      first!.focus();
    });
    await pressKey(first!, 'ArrowRight');
    expect(document.activeElement).toBe(second);
    await pressKey(second!, 'ArrowLeft');
    expect(document.activeElement).toBe(first);
  });

  it('formats a week that crosses a month', async () => {
    const start = new Date(2026, 10, 30, 0, 0, 0, 0);
    await app.render(
      <WeekTrack
        weekStart={start.toISOString()}
        now={new Date(2026, 11, 3, 12).toISOString()}
        events={[]}
        onOpen={() => undefined}
        onPrevWeek={() => undefined}
        onNextWeek={() => undefined}
        renderPreview={() => null}
      />,
    );
    expect(app.host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Неделя 30 ноября — 6 декабря, сейчас — четверг, 3 декабря',
    );
  });
});
