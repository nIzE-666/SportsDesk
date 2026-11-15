import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './classes';

export type ButtonVariant = 'default' | 'primary' | 'quiet';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** One primary action per screen or panel. */
  variant?: ButtonVariant;
  /** Dangerous action modifier; it can be combined with any variant. */
  danger?: boolean;
  /** `--control-sm` height instead of `--control-md`. */
  small?: boolean;
  /** Disables the button and shows the spinner. */
  busy?: boolean;
  /** Leading icon; replaced by the spinner while busy. */
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'default',
  danger = false,
  small = false,
  busy = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        'ui-button',
        variant !== 'default' && `ui-button--${variant}`,
        danger && 'ui-button--danger',
        small && 'ui-button--small',
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <Loader2 size={16} className="ui-button__spinner" aria-hidden="true" /> : icon}
      {children != null && children !== false && (
        <span className="ui-button__label">{children}</span>
      )}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Icon buttons have no visible text, so the name is required. */
  'aria-label': string;
  icon: ReactNode;
  variant?: 'default' | 'quiet';
  danger?: boolean;
  small?: boolean;
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  variant = 'quiet',
  danger = false,
  small = false,
  busy = false,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      {...rest}
      ref={ref}
      type={type}
      variant={variant}
      danger={danger}
      small={small}
      busy={busy}
      icon={icon}
      className={cx('ui-button--icon', className)}
    />
  );
}
