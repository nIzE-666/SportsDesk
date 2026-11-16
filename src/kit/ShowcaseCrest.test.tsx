// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShowcaseCrest, crestInitials } from './index';
import { createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

describe('crestInitials', () => {
  it('takes the first letters of the first and last words', () => {
    expect(crestInitials('Manchester United')).toBe('MU');
    expect(crestInitials('Арсенал')).toBe('АР');
    expect(crestInitials('  Inter   Miami CF  ')).toBe('IC');
  });

  it('has a fallback for an empty name', () => {
    expect(crestInitials('   ')).toBe('?');
  });
});

describe('ShowcaseCrest', () => {
  it('draws the real crest image and is decorative', async () => {
    await app.render(
      <ShowcaseCrest
        team={{ name: 'Арсенал', imageUrl: 'https://example.test/arsenal.webp' }}
        size="hero"
      />,
    );
    const wrapper = app.host.querySelector('.ui-showcase-crest')!;
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper.classList.contains('ui-showcase-crest--hero')).toBe(true);
    const image = wrapper.querySelector<HTMLImageElement>('.ui-showcase-crest__image')!;
    expect(image.getAttribute('src')).toBe('https://example.test/arsenal.webp');
    expect(image.getAttribute('alt')).toBe('');
    expect(wrapper.querySelector('.ui-showcase-crest__initials')).toBeNull();
  });

  it('shows the initials and the requested size without an image', async () => {
    await app.render(<ShowcaseCrest team={{ name: 'Челси' }} size="tip" />);
    const wrapper = app.host.querySelector('.ui-showcase-crest')!;
    expect(wrapper.classList.contains('ui-showcase-crest--tip')).toBe(true);
    expect(wrapper.querySelector('.ui-showcase-crest__image')).toBeNull();
    expect(wrapper.querySelector('.ui-showcase-crest__initials')?.textContent).toBe('ЧЕ');
  });

  it('falls back to the initials after a load error and retries a new address', async () => {
    await app.render(
      <ShowcaseCrest team={{ name: 'Арсенал', imageUrl: 'https://example.test/broken.webp' }} />,
    );
    const image = app.host.querySelector<HTMLImageElement>('.ui-showcase-crest__image')!;
    await act(async () => {
      image.dispatchEvent(new Event('error'));
    });
    expect(app.host.querySelector('.ui-showcase-crest__image')).toBeNull();
    expect(app.host.querySelector('.ui-showcase-crest__initials')?.textContent).toBe('АР');

    await app.render(
      <ShowcaseCrest team={{ name: 'Арсенал', imageUrl: 'https://example.test/good.webp' }} />,
    );
    expect(
      app.host.querySelector<HTMLImageElement>('.ui-showcase-crest__image')?.getAttribute('src'),
    ).toBe('https://example.test/good.webp');
  });
});
