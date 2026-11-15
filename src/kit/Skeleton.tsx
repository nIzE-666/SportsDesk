import type { HTMLAttributes } from 'react';
import { cx } from './classes';

export type SkeletonProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

/** One loading placeholder; the parent sets the width through a class. */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return <span {...rest} className={cx('ui-skeleton', className)} aria-hidden="true" />;
}
