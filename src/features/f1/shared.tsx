import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { sourceLabel } from '../../lib/sourceLabels';
import { formatUpdatedAt, getUserTimezone } from '../football/storage';
import { Badge, Button, EmptyState } from '../../kit';
import { DriverPortrait } from './DriverPortraits';
import { useSourceRegistration } from './SourceSummary';

/**
 * Small shared presentational bits scoped to F1.
 */

/** One CSS custom property for a value that comes from the data. */
export type F1Style = CSSProperties & Record<`--${string}`, string | number>;

export type TyreCompound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet' | 'unknown';

/** The colour of a tyre compound is data, so only the class name comes from it. */
export function tyreClass(compound: string | null | undefined): TyreCompound {
  const value = (compound ?? '').toLowerCase();
  if (value === 'soft') return 'soft';
  if (value === 'medium') return 'medium';
  if (value === 'hard') return 'hard';
  if (value === 'intermediate' || value === 'inter') return 'inter';
  if (value === 'wet') return 'wet';
  return 'unknown';
}

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
  const updated = props.fetchedAt ? formatUpdatedAt(props.fetchedAt, getUserTimezone()) : null;
  return (
    <div className="f1-sourcebar" role="status" aria-live="polite">
      <span>
        Данные: {sourceLabel(props.source)}
        {updated && updated !== '—' ? ` · обновлено ${updated}` : ''}
      </span>
      {props.stale ? <Badge variant="warning">Есть устаревшие данные</Badge> : null}
      {props.extra}
      {props.onRefresh ? (
        <Button
          small
          busy={props.refreshing}
          onClick={props.onRefresh}
          aria-label="Обновить данные"
        >
          {props.refreshing ? 'Обновление…' : 'Обновить'}
        </Button>
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
  if (kind === 'loading')
    return (
      <EmptyState
        className="f1-state"
        message={title}
        icon={<Loader2 size={20} className="f1-spin" aria-hidden="true" />}
      />
    );
  if (kind === 'error')
    return (
      <EmptyState
        className="f1-state"
        tone="error"
        title={title}
        message={children}
        icon={<AlertTriangle size={20} aria-hidden="true" />}
      />
    );
  return (
    <EmptyState
      className="f1-state"
      title={children ? title : undefined}
      message={children ?? title}
      icon={<Inbox size={20} aria-hidden="true" />}
    />
  );
}

export function TeamDot({ color }: { color: string }) {
  return (
    <span className="f1-team-dot" style={{ '--dot-color': color } as F1Style} aria-hidden="true" />
  );
}

export function DriverName({ givenName, familyName }: { givenName: string; familyName: string }) {
  return (
    <span className="f1-driver-identity">
      <DriverPortrait name={`${givenName} ${familyName}`} />
      <span>
        <span className="f1-driver-given">{givenName} </span>
        <b className="f1-driver-family">{familyName}</b>
      </span>
    </span>
  );
}
