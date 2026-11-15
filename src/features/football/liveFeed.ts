import { api, isTauriRuntime, rpc } from '../../lib/bridge';
import {
  classifyMatchStatus,
  matchesFavoriteIdentity,
  teamMatchesFavorite,
} from '../../lib/sportsIdentity';
import { resolveFavoriteTeamNames, resolveFavoriteTeams } from './usePoller';
import type { ApiFailure } from '../../lib/apiError';
import type { MatchSummary } from './types';
export interface LiveMatch {
  id: string;
  home_id: string;
  away_id: string;
  home?: string;
  away?: string;
  home_score?: number | null;
  away_score?: number | null;
  status?: string;
  status_text?: string;
  time?: string;
  competition?: string;
}
export interface LiveFeed {
  matches: LiveMatch[];
  fetchedAt: string | null;
  stale: boolean;
  failure?: ApiFailure | null;
}
export async function loadLiveFeed(automatic = false): Promise<LiveFeed> {
  if (isTauriRuntime()) return rpc<LiveFeed>('get_live_feed');
  const teams = resolveFavoriteTeams(),
    names = resolveFavoriteTeamNames();
  const replies = await Promise.all(
    [-1, 0, 1].map((n) => {
      const date = new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
      return api('pitch', `date/${date}?status=all`, { automatic });
    }),
  );
  const schedules = await Promise.allSettled(
    [...new Set(teams.flatMap((t) => (t.leagueId ? [t.leagueId] : [])))].map((id) =>
      api('pitch', `leagues/${id}/matches?status=all`, { automatic }),
    ),
  );
  const matches = new Map<string, LiveMatch>();
  for (const reply of [
    ...schedules.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
    ...replies,
  ]) {
    const data = reply.payload?.data ?? reply.payload;
    for (const m of (data?.matches ?? []) as MatchSummary[]) {
      const favorite = (t: MatchSummary['home_team']) =>
        matchesFavoriteIdentity(t, teams, 'pitch') ||
        names
          .filter((n) => !teams.some((t) => teamMatchesFavorite(t.name, [n])))
          .some((n) => teamMatchesFavorite(t.name, [n]));
      if (
        !m?.id ||
        !m.home_team ||
        !m.away_team ||
        (!favorite(m.home_team) && !favorite(m.away_team))
      )
        continue;
      matches.set(m.id, {
        id: m.id,
        home_id: m.home_team.id,
        away_id: m.away_team.id,
        home: m.home_team.name,
        away: m.away_team.name,
        home_score: m.score_home,
        away_score: m.score_away,
        status: m.status,
        status_text: m.status_text,
        time: m.time_utc,
      });
    }
  }
  return {
    matches: [...matches.values()].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')),
    fetchedAt: replies[0]?.fetchedAt ?? null,
    stale: replies.some((r) => r.stale),
    failure: replies.find((r) => r.failure)?.failure,
  };
}
export const isLiveFixture = (m: LiveMatch) =>
  classifyMatchStatus(m.status, m.status_text) === 'live';

const NUMERIC_MINUTE = /^\d{1,3}(?:'\+\d{1,2}|\+\d{1,2}|)'$/;

/** `HT` reads as a word; an unfamiliar live label is left out instead of shown raw. */
export function minuteLabel(minute: string | null): string | null {
  if (!minute) return null;
  if (minute === 'HT') return 'Перерыв';
  return NUMERIC_MINUTE.test(minute) ? minute : null;
}
