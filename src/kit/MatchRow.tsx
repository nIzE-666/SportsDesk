import type { ReactNode } from 'react';
import TeamBadge from '../components/TeamBadge';
import { SPOILER_MASK } from '../features/spoilers/spoilerStore';
import { cx } from './classes';

export type MatchRowSize = 'compact' | 'normal' | 'large';
export type MatchRowStatus =
  'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' | 'unknown';

export interface MatchRowTeam {
  name: string;
  imageUrl?: string | null;
  /** One action shown next to this team's name, on the side facing the score. */
  action?: ReactNode;
}

export interface MatchRowScore {
  home: number | null;
  away: number | null;
}

export interface MatchRowProps {
  home: MatchRowTeam;
  away: MatchRowTeam;
  /** Already formatted kick-off or match date; the row formats nothing itself. */
  time?: string | null;
  /** Replaces «Начало матча» under a scheduled kick-off, for example with the day. */
  timeNote?: ReactNode;
  status?: MatchRowStatus;
  /** Live minute, a number becomes «67′». */
  minute?: string | number | null;
  /** Unknown sides show a dash. */
  score?: MatchRowScore | null;
  /** The spoiler mode of `src/features/spoilers/`: the same «? : ?» mask. */
  hideScore?: boolean;
  /** Optional competition line. */
  competition?: ReactNode;
  /** One badge next to the competition, for example «Избранное» or a result letter. */
  badge?: ReactNode;
  /** Buttons and links of the row. With actions the row itself is not clickable. */
  actions?: ReactNode;
  size?: MatchRowSize;
  onClick?: () => void;
  /** Explicit accessible name for the clickable row. */
  ariaLabel?: string;
  /** Set on a clickable row that expands a group, e.g. the legs of a tie. */
  ariaExpanded?: boolean;
  className?: string;
}

function scoreLabel(score: MatchRowScore | null | undefined, hidden: boolean): string {
  if (!score || (score.home == null && score.away == null)) return '—';
  if (hidden) return SPOILER_MASK;
  return `${score.home ?? '—'} : ${score.away ?? '—'}`;
}

function whenLabel(
  time: string | null,
  status: MatchRowStatus,
  minute: string | null,
  timeNote: ReactNode,
): { primary: string; secondary: ReactNode | null } {
  if (status === 'live') {
    return { primary: minute ?? 'В игре', secondary: 'Идёт' };
  }
  if (status === 'finished') {
    return { primary: 'Завершён', secondary: time };
  }
  if (status === 'postponed') {
    return { primary: 'Перенесён', secondary: null };
  }
  if (status === 'cancelled') {
    return { primary: 'Отменён', secondary: null };
  }
  if (status === 'unknown') {
    return { primary: 'Статус уточняется', secondary: null };
  }
  return {
    primary: time ?? '—',
    secondary: timeNote ?? (time ? 'Начало матча' : null),
  };
}

export function MatchRow({
  home,
  away,
  time,
  timeNote,
  status = 'scheduled',
  minute,
  score,
  hideScore = false,
  competition,
  badge,
  actions,
  size = 'normal',
  onClick,
  ariaLabel,
  ariaExpanded,
  className,
}: MatchRowProps) {
  const cleanTime = time?.trim() ? time : null;
  const cleanMinute =
    typeof minute === 'number' ? `${minute}′` : minute?.trim() ? minute.trim() : null;
  const when = whenLabel(cleanTime, status, cleanMinute, timeNote);
  const badgeSize = size === 'compact' ? 20 : size === 'large' ? 36 : 28;
  const hidden = hideScore && (score?.home != null || score?.away != null);
  const hasCompetition = competition != null && competition !== '';
  const hasBadge = badge != null && badge !== '';
  const hasTeamAction = home.action != null || away.action != null;
  const content = (
    <>
      <span className="ui-match-row__when">
        <strong className="ui-match-row__time">{when.primary}</strong>
        {when.secondary && (
          <span
            className={cx('ui-match-row__state', status === 'live' && 'ui-match-row__state--live')}
          >
            {when.secondary}
          </span>
        )}
      </span>
      <span className="ui-match-row__team ui-match-row__team--home">
        <TeamBadge name={home.name} imageUrl={home.imageUrl} size={badgeSize} />
        <span className="ui-match-row__team-name">{home.name}</span>
        {home.action != null && <span className="ui-match-row__team-action">{home.action}</span>}
      </span>
      <span
        className={cx('ui-match-row__score', hidden && 'ui-match-row__score--hidden')}
        title={hidden ? 'Результат скрыт' : undefined}
      >
        {scoreLabel(score, hidden)}
      </span>
      <span className="ui-match-row__team ui-match-row__team--away">
        {away.action != null && <span className="ui-match-row__team-action">{away.action}</span>}
        <span className="ui-match-row__team-name">{away.name}</span>
        <TeamBadge name={away.name} imageUrl={away.imageUrl} size={badgeSize} />
      </span>
      {(hasCompetition || hasBadge) && (
        <span className="ui-match-row__meta">
          {hasCompetition && <span className="ui-match-row__competition">{competition}</span>}
          {hasBadge && <span className="ui-match-row__badge">{badge}</span>}
        </span>
      )}
      {actions != null && <span className="ui-match-row__actions">{actions}</span>}
    </>
  );

  const rootClass = cx(
    'ui-match-row',
    size === 'compact' && 'ui-match-row--compact',
    size === 'large' && 'ui-match-row--large',
    hasCompetition && 'ui-match-row--with-competition',
    hasBadge && 'ui-match-row--with-badge',
    className,
  );

  if (onClick && actions == null && !hasTeamAction) {
    return (
      <button
        type="button"
        className={rootClass}
        onClick={onClick}
        aria-label={ariaLabel}
        aria-expanded={ariaExpanded}
      >
        {content}
      </button>
    );
  }
  return <div className={rootClass}>{content}</div>;
}
