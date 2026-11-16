import type { KeyboardEvent } from 'react';
import { cx } from './classes';
import { InterestMeter } from './InterestMeter';
import { MatchStrip, type MatchStripGoal } from './MatchStrip';
import { ShowcaseCrest, type ShowcaseTeam } from './ShowcaseCrest';

export interface ShowcaseMatchSide extends ShowcaseTeam {
  /** Goals of the side; `null` when the score is unknown or hidden. */
  score: number | null;
}

export interface ShowcaseMatchCardProps {
  /** The competition, for example «Премьер-лига». */
  competition: string;
  /** A short day, for example «чт». */
  day?: string;
  home: ShowcaseMatchSide;
  away: ShowcaseMatchSide;
  /** 1–5; `null` hides the meter. */
  interest: number | null;
  /** Why the match is worth a look: «камбэк с 0:2», «8 голов». */
  reasons?: string[];
  /** Goals by minute; omit to hide the strip. */
  goals?: MatchStripGoal[];
  length?: 90 | 120;
  onOpen?: () => void;
  className?: string;
}

function scoreText(score: number | null): string {
  return score == null || !Number.isFinite(score) ? '–' : String(score);
}

/**
 * A finished match as a broadcast score bug: two rows with the real crests
 * and names, a dark board with glowing digits, the interest meter, reasons and
 * the goals by minute. The losing side is dimmed; an unknown score shows a dash.
 */
export function ShowcaseMatchCard({
  competition,
  day,
  home,
  away,
  interest,
  reasons = [],
  goals,
  length = 90,
  onOpen,
  className,
}: ShowcaseMatchCardProps) {
  const known = home.score != null && away.score != null;
  const homeLost = known && home.score! < away.score!;
  const awayLost = known && away.score! < home.score!;
  const tags = reasons.map((reason) => reason.trim()).filter((reason) => reason.length > 0);
  const name = `${home.name} ${scoreText(home.score)}:${scoreText(away.score)} ${away.name}, ${competition}`;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onOpen();
  };

  return (
    <article
      className={cx('ui-showcase-card', onOpen && 'ui-showcase-card--open', className)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? name : undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      <header className="ui-showcase-card__top">
        <span className="ui-showcase-card__competition">{competition}</span>
        {day && <span className="ui-showcase-card__day">{day}</span>}
      </header>

      <div className="ui-showcase-card__bug">
        <div className="ui-showcase-card__teams">
          <span
            className={cx('ui-showcase-card__team', homeLost && 'ui-showcase-card__team--lost')}
          >
            <ShowcaseCrest team={home} size="card" />
            <span className="ui-showcase-card__name">{home.name}</span>
          </span>
          <span
            className={cx('ui-showcase-card__team', awayLost && 'ui-showcase-card__team--lost')}
          >
            <ShowcaseCrest team={away} size="card" />
            <span className="ui-showcase-card__name">{away.name}</span>
          </span>
        </div>
        <span className="ui-showcase-board">
          <span
            className={cx('ui-showcase-board__digit', homeLost && 'ui-showcase-board__digit--dim')}
          >
            {scoreText(home.score)}
          </span>
          <span
            className={cx('ui-showcase-board__digit', awayLost && 'ui-showcase-board__digit--dim')}
          >
            {scoreText(away.score)}
          </span>
        </span>
      </div>

      {(interest != null || tags.length > 0) && (
        <div className="ui-showcase-card__why">
          <InterestMeter value={interest} />
          {tags.map((tag) => (
            <span className="ui-showcase-card__chip" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {goals && <MatchStrip goals={goals} length={length} className="ui-showcase-card__strip" />}
    </article>
  );
}
