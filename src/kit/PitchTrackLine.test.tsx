// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PitchTrackLine } from './index';
import { createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

describe('PitchTrackLine', () => {
  it('is a decorative drawing with the pitch and the track', async () => {
    await app.render(<PitchTrackLine />);
    const svg = app.host.querySelector('.ui-pitch-track')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.classList.contains('ui-pitch-track--hero')).toBe(true);
    expect(svg.querySelectorAll('.ui-pitch-track__pitch path')).toHaveLength(3);
    expect(svg.querySelectorAll('.ui-pitch-track__pitch circle')).toHaveLength(3);
    expect(svg.querySelectorAll('.ui-pitch-track__spot')).toHaveLength(2);
    expect(svg.querySelectorAll('.ui-pitch-track__streaks rect')).toHaveLength(4);
    expect(svg.querySelector('.ui-pitch-track__surface')).not.toBeNull();
    expect(svg.querySelector('.ui-pitch-track__edge')).not.toBeNull();
    expect(svg.querySelector('.ui-pitch-track__kerb-shadow')).not.toBeNull();
    expect(svg.querySelectorAll('.ui-pitch-track__kerb-base')).toHaveLength(1);
    expect(svg.querySelectorAll('.ui-pitch-track__kerb-stripe')).toHaveLength(1);
  });

  it('keeps a flat week rail without a now position muted', async () => {
    await app.render(<PitchTrackLine variant="track" />);
    const svg = app.host.querySelector('.ui-pitch-track')!;
    expect(svg.classList.contains('ui-pitch-track--track')).toBe(true);
    expect(svg.querySelector('.ui-pitch-track__week-base')).not.toBeNull();
    expect(svg.querySelector('.ui-pitch-track__week-future')).toBeNull();
    expect(svg.querySelector('clipPath')).toBeNull();
  });

  it('draws the future part from the passed progress', async () => {
    await app.render(<PitchTrackLine variant="track" progress={0.25} />);
    const svg = app.host.querySelector('.ui-pitch-track')!;
    const clip = svg.querySelector('clipPath rect')!;
    expect(clip.getAttribute('x')).toBe('300');
    expect(clip.getAttribute('width')).toBe('900');
    expect(svg.querySelector('.ui-pitch-track__week-future')).not.toBeNull();
    expect(svg.querySelectorAll('.ui-pitch-track--track .ui-pitch-track__kerb-base')).toHaveLength(
      1,
    );
  });

  it('clamps the passed progress and hides the future at the very end', async () => {
    await app.render(<PitchTrackLine variant="track" progress={2} />);
    expect(app.host.querySelector('.ui-pitch-track__week-future')).toBeNull();
    await app.render(<PitchTrackLine variant="track" progress={-1} />);
    const clip = app.host.querySelector('clipPath rect')!;
    expect(clip.getAttribute('x')).toBe('0');
    expect(clip.getAttribute('width')).toBe('1200');
  });

  it('gives every drawing its own gradient and mask ids', async () => {
    await app.render(
      <>
        <PitchTrackLine />
        <PitchTrackLine />
      </>,
    );
    const masks = [...app.host.querySelectorAll('mask')].map((mask) => mask.getAttribute('id'));
    expect(new Set(masks).size).toBe(2);
  });
});
