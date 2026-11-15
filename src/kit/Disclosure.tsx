import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './classes';

export interface DisclosureProps {
  /** Visible name of the folded part. */
  label: ReactNode;
  /** One short note next to the name. */
  hint?: ReactNode;
  children: ReactNode;
  /** Closed by default; long settings parts stay out of the way. */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * A folded part of a page: a quiet button with the arrow and a body that is
 * only rendered while open. It is the kit answer for long settings lists.
 */
export function Disclosure({
  label,
  hint,
  children,
  defaultOpen = false,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={cx('ui-disclosure', open && 'ui-disclosure--open', className)}>
      <Button
        variant="quiet"
        className="ui-disclosure__trigger"
        icon={<ChevronDown size={16} aria-hidden="true" />}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ui-disclosure__label">{label}</span>
        {hint != null && <span className="ui-disclosure__hint">{hint}</span>}
      </Button>
      {open && (
        <div id={bodyId} className="ui-disclosure__body">
          {children}
        </div>
      )}
    </div>
  );
}
