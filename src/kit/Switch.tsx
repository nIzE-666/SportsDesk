import type { ReactNode } from 'react';
import { cx } from './classes';

export interface SwitchProps {
  /** Main text of the switch; it also names the control for a screen reader. */
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** One short line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * One on/off switch for settings and the setup wizard. The native checkbox
 * keeps the keyboard, form and screen-reader behaviour; the track only draws
 * its state.
 */
export function Switch({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  className,
  id,
}: SwitchProps) {
  return (
    <label className={cx('ui-switch', disabled && 'ui-switch--disabled', className)}>
      <span className="ui-switch__control">
        <input
          id={id}
          type="checkbox"
          className="ui-switch__input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="ui-switch__track" aria-hidden="true">
          <span className="ui-switch__thumb" />
        </span>
      </span>
      <span className="ui-switch__text">
        <span className="ui-switch__label">{label}</span>
        {description != null && <span className="ui-switch__description">{description}</span>}
      </span>
    </label>
  );
}
