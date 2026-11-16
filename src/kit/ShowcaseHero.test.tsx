// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShowcaseHero } from './index';
import { createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

const HOME = { name: 'Арсенал' };
const AWAY = { name: 'Челси' };

describe('ShowcaseHero', () => {
  it('renders the slots and the decorative background', async () => {
    await app.render(
      <ShowcaseHero
        kicker="Главный матч"
        title="Арсенал — Челси"
        meta="через 2 дня · 14:05:32"
        actions={<button type="button">Буду смотреть</button>}
        home={HOME}
        away={AWAY}
      />,
    );
    expect(app.host.querySelector('.ui-showcase-hero__kicker')?.textContent).toBe('Главный матч');
    expect(app.host.querySelectorAll('.ui-showcase-hero__kicker-mark')).toHaveLength(2);
    expect(app.host.querySelector('.ui-showcase-hero__title')?.textContent).toBe('Арсенал — Челси');
    expect(app.host.querySelector('.ui-showcase-hero__meta')?.textContent).toBe(
      'через 2 дня · 14:05:32',
    );
    expect(app.host.querySelectorAll('.ui-showcase-hero__actions button')).toHaveLength(1);
    const line = app.host.querySelector('.ui-showcase-hero__line');
    expect(line?.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to initials when a crest image is missing', async () => {
    await app.render(<ShowcaseHero title="Арсенал — Челси" home={HOME} away={AWAY} />);
    const initials = [...app.host.querySelectorAll('.ui-showcase-hero__crest-initials')].map(
      (element) => element.textContent,
    );
    expect(initials).toEqual(['АР', 'ЧЕ']);
    expect(app.host.querySelector('.ui-showcase-hero__crest-image')).toBeNull();
  });

  it('renders a crest image and falls back after a load error', async () => {
    await app.render(
      <ShowcaseHero
        title="Арсенал — Челси"
        home={{ name: 'Арсенал', imageUrl: 'https://example.test/arsenal.webp' }}
        away={AWAY}
      />,
    );
    const image = app.host.querySelector<HTMLImageElement>('.ui-showcase-hero__crest-image')!;
    expect(image.getAttribute('src')).toBe('https://example.test/arsenal.webp');
    expect(image.getAttribute('alt')).toBe('');
    await act(async () => {
      image.dispatchEvent(new Event('error'));
    });
    expect(app.host.querySelector('.ui-showcase-hero__crest-image')).toBeNull();
    expect(app.host.querySelector('.ui-showcase-hero__crest-initials')?.textContent).toBe('АР');
  });

  it('keeps the split neutral without team colours', async () => {
    await app.render(<ShowcaseHero title="Арсенал — Челси" home={HOME} away={AWAY} />);
    const halves = [...app.host.querySelectorAll('.ui-showcase-hero__split-half')];
    expect(halves[0]?.classList.contains('ui-showcase-hero__split-half--home')).toBe(true);
    expect(halves[1]?.classList.contains('ui-showcase-hero__split-half--away')).toBe(true);
    expect(halves[0]?.getAttribute('fill')).toBeNull();
    expect(halves[1]?.getAttribute('fill')).toBeNull();
  });

  it('paints the split in the team colours when they are known', async () => {
    await app.render(
      <ShowcaseHero
        title="Арсенал — Челси"
        home={HOME}
        away={AWAY}
        homeColor="#c8102e"
        awayColor="#1d4f9e"
      />,
    );
    const halves = [...app.host.querySelectorAll('.ui-showcase-hero__split-half')];
    expect(halves[0]?.getAttribute('fill')).toBe('#c8102e');
    expect(halves[1]?.getAttribute('fill')).toBe('#1d4f9e');
    expect(halves[0]?.classList.contains('ui-showcase-hero__split-half--home')).toBe(false);
  });
});
