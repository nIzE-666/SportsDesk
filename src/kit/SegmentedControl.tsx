import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './classes';

export interface SegmentItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  items: readonly SegmentItem[];
  /** Id of the chosen option. */
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the group, for example «Период». */
  ariaLabel: string;
  className?: string;
}

/** A radio group with one tab stop and arrow-key movement. */
export function SegmentedControl({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const tabStop = enabled.some((item) => item.id === value) ? value : enabled[0]?.id;

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!enabled.length) return;
    const index = enabled.findIndex((item) => item.id === value);
    let nextIndex: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      nextIndex = (index + 1 + enabled.length) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      nextIndex = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = enabled.length - 1;
    else return;
    event.preventDefault();
    const next = enabled[nextIndex];
    if (!next) return;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };

  return (
    <div className={cx('ui-segmented', className)} role="radiogroup" aria-label={ariaLabel}>
      {items.map((item) => {
        const checked = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="radio"
            className="ui-segmented__option"
            aria-checked={checked}
            disabled={item.disabled}
            tabIndex={item.id === tabStop ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={move}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
