import { useId, type ReactNode } from 'react';
import { cx } from './classes';

export interface TooltipProps {
  /** A short hint, not a paragraph. */
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

/** The bubble shows on hover and on focus inside the trigger. */
export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  const id = useId();
  return (
    <span className={cx('ui-tooltip', className)} data-side={side} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="ui-tooltip__bubble">
        {label}
      </span>
    </span>
  );
}
