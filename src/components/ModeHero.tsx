import type { ReactNode } from 'react';
import { useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { getJson, setJson } from '../features/football/storage';

export function ModeHero({
  mode = 'football',
  eyebrow,
  title,
  description,
  children,
}: {
  mode?: 'football' | 'f1' | 'ucl';
  eyebrow: string;
  title: ReactNode;
  description: string;
  children?: ReactNode;
}) {
  const [compact, setCompact] = useState(
    () => getJson<Record<string, boolean>>('sportsdesk.hero.compact', {})[mode] !== false,
  );
  const toggle = () => {
    setCompact(!compact);
    setJson('sportsdesk.hero.compact', {
      ...getJson('sportsdesk.hero.compact', {}),
      [mode]: !compact,
    });
  };
  return (
    <section className={`mode-hero hero-${mode} ${compact ? 'hero-compact' : ''}`}>
      <button className="hero-collapse" aria-expanded={!compact} onClick={toggle}>
        {compact ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}{' '}
        {compact ? 'Развернуть баннер' : 'Свернуть баннер'}
      </button>
      <div className="hero-art" aria-hidden="true" />
      <div className="hero-content">
        <span className="eyebrow">
          <i />
          {eyebrow}
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        {children && <div className="hero-actions">{children}</div>}
      </div>
      <span className="hero-watermark" aria-hidden="true">
        {mode === 'f1' ? 'RACE / 01' : mode === 'ucl' ? 'EUROPE / NIGHTS' : 'THE BEAUTIFUL GAME'}
      </span>
    </section>
  );
}
