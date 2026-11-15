import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './classes';

export interface EmptyStateProps {
  /** One sentence; the reason or the next step. */
  message: ReactNode;
  /** One icon; the inbox by default. */
  icon?: ReactNode;
  /** At most one action. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ message, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', className)} role="status">
      <span className="ui-empty__icon" aria-hidden="true">
        {icon ?? <Inbox size={20} />}
      </span>
      <p className="ui-empty__text">{message}</p>
      {action != null && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
