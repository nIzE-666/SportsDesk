import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './classes';

export interface EmptyStateProps {
  /** One sentence; the reason or the next step. */
  message: ReactNode;
  /** Short heading on its own line before the message. */
  title?: ReactNode;
  /** One icon; the inbox by default. */
  icon?: ReactNode;
  /** At most one action. */
  action?: ReactNode;
  /** `error` makes the element an alert and paints the icon with the error colour. */
  tone?: 'neutral' | 'error';
  /** A smaller padding for narrow panels such as the Live-mini window. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  message,
  title,
  icon,
  action,
  tone = 'neutral',
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'ui-empty',
        tone === 'error' && 'ui-empty--error',
        compact && 'ui-empty--compact',
        className,
      )}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className="ui-empty__icon" aria-hidden="true">
        {icon ?? <Inbox size={20} />}
      </span>
      {title != null && <strong className="ui-empty__title">{title}</strong>}
      <p className="ui-empty__text">{message}</p>
      {action != null && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
