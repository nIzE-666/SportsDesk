// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SeasonPlayerPanel } from './SeasonPlayerPanel';
import type { PlayerSeasonStats } from './playerAnalytics';
import type { MatchSummary } from './types';

const analytics = vi.hoisted(() => ({ fetchPlayerSeasonStats: vi.fn() }));
vi.mock('./playerAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./playerAnalytics')>()),
  fetchPlayerSeasonStats: analytics.fetchPlayerSeasonStats,
}));

const match: MatchSummary = {
  id: 'season-match',
  status: 'finished',
  date: '2026-10-20',
  time_utc: '2026-10-20T18:00:00Z',
  home_team: { id: 'club', name: 'Club' },
  away_team: { id: 'rival', name: 'Rival' },
  score_home: 1,
  score_away: 0,
};
const stats: PlayerSeasonStats = {
  metrics: [
    { key: 'goals', label: 'Goals', type: 'number', value: 2, matches: 1, kind: 'total' },
    { key: 'assists', label: 'Assists', type: 'number', value: 1, matches: 1, kind: 'total' },
  ],
  matches: [{ id: match.id, date: match.date, minutes: 90, rating: 7.5 }],
  scanned: 1,
  available: 1,
  failed: 0,
  totalCandidates: 1,
  minutes: 90,
  fetchedAt: null,
  stale: false,
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  analytics.fetchPlayerSeasonStats.mockReset();
  analytics.fetchPlayerSeasonStats.mockResolvedValue(stats);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('separates the coverage and per-90 parts of a season tile note', async () => {
  await act(async () =>
    root.render(
      <SeasonPlayerPanel
        playerId="player"
        teamId="club"
        teamName="Club"
        matches={[match]}
        onOpenMatch={() => {}}
      />,
    ),
  );
  const start = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Собрать статистику по матчам',
  )!;
  await act(async () => start.click());
  const notes = [...host.querySelectorAll<HTMLElement>('.ui-stat__note')].map((note) =>
    (note.textContent ?? '').replace(/\s+/gu, ' ').trim(),
  );
  expect(notes).toEqual([
    'Есть данные в 1 матче · 2 / 90 минут',
    'Есть данные в 1 матче · 1 / 90 минут',
  ]);
});
