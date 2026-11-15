import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, Inbox } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '../kit';
import './stateViews.css';

export function LoadingBlock({
  label = 'Загрузка данных…',
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="panel state-block" role="status" aria-live="polite">
      <Loader2 size={18} className="spin" />
      <span>{label}</span>
      <div className="state-skeleton-stack">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="state-skeleton-row" />
        ))}
      </div>
    </div>
  );
}

export function ErrorBlock({
  title = 'Не удалось загрузить данные',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="state-alert">
      <EmptyState
        className="state-block"
        icon={<AlertTriangle size={20} />}
        message={
          <>
            <strong>{title}</strong>
            {message && <> {message}</>}
          </>
        }
        action={
          onRetry ? (
            <Button variant="quiet" onClick={onRetry}>
              Повторить
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export function EmptyBlock({
  title = 'Нет данных',
  message,
  children,
}: {
  title?: string;
  message?: string;
  children?: ReactNode;
}) {
  return (
    <EmptyState
      className="state-block"
      icon={<Inbox size={20} />}
      message={
        <>
          <strong>{title}</strong>
          {message && <> {message}</>}
        </>
      }
      action={children}
    />
  );
}
