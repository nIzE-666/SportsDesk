import { MatchRow, type MatchRowSize, type MatchRowStatus } from '../../kit';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { formatHumanDateTime } from '../../lib/humanDate';
import { useResultHidden } from '../spoilers/spoilerStore';
import { getUserTimezone } from '../football/storage';
import type { MatchSummary } from '../football/types';
import type { ReactNode } from 'react';

function rowStatus(status: string, statusText?: string): MatchRowStatus {
  const state = classifyMatchStatus(status, statusText);
  if (state === 'finished') return 'finished';
  if (state === 'live') return 'live';
  if (state === 'postponed') return 'postponed';
  return 'scheduled';
}

/**
 * A tournament match in the kit row. The screen keeps the data and the spoiler
 * choice; the row only renders what it is given.
 */
export function UclMatchRow({
  match,
  onClick,
  size = 'normal',
  time,
  competition,
}: {
  match: MatchSummary;
  onClick: () => void;
  size?: MatchRowSize;
  /** Overrides the provider date, for a bracket leg; `null` hides the date. */
  time?: string | null;
  /** The bracket leg number, when the row is part of a tie. */
  competition?: ReactNode;
}) {
  const hidden = useResultHidden('football', match.id);
  const when =
    time === undefined
      ? formatHumanDateTime(match.time_utc ?? match.date, getUserTimezone())
      : (time ?? undefined);
  return (
    <MatchRow
      home={{ name: match.home_team.name, imageUrl: match.home_team.image_url }}
      away={{ name: match.away_team.name, imageUrl: match.away_team.image_url }}
      time={when}
      status={rowStatus(match.status, match.status_text)}
      score={{ home: match.score_home ?? null, away: match.score_away ?? null }}
      hideScore={hidden}
      size={size}
      competition={competition}
      onClick={onClick}
      ariaLabel={`${match.home_team.name} — ${match.away_team.name}${when ? `, ${when}` : ''}`}
    />
  );
}
