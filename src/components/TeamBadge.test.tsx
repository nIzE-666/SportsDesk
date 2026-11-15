// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHost } from '../kit/testHost';
import { TeamBadge } from './TeamBadge';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

describe('TeamBadge', () => {
  it('keeps the fallback badge neutral without a side', async () => {
    await app.render(<TeamBadge name="Arsenal" />);
    const badge = app.host.querySelector('.team-badge-fallback');
    expect(badge?.textContent).toBe('AR');
    expect(badge?.className).not.toContain('team-badge-fallback--home');
    expect(badge?.className).not.toContain('team-badge-fallback--away');
  });

  it('marks the fallback badge for the home or away side', async () => {
    await app.render(<TeamBadge name="Arsenal" side="home" />);
    expect(app.host.querySelector('.team-badge-fallback--home')?.textContent).toBe('AR');
    await app.render(<TeamBadge name="Chelsea" side="away" />);
    expect(app.host.querySelector('.team-badge-fallback--away')?.textContent).toBe('CH');
  });
});
