// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MatchStrip } from './index';
import { createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

const goals = () => [...app.host.querySelectorAll('.ui-match-strip__goal')];
const minutes = () =>
  [...app.host.querySelectorAll('.ui-match-strip__minute')].map((element) => element.textContent);

describe('MatchStrip', () => {
  it('places home goals above the line and away goals below it', async () => {
    await app.render(
      <MatchStrip
        goals={[
          { minute: 12, side: 'home' },
          { minute: 34, side: 'away' },
        ]}
      />,
    );
    const [home, away] = goals();
    expect(home?.classList.contains('ui-match-strip__goal--home')).toBe(true);
    expect(away?.classList.contains('ui-match-strip__goal--away')).toBe(true);
  });

  it('reads the minute and the added time', async () => {
    await app.render(
      <MatchStrip
        goals={[
          { minute: 12, side: 'home' },
          { minute: 90, extra: 2, side: 'away' },
        ]}
      />,
    );
    expect(minutes()).toEqual(['12′', '90+2′']);
  });

  it('positions goals by the match length', async () => {
    await app.render(<MatchStrip goals={[{ minute: 45, side: 'home' }]} length={90} />);
    expect(goals()[0]?.classList.contains('ui-match-strip__goal--p50')).toBe(true);

    await app.render(<MatchStrip goals={[{ minute: 45, side: 'home' }]} length={120} />);
    expect(goals()[0]?.classList.contains('ui-match-strip__goal--p40')).toBe(true);
  });

  it('clamps added time to the end of the bar', async () => {
    await app.render(<MatchStrip goals={[{ minute: 90, extra: 2, side: 'home' }]} length={90} />);
    expect(goals()[0]?.classList.contains('ui-match-strip__goal--p100')).toBe(true);
  });

  it('does not draw a goal without a minute and says how many there are', async () => {
    await app.render(
      <MatchStrip
        goals={[
          { minute: 12, side: 'home' },
          { minute: null, side: 'away' },
          { minute: null, side: 'away' },
        ]}
      />,
    );
    expect(goals()).toHaveLength(1);
    expect(app.host.textContent).toContain('Голов без минуты: 2');
  });

  it('says that there are no goals to a screen reader', async () => {
    await app.render(<MatchStrip goals={[]} />);
    expect(goals()).toHaveLength(0);
    expect(app.host.textContent).toContain('голов нет');
  });

  it('skips a negative minute and counts it as unknown', async () => {
    await app.render(<MatchStrip goals={[{ minute: -5, side: 'home' }]} />);
    expect(goals()).toHaveLength(0);
    expect(app.host.textContent).toContain('Голов без минуты: 1');
  });

  it('writes every minute while there are three goals or fewer', async () => {
    await app.render(
      <MatchStrip
        goals={[
          { minute: 12, side: 'home' },
          { minute: 34, side: 'away' },
          { minute: 88, side: 'home', key: true },
        ]}
      />,
    );
    const hidden = app.host.querySelectorAll('.ui-match-strip__minute.ui-showcase-visually-hidden');
    expect(hidden).toHaveLength(0);
    expect(minutes()).toEqual(['12′', '34′', '88′']);
  });

  it('writes only the key minutes on a busy bar', async () => {
    await app.render(
      <MatchStrip
        goals={[
          { minute: 12, side: 'home' },
          { minute: 34, side: 'away' },
          { minute: 56, side: 'home' },
          { minute: 78, side: 'away' },
          { minute: 90, extra: 3, side: 'home', key: true },
        ]}
      />,
    );
    const labels = [...app.host.querySelectorAll('.ui-match-strip__minute')];
    expect(labels.map((label) => label.textContent)).toEqual(['12′', '34′', '56′', '78′', '90+3′']);
    expect(labels.map((label) => label.classList.contains('ui-showcase-visually-hidden'))).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});
