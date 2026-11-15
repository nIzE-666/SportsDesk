import { useEffect, useState, type CSSProperties } from 'react';
import './teamBadge.css';

interface TeamBadgeProps {
  name: string;
  imageUrl?: string | null;
  size?: number;
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

export function TeamBadge({ name, imageUrl, size = 28 }: TeamBadgeProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [imageUrl]);

  const geometry = { '--badge-size': `${size}px` } as CSSProperties;

  if (!imageUrl || broken) {
    return (
      <span
        className={`team-badge-fallback${size >= 32 ? ' team-badge-fallback--large' : ''}`}
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
      onError={() => setBroken(true)}
    />
  );
}

export default TeamBadge;
