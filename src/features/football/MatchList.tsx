import { useId, type ReactNode } from 'react';
import { formatHumanDate } from '../../lib/humanDate';
import { cx } from '../../kit/classes';
import './MatchList.css';

/**
 * One list of rows grouped by day. The kit `MatchRow` decides how a row looks;
 * screens pass already formatted times and build each row themselves, so the
 * same grouping works for league, cup and live lists.
 */
export interface MatchListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  /** Calendar date (`2026-11-22`) or an ISO timestamp of the kick-off. */
  getTime: (item: T) => string | null | undefined;
  renderRow: (item: T) => ReactNode;
  timezone: string;
  now?: number;
  /**
   * `nearest` shows today first, then coming and past days by distance from it;
   * `ascending` is calendar order. Rows inside a day always go by time.
   */
  dayOrder?: 'nearest' | 'ascending';
  className?: string;
}

export interface MatchDayGroup<T> {
  key: string | null;
  label: string;
  items: T[];
}

const DAY_MS = 86_400_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timezone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timezone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

/** Local calendar day of a value: the date itself or the day of a timestamp in the timezone. */
export function matchDayKey(value: string | null | undefined, timezone: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = dayFormatter(timezone);
  if (!formatter) return null;
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toLocaleUpperCase('ru')}${value.slice(1)}` : value;
}

/** «Сегодня», «Завтра», «сб, 22 нояб.»; a missing day stays honest. */
export function matchDayLabel(day: string | null, timezone: string, now: number): string {
  if (!day) return 'Без даты';
  const label = formatHumanDate(day, timezone, now);
  return /^(сегодня|завтра|вчера)(?:\s|$)/u.test(label) ? capitalize(label) : label;
}

function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  if (!match) return null;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

function sortValue(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function groupMatchesByDay<T>(
  items: readonly T[],
  getTime: (item: T) => string | null | undefined,
  timezone: string,
  now: number,
  dayOrder: 'nearest' | 'ascending' = 'nearest',
): MatchDayGroup<T>[] {
  const today = matchDayKey(new Date(now).toISOString(), timezone);
  const todayNumber = today ? dayNumber(today) : null;
  const groups = new Map<string | null, MatchDayGroup<T>>();
  for (const item of items) {
    const day = matchDayKey(getTime(item), timezone);
    let group = groups.get(day);
    if (!group) {
      group = { key: day, label: matchDayLabel(day, timezone, now), items: [] };
      groups.set(day, group);
    }
    group.items.push(item);
  }
  const ordered = [...groups.values()];
  ordered.sort((first, second) => {
    const firstDay = first.key ? dayNumber(first.key) : null;
    const secondDay = second.key ? dayNumber(second.key) : null;
    if (firstDay === null || secondDay === null) {
      if (firstDay === secondDay) return 0;
      return firstDay === null ? 1 : -1;
    }
    if (dayOrder === 'ascending' || todayNumber === null) return firstDay - secondDay;
    const distance = Math.abs(firstDay - todayNumber) - Math.abs(secondDay - todayNumber);
    if (distance !== 0) return distance;
    const firstFuture = firstDay >= todayNumber ? 0 : 1;
    const secondFuture = secondDay >= todayNumber ? 0 : 1;
    return firstFuture - secondFuture || firstDay - secondDay;
  });
  for (const group of ordered)
    group.items = [...group.items].sort(
      (first, second) => sortValue(getTime(first)) - sortValue(getTime(second)),
    );
  return ordered;
}

export function MatchList<T>({
  items,
  getKey,
  getTime,
  renderRow,
  timezone,
  now = Date.now(),
  dayOrder = 'nearest',
  className,
}: MatchListProps<T>) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const groups = groupMatchesByDay(items, getTime, timezone, now, dayOrder);
  return (
    <div className={cx('match-list', className)}>
      {groups.map((group, index) => {
        const headingId = `${baseId}-day-${index}`;
        return (
          <section
            className="match-list__day"
            key={group.key ?? 'none'}
            aria-labelledby={headingId}
          >
            <h3 className="match-list__heading" id={headingId}>
              {group.label}
            </h3>
            <ul className="match-list__rows">
              {group.items.map((item) => (
                <li key={getKey(item)}>{renderRow(item)}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
