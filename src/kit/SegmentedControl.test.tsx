// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SegmentedControl, type SegmentItem } from './index';
import { click, createTestHost, pressKey } from './testHost';

const ITEMS: SegmentItem[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'week', label: 'Неделя' },
  { id: 'plan', label: 'Мой план' },
];

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

function Harness() {
  const [value, setValue] = useState('today');
  return <SegmentedControl ariaLabel="Период" items={ITEMS} value={value} onChange={setValue} />;
}

const radios = () => [...app.host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

describe('SegmentedControl', () => {
  it('is a radio group with one tab stop', async () => {
    await app.render(<Harness />);
    expect(app.host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(
      'Период',
    );
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  });

  it('selects an option on click', async () => {
    await app.render(<Harness />);
    await click(radios()[2]!);
    expect(radios()[2]?.getAttribute('aria-checked')).toBe('true');
    expect(radios()[0]?.getAttribute('aria-checked')).toBe('false');
  });

  it('moves and selects with arrows, Home and End', async () => {
    await app.render(<Harness />);
    await pressKey(radios()[0]!, 'ArrowRight');
    expect(radios()[1]?.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios()[1]);

    await pressKey(radios()[1]!, 'ArrowDown');
    expect(radios()[2]?.getAttribute('aria-checked')).toBe('true');

    await pressKey(radios()[2]!, 'ArrowRight');
    expect(radios()[0]?.getAttribute('aria-checked')).toBe('true');

    await pressKey(radios()[0]!, 'ArrowLeft');
    expect(radios()[2]?.getAttribute('aria-checked')).toBe('true');

    await pressKey(radios()[2]!, 'Home');
    expect(radios()[0]?.getAttribute('aria-checked')).toBe('true');

    await pressKey(radios()[0]!, 'End');
    expect(radios()[2]?.getAttribute('aria-checked')).toBe('true');
  });

  it('skips disabled options', async () => {
    const items: SegmentItem[] = [
      { id: 'one', label: 'Первый' },
      { id: 'two', label: 'Второй', disabled: true },
      { id: 'three', label: 'Третий' },
    ];
    function DisabledHarness() {
      const [value, setValue] = useState('one');
      return <SegmentedControl ariaLabel="Ряд" items={items} value={value} onChange={setValue} />;
    }
    await app.render(<DisabledHarness />);
    await pressKey(radios()[0]!, 'ArrowRight');
    expect(radios()[2]?.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios()[2]);
  });
});
