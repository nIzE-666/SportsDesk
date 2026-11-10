import { DriverPortrait } from './DriverPortraits';
import type { ReactNode } from 'react';
import { useSourceRegistration } from './SourceSummary';

/**
 * Small shared presentational bits scoped to F1.
 */

export function SourceBar(props: {
  source: string;
  fetchedAt: string | null;
  stale: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  extra?: ReactNode;
}) {
  const aggregated = useSourceRegistration(props);
  if (aggregated) return props.extra ?? null;
  const fet = props.fetchedAt
    ? new Date(props.fetchedAt).toLocaleString('ru-RU', { hour12: false })
    : '—';
  return (
    <div className="f1-sourcebar" role="status" aria-live="polite">
      <span>
        Источник: <b>{props.source}</b>
      </span>
      <span>Получено: {fet}</span>
      {props.stale ? <span className="f1-pill warn">Кэш / устарело</span> : null}
      {props.extra}
      {props.onRefresh ? (
        <button
          type="button"
          className="f1-btn is-ghost"
          onClick={props.onRefresh}
          disabled={props.refreshing}
          aria-label="Обновить данные"
        >
          {props.refreshing ? 'Обновление…' : 'Обновить'}
        </button>
      ) : null}
    </div>
  );
}

export function State({
  kind,
  title,
  children,
}: {
  kind: 'loading' | 'empty' | 'error';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`f1-state${kind === 'error' ? ' error' : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <div style={{ fontWeight: 600, color: kind === 'error' ? '#ffb3b3' : 'inherit' }}>
        {title}
      </div>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function TeamDot({ color }: { color: string }) {
  return <span className="f1-team-dot" style={{ background: color }} aria-hidden="true" />;
}

export function DriverName({ givenName, familyName }: { givenName: string; familyName: string }) {
  return (
    <span className="f1-driver-identity">
      <DriverPortrait name={`${givenName} ${familyName}`} />
      <span>
        <span style={{ color: 'var(--muted,#8b9099)' }}>{givenName} </span>
        <b style={{ fontWeight: 600, color: 'var(--text,#fff)' }}>{familyName}</b>
      </span>
    </span>
  );
}
