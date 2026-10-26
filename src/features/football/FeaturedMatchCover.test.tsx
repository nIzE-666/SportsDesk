// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { FeaturedMatchCover, selectFeaturedMatch } from './FeaturedMatchCover';
import type { MatchSummary } from './types';

const match = (id: string, status: string, day: string): MatchSummary => ({
  id,
  status,
  time_utc: `2026-10-${day}T12:00:00Z`,
  home_team: { id: 'home', name: 'Домашняя команда' },
  away_team: { id: 'away', name: 'Гости' },
  score_home: 2,
  score_away: 1,
});
it('prioritizes a live fixture and the newest favorite result without mutating cached matches', () => {
  const rows = [
    match('old', 'finished', '18'),
    match('new', 'finished', '25'),
    match('live', 'live', '26'),
  ];
  expect(selectFeaturedMatch(rows)?.id).toBe('live');
  expect(selectFeaturedMatch(rows.slice(0, 2), (m) => m.id === 'old')?.id).toBe('old');
  expect(selectFeaturedMatch(rows.slice(0, 2))?.id).toBe('new');
  expect(rows.map((m) => m.id)).toEqual(['old', 'new', 'live']);
});
it('uses the nearest scheduled game and leaves an empty/cancelled season without a fabricated focus', () => {
  const rows = [match('later', 'scheduled', '31'), match('next', 'scheduled', '28')];
  expect(selectFeaturedMatch(rows)?.id).toBe('next');
  expect(selectFeaturedMatch([])).toBeUndefined();
  expect(selectFeaturedMatch([match('cancelled', 'cancelled', '24')])).toBeUndefined();
});
it('does not present preliminary zeroes as a played score or replace a missing final score', () => {
  const props = { league: 'Тестовая лига', onOpenMatch: vi.fn(), onSeeAllMatches: vi.fn() };
  const future = { ...match('future', 'scheduled', '30'), score_home: 0, score_away: 0 };
  const markup = renderToStaticMarkup(<FeaturedMatchCover {...props} match={future} />);
  expect(markup).toContain('Матч ещё не начался');
  expect(markup).not.toContain('0 : 0');
  const missing = { ...match('missing', 'finished', '24'), score_home: null, score_away: null };
  expect(renderToStaticMarkup(<FeaturedMatchCover {...props} match={missing} />)).toContain(
    '— : —',
  );
});

it('keeps fixtures without kickoff times behind confirmed upcoming games', () => {
  const unknown = { ...match('unknown', 'scheduled', '31'), time_utc: undefined, date: undefined };
  const confirmed = match('confirmed', 'scheduled', '29');
  expect(selectFeaturedMatch([unknown, confirmed])?.id).toBe('confirmed');
  expect(selectFeaturedMatch([unknown])?.id).toBe('unknown');
});
