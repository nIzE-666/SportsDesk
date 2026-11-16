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

  it('puts a ring on the events of the user', async () => {
    const { node } = render();
    await app.render(node);
    const mine = buttons().find((button) => button.getAttribute('aria-label') === 'Матч четверга');
    expect(mine?.classList.contains('ui-week-track__event--mine')).toBe(true);
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

    const previous = [...app.host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Предыдущая неделя',
    )!;
    const next = [...app.host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Следующая неделя',
    )!;
    await click(previous);
    await click(next);
    expect(onPrevWeek).toHaveBeenCalledTimes(1);
    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });

  it('shows the preview on hover and on focus', async () => {
    const { node } = render();
    await app.render(node);
    const first = buttons()[0]!;
    await act(async () => {
      first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(app.host.querySelector('.ui-week-track__preview')?.textContent).toBe('mon');

    await act(async () => {
      first.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(app.host.querySelector('.ui-week-track__preview')?.textContent).toBe('');

    await act(async () => {
      first.focus();
    });
    expect(app.host.querySelector('.ui-week-track__preview')?.textContent).toBe('mon');
    await act(async () => {
      first.blur();
    });
    expect(app.host.querySelector('.ui-week-track__preview')?.textContent).toBe('');
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
