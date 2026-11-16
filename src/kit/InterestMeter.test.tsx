// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InterestMeter } from './index';
import { createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

describe('InterestMeter', () => {
  it('shows five segments and fills the passed value', async () => {
    await app.render(<InterestMeter value={4} />);
    const meter = app.host.querySelector('.ui-interest')!;
    expect(meter.getAttribute('aria-label')).toBe('Интерес: 4 из 5');
    expect(meter.getAttribute('role')).toBe('img');
    expect(meter.querySelectorAll('.ui-interest__segment')).toHaveLength(5);
    expect(meter.querySelectorAll('.ui-interest__segment--on')).toHaveLength(4);
  });

  it('fills all five segments for the top value', async () => {
    await app.render(<InterestMeter value={5} />);
    expect(app.host.querySelectorAll('.ui-interest__segment--on')).toHaveLength(5);
  });

  it('renders nothing for an unknown value', async () => {
    await app.render(<InterestMeter value={null} />);
    expect(app.host.querySelector('.ui-interest')).toBeNull();
    expect(app.host.textContent).toBe('');
  });

  it('renders nothing for a value outside the scale', async () => {
    await app.render(<InterestMeter value={0} />);
    expect(app.host.querySelector('.ui-interest')).toBeNull();
    await app.render(<InterestMeter value={6} />);
    expect(app.host.querySelector('.ui-interest')).toBeNull();
  });
});
