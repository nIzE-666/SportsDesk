// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Tabs, type TabItem } from './index';
import { click, createTestHost, pressKey } from './testHost';

const ITEMS: TabItem[] = [
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

function Harness({ mode = 'tabs' as const }: { mode?: 'tabs' | 'nav' }) {
  const [active, setActive] = useState('today');
  return (
    <>
      <Tabs ariaLabel="Период" items={ITEMS} mode={mode} active={active} onChange={setActive} />
      <p data-testid="state">{active}</p>
    </>
  );
}

const tabs = () => [...app.host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const current = () => app.host.querySelector('[data-testid="state"]')?.textContent;

describe('Tabs in the in-page mode', () => {
  it('marks one selected tab and keeps one tab stop', async () => {
    await app.render(<Harness />);
    expect(app.host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Период');
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves selection and focus with arrows, Home and End', async () => {
    await app.render(<Harness />);
    await pressKey(tabs()[0]!, 'ArrowRight');
    expect(current()).toBe('week');
    expect(tabs()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[1]);

    await pressKey(tabs()[1]!, 'End');
    expect(current()).toBe('plan');
    expect(document.activeElement).toBe(tabs()[2]);

    await pressKey(tabs()[2]!, 'ArrowRight');
    expect(current()).toBe('today');
    expect(document.activeElement).toBe(tabs()[0]);

    await pressKey(tabs()[0]!, 'ArrowLeft');
    expect(current()).toBe('plan');

    await pressKey(tabs()[2]!, 'Home');
    expect(current()).toBe('today');
  });

  it('skips disabled tabs in the keyboard order', async () => {
    const items: TabItem[] = [
      { id: 'one', label: 'Первый' },
      { id: 'two', label: 'Второй', disabled: true },
      { id: 'three', label: 'Третий' },
    ];
    function DisabledHarness() {
      const [active, setActive] = useState('one');
      return <Tabs ariaLabel="Разделы" items={items} active={active} onChange={setActive} />;
    }
    await app.render(<DisabledHarness />);
    await pressKey(tabs()[0]!, 'ArrowRight');
    expect(tabs()[2]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[2]);
  });

  it('passes per-item dom ids, titles, the panel id and refs to the buttons', async () => {
    const seen = new Map<string, HTMLElement | null>();
    await app.render(
      <Tabs
        ariaLabel="Период"
        panelId="period-panel"
        active="today"
        items={[
          {
            id: 'today',
            domId: 'tab-today',
            label: 'Сегодня',
            title: 'Сегодня · основное',
            ref: (element) => seen.set('today', element),
          },
          { id: 'week', domId: 'tab-week', label: 'Неделя', title: 'Неделя' },
          { id: 'plan', domId: 'tab-plan', label: 'Мой план' },
        ]}
      />,
    );
    expect(tabs().map((tab) => tab.id)).toEqual(['tab-today', 'tab-week', 'tab-plan']);
    expect(tabs().map((tab) => tab.title)).toEqual(['Сегодня · основное', 'Неделя', '']);
    expect(tabs().map((tab) => tab.getAttribute('aria-controls'))).toEqual([
      'period-panel',
      'period-panel',
      'period-panel',
    ]);
    expect(seen.get('today')).toBe(tabs()[0]);
  });
});

describe('Tabs in the navigation mode', () => {
  it('uses aria-current on the current page without the tab roles', async () => {
    await app.render(<Harness mode="nav" />);
    const nav = app.host.querySelector('nav[aria-label="Период"]');
    expect(nav).not.toBeNull();
    expect(app.host.querySelector('[role="tablist"]')).toBeNull();
    const items = [...nav!.querySelectorAll('a, button')];
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual(['page', null, null]);
    expect(items.map((item) => item.getAttribute('role'))).toEqual([null, null, null]);
  });

  it('changes the page on click and keeps links real links', async () => {
    function LinkHarness() {
      const [active, setActive] = useState('matches');
      return (
        <Tabs
          ariaLabel="Разделы"
          mode="nav"
          active={active}
          items={[
            {
              id: 'matches',
              domId: 'nav-matches',
              label: 'Матчи',
              title: 'Матчи',
              href: '#matches',
            },
            { id: 'table', domId: 'nav-table', label: 'Таблица', href: '#table' },
          ]}
          onChange={setActive}
        />
      );
    }
    await app.render(<LinkHarness />);
    const links = [...app.host.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.id)).toEqual(['nav-matches', 'nav-table']);
    expect(links[0]?.getAttribute('title')).toBe('Матчи');
    expect(links[0]?.getAttribute('href')).toBe('#matches');
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    await click(links[1]!);
    expect(links[1]?.getAttribute('aria-current')).toBe('page');
    expect(links[0]?.getAttribute('aria-current')).toBeNull();
  });
});
