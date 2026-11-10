// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LivePanel } from './LivePanel';

vi.mock('../../lib/bridge', () => ({
  api: vi.fn(async () => ({
    payload: {
      matches: [
        { home: 'Arsenal', away: 'Visitor', competition: 'Other Cup', status: 'live' },
        { home: 'Everton', away: 'Chelsea', competition: 'Premier League', status: 'live' },
        { home: 'Other', away: 'Teams', competition: 'Jamaica Premier League', status: 'live' },
        { home: 'Unknown', away: 'Sides', status: 'finished' },
      ],
    },
    fetchedAt: '2026-11-10T00:00:00Z',
    stale: true,
  })),
  openExternal: vi.fn(),
}));
vi.mock('./FavoritesProvider', () => ({
  useFavorites: () => ({ favoriteTeamNames: ['Arsenal'] }),
  matchInvolvesFavorite: (home?: string, away?: string, names: string[] = []) =>
    names.includes(home ?? '') || names.includes(away ?? ''),
}));

it('limits every filter to followed competitions or favorite teams', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LivePanel />));
    expect(host.textContent).toContain('Arsenal');
    expect(host.textContent).toContain('Everton');
    expect(host.textContent).not.toContain('Jamaica Premier League');
    expect(host.textContent).not.toContain('Unknown');
    expect(host.textContent).toContain('Все (2)');
    expect(host.querySelectorAll('.source-foot')).toHaveLength(1);
    expect(host.querySelector('.source-foot')?.textContent).toContain('устаревшими');
    expect(host.querySelector('.dashboard-head')?.textContent).not.toContain('обновлено');
    const live = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Live (2)'),
    )!;
    await act(async () => live.click());
    expect(host.querySelectorAll('.live-flat')).toHaveLength(2);
    const favorites = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Избранные (1)'),
    )!;
    await act(async () => favorites.click());
    expect(host.querySelectorAll('.live-flat')).toHaveLength(1);
    expect(host.textContent).toContain('Arsenal');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
