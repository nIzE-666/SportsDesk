// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatTile } from './index';
import { createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

describe('StatTile', () => {
  it('renders a label, a value and a note', async () => {
    await app.render(<StatTile label="Просмотров" value="12" note="за месяц" />);
    expect(app.host.querySelector('.ui-stat__label')?.textContent).toBe('Просмотров');
    expect(app.host.querySelector('.ui-stat__value')?.textContent).toBe('12');
    expect(app.host.querySelector('.ui-stat__note')?.textContent).toBe('за месяц');
  });

  it('renders nothing without a value, but keeps zero', async () => {
    await app.render(<StatTile label="Просмотров" />);
    expect(app.host.innerHTML).toBe('');
    await app.render(<StatTile label="Просмотров" value="" />);
    expect(app.host.innerHTML).toBe('');
    await app.render(<StatTile label="Просмотров" value={0} />);
    expect(app.host.querySelector('.ui-stat__value')?.textContent).toBe('0');
  });
});
