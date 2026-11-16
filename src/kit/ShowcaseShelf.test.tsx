// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShowcaseShelf } from './index';
import { click, createTestHost, pressKey } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

const cards = () => [
  <button type="button" key="one">
    Первая
  </button>,
  <button type="button" key="two">
    Вторая
  </button>,
  <button type="button" key="three">
    Третья
  </button>,
  <button type="button" key="four">
    Четвёртая
  </button>,
];

describe('ShowcaseShelf', () => {
  it('renders a titled list with the // mark and four cards', async () => {
    await app.render(
      <ShowcaseShelf title="Лучшее за неделю" emptyText="Пусто">
        {cards()}
      </ShowcaseShelf>,
    );
    expect(app.host.querySelector('.ui-showcase-shelf__mark')?.textContent).toBe('//');
    expect(app.host.querySelector('.ui-showcase-shelf__title-text')?.textContent).toBe(
      'Лучшее за неделю',
    );
    const row = app.host.querySelector('.ui-showcase-shelf__row')!;
    expect(row.getAttribute('role')).toBe('list');
    expect(row.children).toHaveLength(4);
    expect(row.children[0]?.getAttribute('role')).toBeNull();
  });

  it('shows the caller empty text instead of a row', async () => {
    await app.render(<ShowcaseShelf title="Главное впереди" emptyText="Матчей пока нет." />);
    expect(app.host.querySelector('.ui-showcase-shelf__row')).toBeNull();
    expect(app.host.querySelector('.ui-showcase-shelf__empty')?.textContent).toBe(
      'Матчей пока нет.',
    );
    expect(app.host.querySelector<HTMLButtonElement>('[aria-label="Вперёд"]')?.disabled).toBe(true);
  });

  it('disables the arrows at both ends of a short row', async () => {
    await app.render(
      <ShowcaseShelf title="Полка" emptyText="Пусто">
        {cards().slice(0, 2)}
      </ShowcaseShelf>,
    );
    const back = app.host.querySelector<HTMLButtonElement>('[aria-label="Назад"]')!;
    const forward = app.host.querySelector<HTMLButtonElement>('[aria-label="Вперёд"]')!;
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);
  });

  it('scrolls one visible page and enables the arrow at the other end', async () => {
    await app.render(
      <ShowcaseShelf title="Полка" emptyText="Пусто">
        {cards()}
      </ShowcaseShelf>,
    );
    const row = app.host.querySelector<HTMLElement>('.ui-showcase-shelf__row')!;
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 900 });
    const scrollBy = vi.fn();
    row.scrollBy = scrollBy as unknown as typeof row.scrollBy;
    await act(async () => {
      row.dispatchEvent(new Event('scroll'));
    });

    const back = app.host.querySelector<HTMLButtonElement>('[aria-label="Назад"]')!;
    const forward = app.host.querySelector<HTMLButtonElement>('[aria-label="Вперёд"]')!;
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(false);

    await click(forward);
    expect(scrollBy).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' });
  });

  it('moves focus with the arrows, Home and End', async () => {
    await app.render(
      <ShowcaseShelf title="Полка" emptyText="Пусто">
        {cards()}
      </ShowcaseShelf>,
    );
    const buttons = [...app.host.querySelectorAll('button')].filter(
      (button) => button.getAttribute('aria-label') === null,
    );
    const [first, second, , last] = buttons;
    await act(async () => {
      first!.focus();
    });
    expect(document.activeElement).toBe(first);

    await pressKey(first!, 'ArrowRight');
    expect(document.activeElement).toBe(second);

    await pressKey(second!, 'End');
    expect(document.activeElement).toBe(last);

    await pressKey(last!, 'Home');
    expect(document.activeElement).toBe(first);

    await pressKey(first!, 'ArrowLeft');
    expect(document.activeElement).toBe(first);
  });
});
