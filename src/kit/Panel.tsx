import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './classes';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

/** A surface with the large radius, border and first-level shadow. */
export function Panel({ className, children, ...rest }: PanelProps) {
  return (
    <section {...rest} className={cx('ui-panel', className)}>
      {children}
    </section>
  );
}

export interface PanelHeaderProps {
  /** The panel title is always an `h2`. */
  title: ReactNode;
  /** At most one action. */
  action?: ReactNode;
  /** Use it as `aria-labelledby` of the panel. */
  id?: string;
  className?: string;
}

export function PanelHeader({ title, action, id, className }: PanelHeaderProps) {
  return (
    <div className={cx('ui-panel__header', className)}>
      <h2 id={id} className="ui-panel__title">
        {title}
      </h2>
      {action != null && <div className="ui-panel__action">{action}</div>}
    </div>
  );
}
