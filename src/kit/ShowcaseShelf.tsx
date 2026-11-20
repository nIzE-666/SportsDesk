import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { IconButton } from './Button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from './classes';

export interface ShowcaseShelfProps {
  /** The shelf title, for example «Лучшее за неделю». */
  title: ReactNode;
  /** The cards of the shelf. */
  children?: ReactNode;
  /** Shown instead of the row when there are no cards. */
  emptyText: string;
  headingLevel?: 2 | 3;
  className?: string;
}

function smoothScroll(row: HTMLElement, left: number): void {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollBy({ left, behavior: reduced ? 'auto' : 'smooth' });
}

function focusCard(item: HTMLElement): void {
  const target =
    item.querySelector<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])') ?? null;
  if (!target) return;
  target.focus();
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/**
 * A titled horizontal row of cards with scroll snap and the two page arrows.
 * Left and Right move focus between the cards, Home and End jump to the ends.
 */
export function ShowcaseShelf({
  title,
  children,
  emptyText,
  headingLevel = 3,
  className,
}: ShowcaseShelfProps) {
  const titleId = useId();
  const rowRef = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const cards = Children.toArray(children);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  const updateEnds = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    setAtStart(max <= 1 || row.scrollLeft <= 1);
    setAtEnd(max <= 1 || row.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    updateEnds();
    const row = rowRef.current;
    if (!row) return;
    row.addEventListener('scroll', updateEnds, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateEnds) : null;
    observer?.observe(row);
    return () => {
      row.removeEventListener('scroll', updateEnds);
      observer?.disconnect();
    };
  }, [updateEnds, cards.length]);

  const page = (direction: 1 | -1) => {
    const row = rowRef.current;
    if (!row) return;
    smoothScroll(row, direction * row.clientWidth);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const row = rowRef.current;
    if (!row) return;
    const items = Array.from(row.children) as HTMLElement[];
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.contains(document.activeElement));
    let next: number;
    if (event.key === 'ArrowRight') {
      next = current < 0 ? 0 : Math.min(items.length - 1, current + 1);
    } else if (event.key === 'ArrowLeft') {
      next = current < 0 ? items.length - 1 : Math.max(0, current - 1);
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = items.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const item = items[next];
    if (item) focusCard(item);
  };

  return (
    <section className={cx('ui-showcase-shelf', className)} aria-labelledby={titleId}>
      <header className="ui-showcase-shelf__head">
        <Heading className="ui-showcase-shelf__title" id={titleId}>
          <span className="ui-showcase-shelf__mark" aria-hidden="true">
            //
          </span>
          <span className="ui-showcase-shelf__title-text">{title}</span>
        </Heading>
        <span className="ui-showcase-shelf__rule" aria-hidden="true" />
        <div className="ui-showcase-shelf__arrows">
          <IconButton
            aria-label="Назад"
            title="Назад"
            small
            icon={<ChevronLeft size={16} aria-hidden="true" />}
            disabled={atStart}
            onClick={() => page(-1)}
          />
          <IconButton
            aria-label="Вперёд"
            title="Вперёд"
            small
            icon={<ChevronRight size={16} aria-hidden="true" />}
            disabled={atEnd}
            onClick={() => page(1)}
          />
        </div>
      </header>

      {cards.length > 0 ? (
        <ul
          ref={rowRef}
          className="ui-showcase-shelf__row"
          role="list"
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
        >
          {cards.map((card, index) => (
            <li
              className="ui-showcase-shelf__item"
              key={isValidElement(card) ? (card.key ?? index) : index}
            >
              {card}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-showcase-shelf__empty">{emptyText}</p>
      )}
    </section>
  );
}
