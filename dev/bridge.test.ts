import { describe, expect, it } from 'vitest';
import { ttlFor, validPath } from './bridge';

describe('livescore bridge paths', () => {
  it('accepts only the two public app endpoints with a whole offset in range', () => {
    for (const path of [
      'date/soccer/20261108/-12?MD=1',
      'date/soccer/20261108/0?MD=1',
      'date/soccer/20261108/14?MD=1',
      'live/soccer/-12?MD=1',
      'live/soccer/0?MD=1',
      'live/soccer/14?MD=1',
    ])
      expect(validPath('livescore', path), path).toBe(true);
    for (const path of [
      'date/soccer/20261108/15?MD=1',
      'date/soccer/20261108/-13?MD=1',
      'date/soccer/20261108/9',
      'date/soccer/20261108/9?MD=2',
      'date/soccer/20261108/9?MD=1&x=1',
      'date/soccer/20261308/9?MD=1',
      'date/soccer/2026118/9?MD=1',
      'date/soccer/20261108/+9?MD=1',
      'date/soccer/20261108/9.0?MD=1',
      'date/soccer/20261108/9/extra?MD=1',
      'live/soccer/9?MD=1&x=1',
      'live/soccer/15?MD=1',
      'live/soccer/9',
      'live/soccer/+9?MD=1',
      'live/soccer/9.0?MD=1',
      'live/soccer/9/extra?MD=1',
      'live/rugby/9?MD=1',
    ])
      expect(validPath('livescore', path), path).toBe(false);
  });

  it('does not narrow the other sources', () => {
    expect(validPath('espn', 'eng.1/scoreboard?dates=20261108')).toBe(true);
    expect(validPath('pitch', 'leagues/l_4WFCIZ/matches?status=all')).toBe(true);
    expect(validPath('livescore', 'eng.1/scoreboard?dates=20261108')).toBe(false);
  });
});

describe('livescore cache times', () => {
  it('keeps a day for ten minutes and live data for thirty seconds', () => {
    expect(ttlFor('livescore', 'date/soccer/20261108/9?MD=1', {})).toBe(600_000);
    expect(ttlFor('livescore', 'live/soccer/9?MD=1', {})).toBe(30_000);
    expect(ttlFor('espn', 'eng.1/scoreboard?dates=20261108', {})).toBe(60_000);
  });
});
