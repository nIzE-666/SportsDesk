import type { ReactNode } from 'react';

/** Event information stays on an opaque surface; artwork is decorative. */
export function EventCover({
  sport = 'football',
  eyebrow,
  children,
}: {
  sport?: 'football' | 'f1' | 'ucl';
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className={`event-cover event-cover-${sport}`} aria-label="Событие в фокусе">
      <div className="event-cover-content">
        <span className="event-cover-eyebrow">{eyebrow}</span>
        {children}
      </div>
      <div className="event-cover-art" aria-hidden="true" />
    </section>
  );
}
