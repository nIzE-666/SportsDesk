import type { ReactNode } from 'react';
import { cx } from './classes';

export interface StatTileProps {
  label: ReactNode;
  /** A missing value hides the whole tile; zero is a real value and stays. */
  value?: ReactNode;
  note?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, note, className }: StatTileProps) {
  if (value == null || value === '') return null;
  return (
    <div className={cx('ui-stat', className)}>
      <span className="ui-stat__label">{label}</span>
      <strong className="ui-stat__value">{value}</strong>
      {note != null && note !== '' && <span className="ui-stat__note">{note}</span>}
    </div>
  );
}
