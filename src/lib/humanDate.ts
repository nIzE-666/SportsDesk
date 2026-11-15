/**
 * Человеческие даты для списков и строк: «сегодня 21:30», «завтра 00:00», «вчера 18:05»,
 * дальше «сб, 22 нояб., 21:30», а для другого года «сб, 22 нояб. 2027, 21:30».
 *
 * День считается по календарю выбранного часового пояса, а не по часам компьютера: матч в 00:30 по
 * Якутску — уже «завтра», даже если в Москве ещё вечер. Значение «2026-11-22» без времени —
 * календарная дата: она не зависит от пояса и никогда не сдвигается на другой день.
 * Точная дата остаётся там, где дата — это и есть смысл: поля ввода, файлы экспорта, резервные копии,
 * диагностика.
 */

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const;
const MONTHS = [
  'янв.',
  'февр.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
] as const;
const DAY_MS = 86_400_000;

export type HumanDateInput = string | number | Date | null | undefined;

interface Parts {
  year: number;
  month: number;
  day: number;
  /** Нет у календарной даты без времени. */
  hour: number | null;
  minute: number | null;
}

const pad = (value: number) => String(value).padStart(2, '0');
const dayNumber = (parts: Pick<Parts, 'year' | 'month' | 'day'>) =>
  Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);

/** «2026-11-22» без времени и пояса; несуществующая дата («2026-02-30») не подходит. */
function calendarParts(value: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return null;
  return { year, month, day, hour: null, minute: null };
}

/** Год, месяц, день, часы и минуты момента времени в часовом поясе; неизвестный пояс даёт null. */
function zonedParts(date: Date, timeZone: string): Parts | null {
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const result: Parts = {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') % 24,
      minute: get('minute'),
    };
    return Object.values(result).every((part) => Number.isFinite(part)) ? result : null;
  } catch {
    return null;
  }
}

function describe(value: HumanDateInput, timeZone: string, now: number, withTime: boolean): string {
  if (value === null || value === undefined || value === '') return '—';
  // Дата вида «2026-02-30» не существует: её нельзя молча превращать в 2 марта.
  const calendar = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
  const target = calendar
    ? calendarParts(value as string)
    : zonedParts(value instanceof Date ? value : new Date(value), timeZone);
  const today = zonedParts(new Date(now), timeZone);
  if (!target || !today) return '—';
  const clock =
    withTime && target.hour !== null && target.minute !== null
      ? `${pad(target.hour)}:${pad(target.minute)}`
      : null;
  const offset = dayNumber(target) - dayNumber(today);
  if (offset >= -1 && offset <= 1) {
    const word = offset === 0 ? 'сегодня' : offset === 1 ? 'завтра' : 'вчера';
    return clock ? `${word} ${clock}` : word;
  }
  const weekday =
    WEEKDAYS[new Date(Date.UTC(target.year, target.month - 1, target.day)).getUTCDay()];
  const year = target.year === today.year ? '' : ` ${target.year}`;
  const date = `${weekday}, ${target.day} ${MONTHS[target.month - 1]}${year}`;
  return clock ? `${date}, ${clock}` : date;
}

/** День без времени: «сегодня», «завтра», «вчера», «сб, 22 нояб.», «сб, 22 нояб. 2027». */
export function formatHumanDate(
  value: HumanDateInput,
  timeZone: string,
  now: number = Date.now(),
): string {
  return describe(value, timeZone, now, false);
}

/**
 * День и время: «сегодня 21:30», «завтра 00:00», «сб, 22 нояб., 21:30».
 * Календарная дата без времени показывается без времени.
 */
export function formatHumanDateTime(
  value: HumanDateInput,
  timeZone: string,
  now: number = Date.now(),
): string {
  return describe(value, timeZone, now, true);
}

/**
 * Только время в часовом поясе: «21:30». Календарная дата без времени даёт null.
 * Нужно там, где день уже стоит отдельной строкой, например в списке по дням.
 */
export function formatHumanTime(value: HumanDateInput, timeZone: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const target = zonedParts(value instanceof Date ? value : new Date(value), timeZone);
  if (!target || target.hour === null || target.minute === null) return null;
  return `${pad(target.hour)}:${pad(target.minute)}`;
}
