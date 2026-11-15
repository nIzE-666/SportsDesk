import { useId, type ReactNode } from 'react';
import { formatHumanDate } from '../../lib/humanDate';
import { cx } from '../../kit/classes';
import './MatchList.css';

/**
 * One list of rows grouped by day or by month. The kit `MatchRow` decides how
 * a row looks; screens pass already formatted times and build each row
 * themselves, so the same grouping works for league, cup and club lists.
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
   * `ascending` is calendar order. Rows inside a group always go by time.
   */
  dayOrder?: 'nearest' | 'ascending';
  /** `day` is the list of U4.2; `month` is for a season schedule of one club. */
  grouping?: 'day' | 'month';
  /** Show at most this many rows in group order; the caller adds «Показать все». */
  limit?: number;
  className?: string;
}

export interface MatchDayGroup<T> {
  key: string | null;
  label: string;
  items: T[];
}

const DAY_MS = 86_400_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const monthFormatterCache = new Map<string, Intl.DateTimeFormat>();

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

function monthFormatter(timezone: string): Intl.DateTimeFormat | null {
  const cached = monthFormatterCache.get(timezone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      month: 'long',
      year: 'numeric',
    });
    monthFormatterCache.set(timezone, formatter);
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

/** «Ноябрь 2026» from a `YYYY-MM` key, in the same timezone as the matches. */
export function matchMonthLabel(month: string | null, timezone: string): string {
  if (!month) return 'Без даты';
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (!match) return 'Без даты';
  const year = Number(match[1]);
  const number = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(number)) return 'Без даты';
  const formatter = monthFormatter(timezone);
  if (!formatter) return 'Без даты';
  const date = new Date(Date.UTC(year, number - 1, 15, 12));
  const parts = formatter.formatToParts(date);
  const monthName = parts.find((part) => part.type === 'month')?.value;
  const yearName = parts.find((part) => part.type === 'year')?.value;
  if (!monthName || !yearName) return 'Без даты';
  return capitalize(`${monthName} ${yearName}`);
}

/** `YYYY-MM` of the local calendar day; a missing date stays ungrouped. */
export function matchMonthKey(value: string | null | undefined, timezone: string): string | null {
  const day = matchDayKey(value, timezone);
  return day ? day.slice(0, 7) : null;
}

function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  if (!match) return null;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

function monthNumber(month: string): number | null {
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function sortValue(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function orderGroups<T>(
  groups: Map<string | null, MatchDayGroup<T>>,
  keyNumber: (key: string) => number | null,
  todayNumber: number | null,
  dayOrder: 'nearest' | 'ascending',
): MatchDayGroup<T>[] {
  const ordered = [...groups.values()];
  ordered.sort((first, second) => {
    const firstDay = first.key ? keyNumber(first.key) : null;
    const secondDay = second.key ? keyNumber(second.key) : null;
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
  return ordered;
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
  const ordered = orderGroups(groups, dayNumber, todayNumber, dayOrder);
  for (const group of ordered)
    group.items = [...group.items].sort(
      (first, second) => sortValue(getTime(first)) - sortValue(getTime(second)),
    );
  return ordered;
}

/** Month groups for a club season; the same ordering rules as the day list. */
export function groupMatchesByMonth<T>(
  items: readonly T[],
  getTime: (item: T) => string | null | undefined,
  timezone: string,
  now: number,
  dayOrder: 'nearest' | 'ascending' = 'nearest',
): MatchDayGroup<T>[] {
  const today = matchMonthKey(new Date(now).toISOString(), timezone);
  const todayNumber = today ? monthNumber(today) : null;
  const groups = new Map<string | null, MatchDayGroup<T>>();
  for (const item of items) {
    const month = matchMonthKey(getTime(item), timezone);
    let group = groups.get(month);
    if (!group) {
      group = { key: month, label: matchMonthLabel(month, timezone), items: [] };
      groups.set(month, group);
    }
    group.items.push(item);
  }
  const ordered = orderGroups(groups, monthNumber, todayNumber, dayOrder);
  for (const group of ordered)
    group.items = [...group.items].sort(
      (first, second) => sortValue(getTime(first)) - sortValue(getTime(second)),
    );
  return ordered;
}

function limitGroups<T>(groups: MatchDayGroup<T>[], limit: number | undefined): MatchDayGroup<T>[] {
  if (limit === undefined || !Number.isFinite(limit) || limit < 0) return groups;
  let remaining = limit;
  return groups.flatMap((group) => {
    if (remaining <= 0) return [];
    const items = group.items.slice(0, remaining);
    remaining -= items.length;
    return items.length ? [{ ...group, items }] : [];
  });
}

export function MatchList<T>({
  items,
  getKey,
  getTime,
  renderRow,
  timezone,
  now = Date.now(),
  dayOrder = 'nearest',
  grouping = 'day',
  limit,
  className,
}: MatchListProps<T>) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const groups = limitGroups(
    grouping === 'month'
      ? groupMatchesByMonth(items, getTime, timezone, now, dayOrder)
      : groupMatchesByDay(items, getTime, timezone, now, dayOrder),
    limit,
  );
  return (
    <div className={cx('match-list', className)}>
      {groups.map((group, index) => {
        const headingId = `${baseId}-group-${index}`;
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
