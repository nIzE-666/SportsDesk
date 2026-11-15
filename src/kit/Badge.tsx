import type { ReactNode } from 'react';
import { cx } from './classes';

export type BadgeVariant = 'neutral' | 'live' | 'win' | 'draw' | 'loss' | 'warning';

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  return (
    <span className={cx('ui-badge', variant !== 'neutral' && `ui-badge--${variant}`, className)}>
      {children}
    </span>
  );
}
