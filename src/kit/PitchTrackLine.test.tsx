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
    expect(svg.querySelector('.ui-pitch-track__pitch rect')).not.toBeNull();
    expect(svg.querySelector('.ui-pitch-track__pitch circle')).not.toBeNull();
    expect(svg.querySelector('.ui-pitch-track__pitch line')).not.toBeNull();
    expect(svg.querySelector('.ui-pitch-track__pitch-tint')).not.toBeNull();
    expect(svg.querySelectorAll('.ui-pitch-track__kerb-white').length).toBe(2);
    expect(svg.querySelectorAll('.ui-pitch-track__kerb-red').length).toBe(2);
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
  });

  it('clamps the passed progress and hides the future at the very end', async () => {
    await app.render(<PitchTrackLine variant="track" progress={2} />);
    expect(app.host.querySelector('.ui-pitch-track__week-future')).toBeNull();
    await app.render(<PitchTrackLine variant="track" progress={-1} />);
    const clip = app.host.querySelector('clipPath rect')!;
    expect(clip.getAttribute('x')).toBe('0');
    expect(clip.getAttribute('width')).toBe('1200');
  });
});
