import { useEffect, useState, type CSSProperties } from 'react';
import './teamBadge.css';

interface TeamBadgeProps {
  name: string;
  imageUrl?: string | null;
  size?: number;
  /** Which side of a match the team plays on; tints only the crest fallback. */
  side?: 'home' | 'away';
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  const a = first.charAt(0);
  const b = last.charAt(0);
  return (a + b).toUpperCase();
}

export function TeamBadge({ name, imageUrl, size = 28, side }: TeamBadgeProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [imageUrl]);

  const geometry = { '--badge-size': `${size}px` } as CSSProperties;

  if (!imageUrl || broken) {
    const sideClass = side ? ` team-badge-fallback--${side}` : '';
    return (
      <span
        className={`team-badge-fallback${size >= 32 ? ' team-badge-fallback--large' : ''}${sideClass}`}
        style={geometry}
        aria-hidden
      >
        {initials(name)}
      </span>
    );
  }

  return (
    <img
      src={imageUrl}
      alt=""
      className="team-badge"
      style={geometry}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

export default TeamBadge;
