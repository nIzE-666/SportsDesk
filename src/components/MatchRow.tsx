import { ChevronRight } from 'lucide-react';
import TeamBadge from './TeamBadge';
import type { MatchSummary } from '../features/football/types';
import { formatDateTime, getUserTimezone } from '../features/football/storage';
import { classifyMatchStatus } from '../lib/sportsIdentity';

export function MatchRow({
  match: m,
  onClick,
  compact = false,
}: {
  match: MatchSummary;
  onClick: () => void;
  compact?: boolean;
}) {
  const state = classifyMatchStatus(m.status),
    finished = state === 'finished',
    live = state === 'live';
  return (
    <button
      className={`game-row ${compact ? 'compact' : ''}`}
      onClick={onClick}
      aria-label={`${m.home_team.name} — ${m.away_team.name}, ${formatDateTime(m.time_utc ?? m.date, getUserTimezone())}`}
    >
      <span className="game-time">
        <strong>{formatDateTime(m.time_utc ?? m.date, getUserTimezone())}</strong>
        <small className={live ? 'is-live' : ''}>
          {finished
            ? 'Завершён'
            : live
              ? 'В игре'
              : m.status === 'not_started'
                ? 'Начало матча'
                : m.status === 'postponed'
                  ? 'Перенесён'
                  : 'По расписанию'}
        </small>
      </span>
      <span className="game-team home">
        <TeamBadge
          name={m.home_team.name}
          imageUrl={m.home_team.image_url}
          size={compact ? 23 : 28}
        />
        <span>{m.home_team.name}</span>
      </span>
      <span className={`game-score ${finished ? 'finished' : ''}`}>
        {m.score_home != null && m.score_away != null ? `${m.score_home} : ${m.score_away}` : 'VS'}
      </span>
      <span className="game-team away">
        <span>{m.away_team.name}</span>
        <TeamBadge
          name={m.away_team.name}
          imageUrl={m.away_team.image_url}
          size={compact ? 23 : 28}
        />
      </span>
      <ChevronRight size={14} className="game-chevron" />
    </button>
  );
}
