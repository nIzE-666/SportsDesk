// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShowcaseMatchCard } from './index';
import { click, createTestHost, pressKey } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

const HOME = { name: 'Манчестер Юнайтед', score: 3 };
const AWAY = { name: 'Рома', score: 2 };

function render(onOpen?: () => void) {
  return (
    <ShowcaseMatchCard
      competition="Лига чемпионов"
      day="вт"
      home={HOME}
      away={AWAY}
      interest={4}
      reasons={['камбэк с 0:2', 'победный на 88′']}
      goals={[
        { minute: 12, side: 'away' },
        { minute: 58, side: 'home' },
        { minute: 88, side: 'home', key: true },
      ]}
      onOpen={onOpen}
    />
  );
}

describe('ShowcaseMatchCard', () => {
  it('draws the score bug, the reason chips and the goals', async () => {
    await app.render(render());
    expect(app.host.querySelector('.ui-showcase-card__top')?.textContent).toBe('Лига чемпионоввт');
    expect(
      [...app.host.querySelectorAll('.ui-showcase-card__name')].map((name) => name.textContent),
    ).toEqual(['Манчестер Юнайтед', 'Рома']);
    expect(
      [...app.host.querySelectorAll('.ui-showcase-board__digit')].map((digit) => digit.textContent),
    ).toEqual(['3', '2']);
    expect(app.host.querySelectorAll('.ui-showcase-crest')).toHaveLength(2);
    expect(app.host.querySelectorAll('.ui-showcase-card__chip')).toHaveLength(2);
    expect(app.host.querySelector('.ui-interest')?.getAttribute('aria-label')).toBe(
      'Интерес: 4 из 5',
    );
    expect(app.host.querySelectorAll('.ui-match-strip__goal')).toHaveLength(3);
    expect(app.host.querySelector('.ui-match-strip__goal--key')).not.toBeNull();
  });

  it('dims the losing side and its digit', async () => {
    await app.render(render());
    const teams = [...app.host.querySelectorAll('.ui-showcase-card__team')];
    expect(teams[0]?.classList.contains('ui-showcase-card__team--lost')).toBe(false);
    expect(teams[1]?.classList.contains('ui-showcase-card__team--lost')).toBe(true);
    const digits = [...app.host.querySelectorAll('.ui-showcase-board__digit')];
    expect(digits[0]?.classList.contains('ui-showcase-board__digit--dim')).toBe(false);
    expect(digits[1]?.classList.contains('ui-showcase-board__digit--dim')).toBe(true);
  });

  it('shows a dash for an unknown score and dims nobody', async () => {
    await app.render(
      <ShowcaseMatchCard
        competition="Премьер-лига"
        home={{ name: 'Арсенал', score: null }}
        away={{ name: 'Челси', score: 1 }}
        interest={null}
      />,
    );
    expect(
      [...app.host.querySelectorAll('.ui-showcase-board__digit')].map((digit) => digit.textContent),
    ).toEqual(['–', '1']);
    expect(app.host.querySelectorAll('.ui-showcase-card__team--lost')).toHaveLength(0);
    expect(app.host.querySelectorAll('.ui-showcase-board__digit--dim')).toHaveLength(0);
    expect(app.host.querySelector('.ui-interest')).toBeNull();
  });

  it('opens with Enter and Space when onOpen is given', async () => {
    const onOpen = vi.fn();
    await app.render(render(onOpen));
    const card = app.host.querySelector('.ui-showcase-card')!;
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.getAttribute('aria-label')).toBe('Манчестер Юнайтед 3:2 Рома, Лига чемпионов');

    await pressKey(card, 'Enter');
    await pressKey(card, ' ');
    await click(card);
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('stays a plain article without onOpen', async () => {
    await app.render(render());
    const card = app.host.querySelector('.ui-showcase-card')!;
    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('tabindex')).toBeNull();
    expect(card.getAttribute('aria-label')).toBeNull();
    await pressKey(card, 'Enter');
    expect(app.host.querySelector('.ui-showcase-card--open')).toBeNull();
  });
});
