import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { IconButton } from './Button';
import { cx } from './classes';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** At most two actions, the main one last. */
  footer?: ReactNode;
  closeLabel?: string;
  className?: string;
}

/**
 * One dialog: keeps focus inside, closes on Escape and returns focus to the
 * opener. The opener is whatever had focus before the dialog mounted.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = 'Закрыть',
  className,
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(panel, open, onClose);

  if (!open) return null;
  return (
    <div
      className="ui-dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={cx('ui-dialog', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ui-dialog__header">
          <h2 id={titleId} className="ui-dialog__title">
            {title}
          </h2>
          <IconButton
            icon={<X size={18} aria-hidden="true" />}
            aria-label={closeLabel}
            onClick={onClose}
          />
        </div>
        <div className="ui-dialog__body">{children}</div>
        {footer != null && <div className="ui-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}
