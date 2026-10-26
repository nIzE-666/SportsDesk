import { useEffect, useState } from 'react';

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

  if (!imageUrl || broken) {
    return (
      <span
        className="team-badge-fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
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
      style={{ width: size, height: size }}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export default TeamBadge;
