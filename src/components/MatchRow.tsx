import { ChevronRight } from 'lucide-react';
import TeamBadge from './TeamBadge';
import type { MatchSummary } from '../features/football/types';
import { getUserTimezone } from '../features/football/storage';
import { formatHumanDateTime } from '../lib/humanDate';
import { classifyMatchStatus } from '../lib/sportsIdentity';
import { scoreText, useResultHidden } from '../features/spoilers/spoilerStore';
import '../features/spoilers/spoilers.css';

export function MatchRow({
  match: m,
  onClick,
  compact = false,
}: {
  match: MatchSummary;
  onClick: () => void;
  compact?: boolean;
}) {
  const state = classifyMatchStatus(m.status, m.status_text),
    finished = state === 'finished',
    live = state === 'live';
  const spoilerHidden = useResultHidden('football', m.id);
  return (
    <button
      className={`game-row ${compact ? 'compact' : ''}`}
      onClick={onClick}
      aria-label={`${m.home_team.name} — ${m.away_team.name}, ${formatHumanDateTime(m.time_utc ?? m.date, getUserTimezone())}`}
    >
      <span className="game-time">
        <strong>{formatHumanDateTime(m.time_utc ?? m.date, getUserTimezone())}</strong>
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
      <span
        className={`game-score ${finished ? 'finished' : ''} ${spoilerHidden ? 'is-spoiler-hidden' : ''}`}
        title={spoilerHidden ? 'Результат скрыт' : undefined}
      >
        {scoreText(m.score_home, m.score_away, spoilerHidden)}
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
