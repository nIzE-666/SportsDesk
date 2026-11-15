import type { ReactNode } from 'react';
import { cx } from './classes';

export interface FieldProps {
  /** Visible label of the control. */
  label: ReactNode;
  /** Id of the form control the label belongs to. */
  htmlFor?: string;
  /** One short note under the control. */
  hint?: ReactNode;
  /** Put the label and the control on one line. */
  inline?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * One labelled form control: a label, the control itself and an optional hint.
 * The control is passed as a child, so selects, inputs and ranges share one
 * pattern.
 */
export function Field({ label, htmlFor, hint, inline = false, children, className }: FieldProps) {
  const labelClass = 'ui-field__label';
  return (
    <div className={cx('ui-field', inline && 'ui-field--inline', className)}>
      {htmlFor ? (
        <label className={labelClass} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      <div className="ui-field__control">{children}</div>
      {hint != null && <p className="ui-field__hint">{hint}</p>}
    </div>
  );
}
