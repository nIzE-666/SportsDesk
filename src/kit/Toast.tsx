import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { cx } from './classes';

export interface ToastProps {
  message: ReactNode;
  /** One action, usually «Открыть». */
  action?: ReactNode;
  /** The parent decides when the toast disappears. */
  onDismiss?: () => void;
  dismissLabel?: string;
  tone?: 'info' | 'error';
  className?: string;
}

export function Toast({
  message,
  action,
  onDismiss,
  dismissLabel = 'Закрыть',
  tone = 'info',
  className,
}: ToastProps) {
  return (
    <div
      className={cx('ui-toast', className)}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <span className="ui-toast__message">{message}</span>
      {action != null && <span className="ui-toast__action">{action}</span>}
      {onDismiss && (
        <IconButton
          icon={<X size={16} aria-hidden="true" />}
          aria-label={dismissLabel}
          small
          onClick={onDismiss}
        />
      )}
    </div>
  );
}
