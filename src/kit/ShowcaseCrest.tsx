import { useEffect, useState } from 'react';
import { cx } from './classes';

export interface ShowcaseTeam {
  name: string;
  /** The club crest from the match data; without it the initials are shown. */
  imageUrl?: string | null;
}

export type ShowcaseCrestSize = 'hero' | 'card' | 'tip';

export interface ShowcaseCrestProps {
  team: ShowcaseTeam;
  size?: ShowcaseCrestSize;
  className?: string;
}

export function crestInitials(name: string): string {
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

/**
 * The real club crest of the showcase layer. A missing or broken image falls
 * back to the initials, the way the other kit parts do. Decorative: the team
 * name is always written next to it or in the accessible name around it.
 */
export function ShowcaseCrest({ team, size = 'card', className }: ShowcaseCrestProps) {
  const [broken, setBroken] = useState(false);
  const source = team.imageUrl?.trim() ?? '';

  useEffect(() => {
    setBroken(false);
  }, [source]);

  return (
    <span
      className={cx('ui-showcase-crest', `ui-showcase-crest--${size}`, className)}
      aria-hidden="true"
    >
      {source && !broken ? (
        <img
          className="ui-showcase-crest__image"
          src={source}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="ui-showcase-crest__initials">{crestInitials(team.name)}</span>
      )}
    </span>
  );
}
