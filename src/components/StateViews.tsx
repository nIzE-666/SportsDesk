import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, Inbox } from 'lucide-react';

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
      <div className="skeleton-stack">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton skeleton-row" />
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
    <div className="panel state-block error" role="alert">
      <AlertTriangle size={18} />
      <div>
        <strong>{title}</strong>
        {message && <p>{message}</p>}
      </div>
      {onRetry && (
        <button className="ghost-btn" onClick={onRetry}>
          Повторить
        </button>
      )}
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
    <div className="panel state-block empty" role="status">
      <Inbox size={18} />
      <div>
        <strong>{title}</strong>
        {message && <p>{message}</p>}
        {children && <div className="state-action">{children}</div>}
      </div>
    </div>
  );
}
