import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './classes';
import { ShowcaseCrest, type ShowcaseTeam } from './ShowcaseCrest';

export interface ShowcaseUpcomingCardProps {
  /** Why it matters, for example «1-е против 3-го» or «Формула 1». */
  kicker?: string;
  /** Football: both sides with their crests. */
  home?: ShowcaseTeam;
  away?: ShowcaseTeam;
  /** A race weekend instead of a match, for example «Гран-при Лас-Вегаса». */
  race?: string;
  /** The session of the race weekend, for example «Квалификация». */
  session?: string;
  /** The line under the names: the competition and how soon. */
  meta?: ReactNode;
  /** Local start time, for example «02:30». */
  time: string;
  /** Short date, for example «сб, 21 нояб.». */
  date: string;
  onOpen?: () => void;
  className?: string;
}

/** A checkered flag on a short pole, the mark of a race. */
function RaceFlag() {
  return (
    <svg
      className="ui-showcase-upcoming__flag"
      viewBox="0 0 24 30"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="ui-showcase-upcoming__flag-cloth"
        d="M3.5 2.6C9 .6 14 4.6 22.6 2.6V14.2C14 16.2 9 12.2 3.5 14.2Z"
      />
      <path
        className="ui-showcase-upcoming__flag-check"
        d="M3.5 2.6h4.8v3.9H3.5zM13.1 2.9h4.8v3.9h-4.8zM8.3 6.5h4.8v3.9H8.3zM17.9 6.3h4.7v3.9h-4.7zM3.5 10.4h4.8v3.8H3.5zM13.1 10.6h4.8v3.9h-4.8z"
      />
      <rect
        className="ui-showcase-upcoming__flag-pole"
        x="1.3"
        y="1.2"
        width="2.3"
        height="28.8"
        rx="1.15"
      />
    </svg>
  );
}

/**
 * An important event ahead on a slanted plate: a match with the real crests,
 * or a race session with a checkered flag, and its local time on the right.
 */
export function ShowcaseUpcomingCard({
  kicker,
  home,
  away,
  race,
  session,
  meta,
  time,
  date,
  onOpen,
  className,
}: ShowcaseUpcomingCardProps) {
  const title = race ?? [home?.name, away?.name].filter(Boolean).join(' — ');
  const name = [kicker, title, session, `${date}, ${time}`].filter(Boolean).join(', ');

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onOpen();
  };

  return (
    <article
      className={cx('ui-showcase-upcoming', onOpen && 'ui-showcase-upcoming--open', className)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? name : undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      <div className="ui-showcase-upcoming__body">
        {kicker && <span className="ui-showcase-upcoming__kicker">{kicker}</span>}
        {race ? (
          <>
            <span className="ui-showcase-upcoming__team">
              <RaceFlag />
              <span className="ui-showcase-upcoming__name">{race}</span>
            </span>
            {session && <span className="ui-showcase-upcoming__session">{session}</span>}
          </>
        ) : (
          [home, away].map(
            (team, index) =>
              team && (
                <span className="ui-showcase-upcoming__team" key={index}>
                  <ShowcaseCrest team={team} size="card" />
                  <span className="ui-showcase-upcoming__name">{team.name}</span>
                </span>
              ),
          )
        )}
        {meta != null && meta !== '' && <span className="ui-showcase-upcoming__meta">{meta}</span>}
      </div>
      <span className="ui-showcase-upcoming__when">
        {time}
        <small>{date}</small>
      </span>
    </article>
  );
}
