import { Check, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './searchSelect.css';

export interface SearchSelectOption {
  value: string;
  label: string;
  group?: string;
}

export interface SearchSelectProps {
  /** Accessible name of the combobox. */
  ariaLabel: string;
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel?: string;
  /** A required choice has no clearing control and no empty result. */
  clearable?: boolean;
  className?: string;
}

interface OptionEntry {
  option: SearchSelectOption;
  index: number;
}

interface OptionGroup {
  name: string | null;
  items: OptionEntry[];
}

const LETTER_FOLDS: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ß: 'ss',
};

/** Case- and accent-insensitive text, so «odegaard» finds «Ødegaard». */
function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[æœøłđðþß]/g, (letter) => LETTER_FOLDS[letter] ?? letter);
}

function queryTokens(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function matchesQuery(label: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const text = normalizeSearchText(label);
  return tokens.every((token) => text.includes(token));
}

export function SearchSelect({
  ariaLabel,
  value,
  options,
  onChange,
  placeholder,
  clearLabel = 'Очистить выбор',
  clearable = true,
  className,
}: SearchSelectProps) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const listId = `${baseId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => {
    const tokens = editing ? queryTokens(query) : [];
    return options.filter((option) => matchesQuery(option.label, tokens));
  }, [editing, options, query]);
  const activeIndex = filtered.length ? Math.max(0, Math.min(active, filtered.length - 1)) : -1;

  const groups = useMemo(() => {
    const order: OptionGroup[] = [];
    const byName = new Map<string | null, OptionGroup>();
    filtered.forEach((option, index) => {
      const trimmed = option.group?.trim();
      const name = trimmed ? trimmed : null;
      let group = byName.get(name);
      if (!group) {
        group = { name, items: [] };
        byName.set(name, group);
        order.push(group);
      }
      group.items.push({ option, index });
    });
    return order;
  }, [filtered]);

  const openList = () => {
    if (open) return;
    setOpen(true);
    setEditing(false);
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  };

  const closeList = () => {
    setOpen(false);
    setEditing(false);
    setQuery('');
  };

  const choose = (option: SearchSelectOption) => {
    onChange(option.value);
    closeList();
  };

  const clear = () => {
    onChange('');
    closeList();
    // Keep the field ready for a new choice without reopening the list.
    skipFocusRef.current = true;
    inputRef.current?.focus();
    skipFocusRef.current = false;
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeList();
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document
      .getElementById(`${baseId}-option-${activeIndex}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, baseId, open]);

  const renderOption = ({ option, index }: OptionEntry) => {
    const isSelected = option.value === value;
    return (
      <div
        key={option.value}
        id={`${baseId}-option-${index}`}
        role="option"
        aria-selected={isSelected}
        className={`search-select-option${index === activeIndex ? ' active' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(option)}
      >
        <span>{option.label}</span>
        {isSelected && <Check size={14} className="search-select-check" aria-hidden="true" />}
      </div>
    );
  };

  return (
    <div
      className={`search-select${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
      ref={rootRef}
    >
      <div
        className="search-select-field"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          if (event.target !== inputRef.current) event.preventDefault();
        }}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          if (document.activeElement !== inputRef.current) inputRef.current?.focus();
          else if (!open) openList();
        }}
      >
        <Search className="search-select-icon" size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          className="search-select-input"
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          value={editing ? query : (selected?.label ?? '')}
          placeholder={placeholder}
          onFocus={() => {
            if (skipFocusRef.current) {
              skipFocusRef.current = false;
              return;
            }
            openList();
          }}
          onClick={(event) => {
            if (!open) openList();
            else if (!editing) event.currentTarget.select();
          }}
          onChange={(event) => {
            setEditing(true);
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && rootRef.current?.contains(next)) return;
            closeList();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) {
                openList();
                return;
              }
              if (!filtered.length) return;
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((current) => {
                const currentIndex = Math.max(0, Math.min(current, filtered.length - 1));
                return (currentIndex + step + filtered.length) % filtered.length;
              });
              return;
            }
            if (event.key === 'Enter') {
              if (!open) {
                event.preventDefault();
                openList();
                return;
              }
              const option = filtered[activeIndex];
              if (option) {
                event.preventDefault();
                choose(option);
              }
              return;
            }
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              closeList();
              return;
            }
            if (event.key === 'Tab') {
              closeList();
              return;
            }
            if (open && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
              if (event.key === 'Backspace' || event.key === 'Delete') {
                event.preventDefault();
                setEditing(true);
                setQuery('');
                setActive(0);
                return;
              }
              if (event.key.length === 1 && !event.nativeEvent.isComposing) {
                event.preventDefault();
                setEditing(true);
                setQuery(event.key);
                setActive(0);
              }
            }
          }}
        />
        {clearable && value !== '' && (
          <button
            type="button"
            className="search-select-clear"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={clear}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div className="search-select-popup" onMouseDown={(event) => event.preventDefault()}>
          <div
            id={listId}
            role="listbox"
            aria-label="Список вариантов"
            className="search-select-list"
          >
            {groups.map((group) =>
              group.name ? (
                <div
                  key={group.name}
                  role="group"
                  aria-label={group.name}
                  className="search-select-group"
                >
                  <div className="search-select-group-label" aria-hidden="true">
                    {group.name}
                  </div>
                  {group.items.map(renderOption)}
                </div>
              ) : (
                <div key="ungrouped" role="presentation" className="search-select-group">
                  {group.items.map(renderOption)}
                </div>
              ),
            )}
          </div>
          {!filtered.length && (
            <p className="search-select-empty" role="status">
              Ничего не найдено
            </p>
          )}
        </div>
      )}
    </div>
  );
}
