import { useEffect, useState, type ReactNode } from 'react';
import { cx } from './classes';
import { PitchTrackLine } from './PitchTrackLine';

export interface ShowcaseHeroCrest {
  name: string;
  imageUrl?: string | null;
}

export interface ShowcaseHeroProps {
  /** Small plate above the title, for example «Главный матч». */
  kicker?: ReactNode;
  /** The match name, for example «Арсенал — Челси». */
  title: ReactNode;
  /** The line under the title: a countdown, or the score and the minute. */
  meta?: ReactNode;
  /** Buttons of the card. */
  actions?: ReactNode;
  home: ShowcaseHeroCrest;
  away: ShowcaseHeroCrest;
  /** Colour of the home half of the split; without it the split is neutral. */
  homeColor?: string | null;
  awayColor?: string | null;
  className?: string;
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

function crestName(team: ShowcaseHeroCrest): string {
  return team.name.trim();
}

function Crest({ team, side }: { team: ShowcaseHeroCrest; side: 'home' | 'away' }) {
  const [broken, setBroken] = useState(false);
  const source = team.imageUrl?.trim() ?? '';

  useEffect(() => {
    setBroken(false);
  }, [source]);

  return (
    <span className={cx('ui-showcase-hero__crest', `ui-showcase-hero__crest--${side}`)}>
      {source && !broken ? (
        <img
          className="ui-showcase-hero__crest-image"
          src={source}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="ui-showcase-hero__crest-initials" aria-hidden="true">
          {initials(crestName(team))}
        </span>
      )}
    </span>
  );
}

/**
 * The big card of the showcase layer: a kicker plate, a title, a meta line and
 * actions on the left, two crests over a diagonal split on the right.
 */
export function ShowcaseHero({
  kicker,
  title,
  meta,
  actions,
  home,
  away,
  homeColor,
  awayColor,
  className,
}: ShowcaseHeroProps) {
  const homeFill = homeColor?.trim() || null;
  const awayFill = awayColor?.trim() || null;

  return (
    <article className={cx('ui-showcase-hero', className)}>
      <PitchTrackLine variant="hero" className="ui-showcase-hero__line" />

      <div className="ui-showcase-hero__body">
        {kicker != null && kicker !== '' && (
          <p className="ui-showcase-hero__kicker">
            <span className="ui-showcase-hero__kicker-text">{kicker}</span>
            <span className="ui-showcase-hero__kicker-marks" aria-hidden="true">
              <span className="ui-showcase-hero__kicker-mark" />
              <span className="ui-showcase-hero__kicker-mark" />
            </span>
          </p>
        )}
        <p className="ui-showcase-hero__title">{title}</p>
        {meta != null && meta !== '' && <div className="ui-showcase-hero__meta">{meta}</div>}
        {actions != null && <div className="ui-showcase-hero__actions">{actions}</div>}
      </div>

      <div className="ui-showcase-hero__crest-panel" aria-hidden="true">
        <svg
          className="ui-showcase-hero__split"
          viewBox="0 0 300 220"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <polygon
            className={cx(
              'ui-showcase-hero__split-half',
              !homeFill && 'ui-showcase-hero__split-half--home',
            )}
            points="0,0 300,0 300,220"
            fill={homeFill ?? undefined}
          />
          <polygon
            className={cx(
              'ui-showcase-hero__split-half',
              !awayFill && 'ui-showcase-hero__split-half--away',
            )}
            points="0,0 300,220 0,220"
            fill={awayFill ?? undefined}
          />
        </svg>
        <Crest team={home} side="home" />
        <Crest team={away} side="away" />
      </div>
    </article>
  );
}
