// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { saveFavDrivers, saveFavTeams } from '../f1/prefs';
import { writeFavorites, writeRecent } from '../watch/watchShared';

afterEach(() => localStorage.clear());

it('notifies the profile mirror when F1 or viewing preferences change', () => {
  const changed = vi.fn();
  window.addEventListener('sportsdesk-storage-changed', changed);
  try {
    saveFavDrivers(['driver']);
    saveFavTeams(['team']);
    writeFavorites(new Set([1]));
    writeRecent([1]);
    expect(changed.mock.calls.map(([event]) => (event as CustomEvent).detail.key)).toEqual([
      'sportsdesk.f1.favDrivers',
      'sportsdesk.f1.favTeams',
      'sportsdesk.watch.favorites',
      'sportsdesk.watch.recent',
    ]);
  } finally {
    window.removeEventListener('sportsdesk-storage-changed', changed);
  }
});
