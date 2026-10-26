import { ArrowUpRight } from 'lucide-react';
import { EventCover } from '../../components/EventCover';
import TeamBadge from '../../components/TeamBadge';
import { classifyMatchStatus, matchStateLabel } from '../../lib/sportsIdentity';
import { formatDateTime, getUserTimezone } from './storage';
import type { MatchSummary } from './types';

export function selectFeaturedMatch(
  matches: MatchSummary[],
  favorite: (match: MatchSummary) => boolean = () => false,
): MatchSummary | undefined {
  const time = (m: MatchSummary, missing: number) => {
    const parsed = Date.parse(m.time_utc ?? m.date ?? '');
    return Number.isFinite(parsed) ? parsed : missing;
  };
  const live = matches.filter((m) => classifyMatchStatus(m.status) === 'live');
  const results = matches
    .filter((m) => classifyMatchStatus(m.status) === 'finished')
    .sort((a, b) => time(b, 0) - time(a, 0));
  const upcoming = matches
    .filter((m) => classifyMatchStatus(m.status) === 'scheduled')
    .sort((a, b) => time(a, Number.MAX_SAFE_INTEGER) - time(b, Number.MAX_SAFE_INTEGER));
  return (
    live.find(favorite) ??
    live[0] ??
    results.find(favorite) ??
    upcoming.find(favorite) ??
    results[0] ??
    upcoming[0]
  );
}

export function FeaturedMatchCover({
  match,
  league,
  season,
  loading = false,
  sport = 'football',
  onOpenMatch,
  onSeeAllMatches,
}: {
  match?: MatchSummary;
  league: string;
  season?: string;
  loading?: boolean;
  sport?: 'football' | 'ucl';
  onOpenMatch: (id: string) => void;
  onSeeAllMatches: () => void;
}) {
  const state = match ? classifyMatchStatus(match.status) : 'unknown';
  const scored = state === 'live' || state === 'finished';
  const score =
    match && scored
      ? typeof match.score_home === 'number' &&
        Number.isFinite(match.score_home) &&
        typeof match.score_away === 'number' &&
        Number.isFinite(match.score_away)
        ? `${match.score_home} : ${match.score_away}`
        : '— : —'
      : 'VS';
  return (
    <EventCover sport={sport} eyebrow={`${league}${season ? ` · ${season}` : ''}`}>
      {match ? (
        <>
          <div className="event-cover-teams">
            <div className="event-cover-team">
              <TeamBadge
                name={match.home_team.name}
                imageUrl={match.home_team.image_url}
                size={32}
              />
              <span>{match.home_team.name}</span>
            </div>
            <div className="event-cover-team">
              <TeamBadge
                name={match.away_team.name}
                imageUrl={match.away_team.image_url}
                size={32}
              />
              <span>{match.away_team.name}</span>
            </div>
          </div>
          <div
            className="event-cover-score"
            aria-label={scored ? `Счёт ${score}` : 'Матч ещё не начался'}
          >
            {score}
          </div>
          <p>
            {formatDateTime(match.time_utc ?? match.date, getUserTimezone())}
            {match.round_name ? ` · ${match.round_name}` : ''}
          </p>
          <div className="event-cover-actions">
            <button className="primary-btn" onClick={() => onOpenMatch(match.id)}>
              {state === 'finished' ? 'Разбор матча' : 'Открыть матч'} <ArrowUpRight size={16} />
            </button>
            <span className={`event-cover-status ${state === 'live' ? 'live' : ''}`}>
              {matchStateLabel(match.status)}
            </span>
          </div>
        </>
      ) : (
        <>
          <h2>{loading ? 'Собираем ваш спортивный день' : 'Матчи выбранной лиги'}</h2>
          <p>
            {loading
              ? 'Загружаем расписание и результаты.'
              : 'Доступные встречи и состояние источника показаны ниже.'}
          </p>
          <button className="primary-btn" onClick={onSeeAllMatches}>
            Все матчи <ArrowUpRight size={16} />
          </button>
        </>
      )}
    </EventCover>
  );
}
