// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShowcaseBand } from './index';
import { createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

describe('ShowcaseBand', () => {
  it('draws the plate, the items separated by slanted lines and the action', async () => {
    await app.render(
      <ShowcaseBand
        title="Формула 1"
        items={[
          {
            label: 'Гонка недели',
            value: 'Гран-при Лас-Вегаса',
            sub: 'воскресенье, 22 ноября, 13:00',
          },
          { label: 'До следующей сессии', value: <span className="timer-stub">14:00:00</span> },
        ]}
        action={<button type="button">Открыть уикенд</button>}
      />,
    );
    const band = app.host.querySelector('.ui-showcase-band')!;
    expect(band.getAttribute('aria-label')).toBe('Формула 1');
    expect(app.host.querySelector('.ui-showcase-band__plate')?.textContent).toBe('Формула 1');
    expect(app.host.querySelectorAll('.ui-showcase-band__mark')).toHaveLength(2);
    expect(app.host.querySelector('.ui-showcase-band__checks')).not.toBeNull();

    expect(app.host.querySelectorAll('.ui-showcase-band__item')).toHaveLength(2);
    expect(
      [...app.host.querySelectorAll('.ui-showcase-band__label')].map((label) => label.textContent),
    ).toEqual(['Гонка недели', 'До следующей сессии']);
    expect(
      [...app.host.querySelectorAll('.ui-showcase-band__value')].map((value) => value.textContent),
    ).toEqual(['Гран-при Лас-Вегаса', '14:00:00']);
    expect(app.host.querySelectorAll('.ui-showcase-band__sep')).toHaveLength(1);
    expect(app.host.querySelector('.ui-showcase-band__sub')?.textContent).toBe(
      'воскресенье, 22 ноября, 13:00',
    );
    expect(app.host.querySelectorAll('.ui-showcase-band__action button')).toHaveLength(1);
  });

  it('leaves out an empty sub and an absent action', async () => {
    await app.render(
      <ShowcaseBand
        title="Формула 1"
        items={[
          { label: 'Гонка недели', value: 'Гран-при Лас-Вегаса', sub: '' },
          { label: 'Сессия', value: 'Практика 1', sub: null },
        ]}
      />,
    );
    expect(app.host.querySelector('.ui-showcase-band__sub')).toBeNull();
    expect(app.host.querySelector('.ui-showcase-band__action')).toBeNull();
    expect(app.host.querySelectorAll('.ui-showcase-band__sep')).toHaveLength(1);
  });
});
