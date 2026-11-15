import type { MatchSummary } from '../features/football/types';
import { getUserTimezone } from '../features/football/storage';
import { useResultHidden } from '../features/spoilers/spoilerStore';
import { formatHumanDateTime } from '../lib/humanDate';
import { classifyMatchStatus } from '../lib/sportsIdentity';
import { MatchRow as KitMatchRow, type MatchRowStatus } from '../kit';

/** The shared match line: the kit row keeps the props of the old `.game-row`. */
export function MatchRow({
  match: m,
  onClick,
  compact = false,
}: {
  match: MatchSummary;
  onClick: () => void;
  compact?: boolean;
}) {
  const state = classifyMatchStatus(m.status, m.status_text);
  const status: MatchRowStatus =
    state === 'live'
      ? 'live'
      : state === 'finished'
        ? 'finished'
        : state === 'postponed'
          ? 'postponed'
          : 'scheduled';
  const spoilerHidden = useResultHidden('football', m.id);
  const time = formatHumanDateTime(m.time_utc ?? m.date, getUserTimezone());
  return (
    <KitMatchRow
      home={{ name: m.home_team.name, imageUrl: m.home_team.image_url }}
      away={{ name: m.away_team.name, imageUrl: m.away_team.image_url }}
      time={time}
      status={status}
      score={{ home: m.score_home, away: m.score_away }}
      hideScore={spoilerHidden}
      size={compact ? 'compact' : 'normal'}
      onClick={onClick}
      ariaLabel={`${m.home_team.name} — ${m.away_team.name}, ${time}`}
    />
  );
}
