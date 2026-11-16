// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShowcaseUpcomingCard } from './index';
import { click, createTestHost, pressKey } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

const BAYERN = { name: 'Bayern München' };
const DORTMUND = { name: 'Borussia Dortmund' };

describe('ShowcaseUpcomingCard', () => {
  it('shows a match with both crests and the local time', async () => {
    await app.render(
      <ShowcaseUpcomingCard
        kicker="1-е против 3-го"
        home={BAYERN}
        away={DORTMUND}
        meta="Бундеслига · через 1 д 7 ч"
        time="02:30"
        date="сб, 21 нояб."
      />,
    );
    expect(app.host.querySelector('.ui-showcase-upcoming__kicker')?.textContent).toBe(
      '1-е против 3-го',
    );
    const teams = [...app.host.querySelectorAll('.ui-showcase-upcoming__team')];
    expect(teams).toHaveLength(2);
    expect(teams[0]?.textContent).toContain('Bayern München');
    expect(teams[1]?.textContent).toContain('Borussia Dortmund');
    expect(app.host.querySelectorAll('.ui-showcase-crest')).toHaveLength(2);
    expect(app.host.querySelector('.ui-showcase-upcoming__meta')?.textContent).toBe(
      'Бундеслига · через 1 д 7 ч',
    );
    expect(app.host.querySelector('.ui-showcase-upcoming__when')?.textContent).toBe(
      '02:30сб, 21 нояб.',
    );
    expect(app.host.querySelector('.ui-showcase-upcoming__flag')).toBeNull();
  });

  it('shows a race session with the checkered flag', async () => {
    await app.render(
      <ShowcaseUpcomingCard
        kicker="Формула 1"
        race="Гран-при Лас-Вегаса"
        session="Квалификация"
        meta="через 1 д 17 ч"
        time="13:00"
        date="сб, 21 нояб."
      />,
    );
    expect(app.host.querySelector('.ui-showcase-upcoming__flag')).not.toBeNull();
    expect(app.host.querySelector('.ui-showcase-upcoming__team')?.textContent).toBe(
      'Гран-при Лас-Вегаса',
    );
    expect(app.host.querySelector('.ui-showcase-upcoming__session')?.textContent).toBe(
      'Квалификация',
    );
    expect(app.host.querySelectorAll('.ui-showcase-crest')).toHaveLength(0);
  });

  it('names the whole plate when it opens', async () => {
    const onOpen = vi.fn();
    await app.render(
      <ShowcaseUpcomingCard
        kicker="1-е против 3-го"
        home={BAYERN}
        away={DORTMUND}
        meta="Бундеслига · через 1 д 7 ч"
        time="02:30"
        date="сб, 21 нояб."
        onOpen={onOpen}
      />,
    );
    const card = app.host.querySelector('.ui-showcase-upcoming')!;
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.getAttribute('aria-label')).toBe(
      '1-е против 3-го, Bayern München — Borussia Dortmund, сб, 21 нояб., 02:30',
    );
    await pressKey(card, 'Enter');
    await pressKey(card, ' ');
    await click(card);
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('names the race and its session and stays plain without onOpen', async () => {
    await app.render(
      <ShowcaseUpcomingCard
        race="Гран-при Лас-Вегаса"
        session="Квалификация"
        time="13:00"
        date="сб, 21 нояб."
      />,
    );
    const card = app.host.querySelector('.ui-showcase-upcoming')!;
    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('aria-label')).toBeNull();
    expect(app.host.querySelector('.ui-showcase-upcoming__kicker')).toBeNull();
    expect(app.host.querySelector('.ui-showcase-upcoming__meta')).toBeNull();
  });
});
