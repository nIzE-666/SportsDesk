import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './classes';

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Navigation strips may use a real link. */
  href?: string;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** Accessible name of the strip. */
  ariaLabel: string;
  /**
   * `tabs` — WAI-ARIA in-page tabs with arrow keys.
   * `nav` — a navigation strip with `aria-current="page"`.
   */
  mode?: 'tabs' | 'nav';
  /** Selected tab id, or the current page id in the navigation mode. */
  active?: string;
  onChange?: (id: string) => void;
  className?: string;
}

export function Tabs({ items, ariaLabel, mode = 'tabs', active, onChange, className }: TabsProps) {
  const refs = useRef(new Map<string, HTMLElement>());
  const enabled = items.filter((item) => !item.disabled);
  const currentId = active ?? enabled[0]?.id ?? '';
  const rootClass = cx('ui-tabs', mode === 'nav' && 'ui-tabs--nav', className);

  const focusAndSelect = (id: string) => {
    if (id !== currentId) onChange?.(id);
    refs.current.get(id)?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (mode !== 'tabs' || !enabled.length) return;
    const index = enabled.findIndex((item) => item.id === currentId);
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1 + enabled.length) % enabled.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = enabled.length - 1;
    else return;
    event.preventDefault();
    const next = enabled[nextIndex];
    if (next) focusAndSelect(next.id);
  };

  const content = items.map((item) => {
    const selected = item.id === currentId;
    const setRef = (node: HTMLElement | null) => {
      if (node) refs.current.set(item.id, node);
      else refs.current.delete(item.id);
    };

    if (mode === 'nav') {
      const body = (
        <>
          {item.icon && (
            <span className="ui-tab__icon" aria-hidden="true">
              {item.icon}
            </span>
          )}
          {item.label}
        </>
      );
      if (item.href) {
        return (
          <a
            key={item.id}
            ref={setRef}
            href={item.href}
            className="ui-tab"
            aria-current={selected ? 'page' : undefined}
            aria-disabled={item.disabled || undefined}
            tabIndex={item.disabled ? -1 : undefined}
            onClick={(event) => {
              if (item.disabled) {
                event.preventDefault();
                return;
              }
              onChange?.(item.id);
            }}
          >
            {body}
          </a>
        );
      }
      return (
        <button
          key={item.id}
          ref={setRef}
          type="button"
          className="ui-tab"
          aria-current={selected ? 'page' : undefined}
          disabled={item.disabled}
          onClick={() => onChange?.(item.id)}
        >
          {body}
        </button>
      );
    }

    return (
      <button
        key={item.id}
        ref={setRef}
        type="button"
        role="tab"
        className="ui-tab"
        aria-selected={selected}
        disabled={item.disabled}
        tabIndex={selected ? 0 : -1}
        onClick={() => onChange?.(item.id)}
        onKeyDown={onTabKeyDown}
      >
        {item.icon && (
          <span className="ui-tab__icon" aria-hidden="true">
            {item.icon}
          </span>
        )}
        {item.label}
      </button>
    );
  });

  if (mode === 'nav') {
    return (
      <nav className={rootClass} aria-label={ariaLabel}>
        {content}
      </nav>
    );
  }
  return (
    <div className={rootClass} role="tablist" aria-label={ariaLabel}>
      {content}
    </div>
  );
}
