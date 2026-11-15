import { useState, type CSSProperties } from 'react';
import './personAvatar.css';

/** Keep the same geometry when a provider has no photo or its CDN fails. */
export function PersonAvatar({
  name,
  src,
  size = 44,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const safeSrc = src && /^https?:\/\//i.test(src) ? src : null;
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .filter(Boolean);
  return (
    <span className="person-avatar" style={{ '--avatar-size': `${size}px` } as CSSProperties}>
      {safeSrc && failed !== safeSrc ? (
        <img
          src={safeSrc}
          alt={`Фото: ${name}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(safeSrc)}
        />
      ) : (
        <span aria-label={`Фото ${name} недоступно`}>
          {(initials.length > 1
            ? `${initials[0]}${initials.at(-1)}`
            : (initials[0] ?? '?')
          ).toUpperCase()}
        </span>
      )}
    </span>
  );
}
