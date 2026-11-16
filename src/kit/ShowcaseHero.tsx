import type { ReactNode } from 'react';
import { cx } from './classes';
import { PitchTrackLine } from './PitchTrackLine';
import { ShowcaseCrest, type ShowcaseTeam } from './ShowcaseCrest';

/** @deprecated Kept for older imports; use `ShowcaseTeam`. */
export type ShowcaseHeroCrest = ShowcaseTeam;

export interface ShowcaseHeroProps {
  /** Small plate above the title, for example «Главный матч». */
  kicker?: ReactNode;
  /** The match name. By default «home — away» with the dash in the accent colour. */
  title?: ReactNode;
  /** The line under the title: the competition and the start, or the score and the minute. */
  meta?: ReactNode;
  /** Short reasons to watch, such as «лондонское дерби»; shown as tags after the meta line. */
  reasons?: string[];
  /** A countdown or a live score, shown before the actions. */
  clock?: ReactNode;
  /** Buttons of the card. */
  actions?: ReactNode;
  home: ShowcaseTeam;
  away: ShowcaseTeam;
  className?: string;
}

function hasContent(node: ReactNode): boolean {
  return node != null && node !== '' && node !== false;
}

/**
 * The big card of the showcase layer: a kicker plate, the title, a meta line
 * with reasons, a clock and actions on the left; the two real crests over a
 * calm diagonal cut on the right, with the «поле → трасса» line underneath.
 * No text is ever placed on the cut.
 */
export function ShowcaseHero({
  kicker,
  title,
  meta,
  reasons = [],
  clock,
  actions,
  home,
  away,
  className,
}: ShowcaseHeroProps) {
  const tags = reasons.map((reason) => reason.trim()).filter((reason) => reason.length > 0);

  return (
    <article className={cx('ui-showcase-hero', className)}>
      <div className="ui-showcase-hero__split" aria-hidden="true">
        <span className="ui-showcase-hero__side ui-showcase-hero__side--home" />
        <span className="ui-showcase-hero__side ui-showcase-hero__side--away" />
        <span className="ui-showcase-hero__shine" />
      </div>

      <PitchTrackLine variant="hero" className="ui-showcase-hero__line" />

      <div className="ui-showcase-hero__crests" aria-hidden="true">
        <span className="ui-showcase-hero__pool ui-showcase-hero__pool--home" />
        <span className="ui-showcase-hero__pool ui-showcase-hero__pool--away" />
        <ShowcaseCrest
          team={home}
          size="hero"
          className="ui-showcase-hero__crest ui-showcase-hero__crest--home"
        />
        <ShowcaseCrest
          team={away}
          size="hero"
          className="ui-showcase-hero__crest ui-showcase-hero__crest--away"
        />
      </div>

      <div className="ui-showcase-hero__body">
        {hasContent(kicker) && (
          <p className="ui-showcase-hero__kicker">
            <span className="ui-showcase-hero__kicker-text">{kicker}</span>
            <span className="ui-showcase-hero__kicker-marks" aria-hidden="true">
              <span className="ui-showcase-hero__kicker-mark" />
              <span className="ui-showcase-hero__kicker-mark" />
            </span>
          </p>
        )}
        <p className="ui-showcase-hero__title">
          {hasContent(title) ? (
            title
          ) : (
            <>
              {home.name.trim()} <span className="ui-showcase-hero__dash">—</span>{' '}
              {away.name.trim()}
            </>
          )}
        </p>
        {(hasContent(meta) || tags.length > 0) && (
          <div className="ui-showcase-hero__meta">
            {hasContent(meta) && <span className="ui-showcase-hero__meta-text">{meta}</span>}
            {tags.map((tag) => (
              <span className="ui-showcase-hero__tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {(hasContent(clock) || hasContent(actions)) && (
          <div className="ui-showcase-hero__row">
            {hasContent(clock) && <div className="ui-showcase-hero__clock">{clock}</div>}
            {hasContent(actions) && <div className="ui-showcase-hero__actions">{actions}</div>}
          </div>
        )}
      </div>
    </article>
  );
}
