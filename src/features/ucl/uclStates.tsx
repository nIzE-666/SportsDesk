import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, EmptyState, Skeleton } from '../../kit';

/** Loading placeholders of the tournament screens: kit skeletons under one line. */
export function UclLoading({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="ucl-loading" role="status" aria-live="polite">
      <span className="ucl-loading__label">{label}</span>
      <div className="ucl-loading__rows">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="ucl-loading__row" />
        ))}
      </div>
    </div>
  );
}

/** An inline error: the nearest kit element is the empty state, with one retry action. */
export function UclError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      tone="error"
      icon={<AlertTriangle size={20} aria-hidden="true" />}
      title={title}
      message={message}
      action={onRetry ? <Button onClick={onRetry}>Повторить</Button> : undefined}
    />
  );
}
