import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './Button';
import { cx } from './classes';
import { PitchTrackLine } from './PitchTrackLine';

export type WeekTrackEventKind = 'match' | 'race';

export interface WeekTrackEvent {
  id: string;
  kind: WeekTrackEventKind;
  /** ISO start time. */
  start: string;
  /** 1–5, or `null` when the interest is unknown. */
  interest: number | null;
  /** Accessible name of the event button. */
  label: string;
  /** A team of the user; the event gets a ring. */
  mine?: boolean;
  /** The main match of the screen: a larger mark signed «главный матч». */
  featured?: boolean;
}

export interface WeekTrackProps {
  /** Monday of the week, ISO. */
  weekStart: string;
  /** The current moment, ISO. */
  now: string;
  events: WeekTrackEvent[];
  onOpen: (id: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  /** The hint shown above an event on hover and keyboard focus. */
  renderPreview: (id: string) => ReactNode;
  className?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });

/** The Russian month in the genitive case, as used in a date. */
function monthName(date: Date): string {
  return MONTH.format(date).replace(/^\d+\s*/, '');
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function calendarDiff(later: Date, earlier: Date): number {
  const first = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const second = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((first - second) / DAY_MS);
}

function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function weekRange(start: Date, end: Date): string {
  const first = start.getDate();
  const last = end.getDate();
  const firstMonth = monthName(start);
  const lastMonth = monthName(end);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${first} ${firstMonth} ${start.getFullYear()} — ${last} ${lastMonth} ${end.getFullYear()}`;
  }
  if (firstMonth !== lastMonth) return `${first} ${firstMonth} — ${last} ${lastMonth}`;
  return `${first}–${last} ${lastMonth}`;
}

function nowText(date: Date): string {
  return `${WEEKDAY.format(date)}, ${date.getDate()} ${monthName(date)}`;
}

function clockText(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const DAY_MINUTES = 24 * 60;
/** Positions are kept as whole steps of half a percent of the day. */
const POSITION_STEPS = 200;
/** The smallest distance between two marks, in the same steps (14% of a day). */
const MIN_GAP_STEPS = 28;

function positionOf(date: Date): number {
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const clamped = Math.min(DAY_MINUTES, Math.max(0, minutes));
  return Math.round((clamped / DAY_MINUTES) * POSITION_STEPS);
}

function atClass(steps: number): string {
  return `ui-week-track__at--p${steps}`;
}

interface PlacedEvent {
  event: WeekTrackEvent;
  base: number;
}

/**
 * Puts the events of one day on the same half-percent grid, keeps their order
 * and moves close ones at least `MIN_GAP_STEPS` apart. When the free span is
 * too small for every event, they are spread evenly across it.
 */
function spreadEvents(items: PlacedEvent[], lower: number, upper: number): Map<string, number> {
  const result = new Map<string, number>();
  if (items.length === 0) return result;

  const lo = Math.max(0, Math.min(POSITION_STEPS, lower));
  const hi = Math.max(lo, Math.min(POSITION_STEPS, upper));
  const count = items.length;

  let positions = items.map((item) => Math.min(hi, Math.max(lo, item.base)));
  for (let index = 1; index < count; index += 1) {
    positions[index] = Math.max(positions[index]!, positions[index - 1]! + MIN_GAP_STEPS);
  }
  for (let index = count - 2; index >= 0; index -= 1) {
    positions[index] = Math.min(positions[index]!, positions[index + 1]! - MIN_GAP_STEPS);
  }

  const fits =
    positions[0]! >= lo &&
    positions[count - 1]! <= hi &&
    positions.every(
      (position, index) => index === 0 || position - positions[index - 1]! >= MIN_GAP_STEPS,
    );
  if (!fits) {
    const step = count > 1 ? Math.min(MIN_GAP_STEPS, Math.floor((hi - lo) / (count - 1))) : 0;
    positions = items.map((_, index) => Math.min(hi, lo + index * step));
  }

  items.forEach((item, index) => result.set(item.event.id, positions[index]!));
  return result;
}

function placeDayEvents(
  events: WeekTrackEvent[],
  nowDate: Date,
  nowMs: number,
  withNow: boolean,
): Map<string, number> {
  const items = events.map((event) => ({
    event,
    base: positionOf(new Date(event.start)),
  }));
  if (!withNow) return spreadEvents(items, 0, POSITION_STEPS);

  const nowBase = positionOf(nowDate);
  const past = items.filter((item) => new Date(item.event.start).getTime() < nowMs);
  const ahead = items.filter((item) => new Date(item.event.start).getTime() >= nowMs);
  return new Map([
    ...spreadEvents(past, 0, nowBase - MIN_GAP_STEPS),
    ...spreadEvents(ahead, nowBase + MIN_GAP_STEPS, POSITION_STEPS),
  ]);
}

function interestClass(interest: number | null): string {
  if (interest == null || !Number.isInteger(interest) || interest < 1 || interest > 5) {
    return 'ui-week-track__dot--none';
  }
  return `ui-week-track__dot--interest-${interest}`;
}

/** A checkered flag on a short pole. */
function RaceFlag() {
  return (
    <svg className="ui-week-track__flag" viewBox="0 0 24 30" aria-hidden="true" focusable="false">
      <path
        className="ui-week-track__flag-cloth"
        d="M3.5 2.6C9 .6 14 4.6 22.6 2.6V14.2C14 16.2 9 12.2 3.5 14.2Z"
      />
      <path
        className="ui-week-track__flag-check"
        d="M3.5 2.6h4.8v3.9H3.5zM13.1 2.9h4.8v3.9h-4.8zM8.3 6.5h4.8v3.9H8.3zM17.9 6.3h4.7v3.9h-4.7zM3.5 10.4h4.8v3.8H3.5zM13.1 10.6h4.8v3.9h-4.8z"
      />
      <rect
        className="ui-week-track__flag-pole"
        x="1.3"
        y="1.2"
        width="2.3"
        height="28.8"
        rx="1.15"
      />
    </svg>
  );
}

/**
 * The week from Monday to Sunday drawn as a race track: the passed part is a
 * muted line and the rest is a kerb. Matches are dots sized by interest, races
 * are checkered flags, and «сейчас» glows where the current moment falls.
 */
export function WeekTrack({
  weekStart,
  now,
  events,
  onOpen,
  onPrevWeek,
  onNextWeek,
  renderPreview,
  className,
}: WeekTrackProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const tipBase = `ui-week-tip-${useId().replace(/:/g, '')}`;

  const firstDay = startOfDay(new Date(weekStart));
  const nowDate = new Date(now);
  const nowMs = nowDate.getTime();
  const weekStartMs = firstDay.getTime();
  const weekEndMs = addDays(firstDay, 7).getTime();
  const valid = Number.isFinite(weekStartMs) && Number.isFinite(nowMs);

  if (!valid) return null;

  const days = Array.from({ length: 7 }, (_, index) => addDays(firstDay, index));
  const eventsByDay: WeekTrackEvent[][] = Array.from({ length: 7 }, () => []);
  const ordered = [...events]
    .filter((event) => Number.isFinite(new Date(event.start).getTime()))
    .sort(
      (left, right) =>
        new Date(left.start).getTime() - new Date(right.start).getTime() ||
        left.id.localeCompare(right.id),
    );
  for (const event of ordered) {
    const index = calendarDiff(startOfDay(new Date(event.start)), firstDay);
    if (index >= 0 && index < 7) eventsByDay[index]!.push(event);
  }

  const nowInWeek = nowMs >= weekStartMs && nowMs < weekEndMs;
  const elapsed =
    nowMs <= weekStartMs
      ? 0
      : nowMs >= weekEndMs
        ? 1
        : (nowMs - weekStartMs) / (weekEndMs - weekStartMs);
  const nowDay = nowInWeek ? calendarDiff(startOfDay(nowDate), firstDay) : -1;
  const nowBase = positionOf(nowDate);
  const placedByDay = eventsByDay.map((dayEvents, index) =>
    placeDayEvents(dayEvents, nowDate, nowMs, index === nowDay),
  );
  const range = weekRange(days[0]!, days[6]!);
  const label = nowInWeek ? `Неделя ${range}, сейчас — ${nowText(nowDate)}` : `Неделя ${range}`;

  const closePreview = (id: string) => {
    setPreviewId((current) => (current === id ? null : current));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const plot = plotRef.current;
    if (!plot) return;
    const buttons = Array.from(plot.querySelectorAll<HTMLButtonElement>('.ui-week-track__event'));
    if (buttons.length === 0) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    const next =
      event.key === 'ArrowRight'
        ? current < 0
          ? 0
          : Math.min(buttons.length - 1, current + 1)
        : current < 0
          ? buttons.length - 1
          : Math.max(0, current - 1);
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <section className={cx('ui-week-track', className)}>
      <p className="ui-week-track__range">{range}</p>

      <div className="ui-week-track__frame">
        <IconButton
          aria-label="Предыдущая неделя"
          title="Предыдущая неделя"
          small
          icon={<ChevronLeft size={16} aria-hidden="true" />}
          onClick={onPrevWeek}
        />

        <div
          ref={plotRef}
          className="ui-week-track__plot"
          role="group"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          <PitchTrackLine variant="track" progress={elapsed} className="ui-week-track__line" />
          <ol className="ui-week-track__days">
            {days.map((day, index) => {
              const isPast = addDays(day, 1).getTime() <= nowMs;
              return (
                <li
                  key={index}
                  className={cx(
                    'ui-week-track__day',
                    isPast && 'ui-week-track__day--past',
                    index === nowDay && 'ui-week-track__day--now',
                  )}
                >
                  <span className="ui-week-track__day-head">
                    <span className="ui-week-track__day-label">{WEEKDAYS[weekdayIndex(day)]}</span>
                    <span className="ui-week-track__day-date" aria-hidden="true">
                      {day.getDate()}
                    </span>
                  </span>
                  <div className="ui-week-track__day-events">
                    {eventsByDay[index]!.map((event) => {
                      const passed = new Date(event.start).getTime() < nowMs;
                      const open = previewId === event.id;
                      const tipId = `${tipBase}-${event.id}`;
                      const position =
                        placedByDay[index]?.get(event.id) ?? positionOf(new Date(event.start));
                      return (
                        <div
                          className={cx('ui-week-track__slot', atClass(position))}
                          key={event.id}
                        >
                          <button
                            type="button"
                            className={cx(
                              'ui-week-track__event',
                              `ui-week-track__event--${event.kind}`,
                              passed ? 'ui-week-track__event--past' : 'ui-week-track__event--ahead',
                              event.mine && 'ui-week-track__event--mine',
                              event.featured && 'ui-week-track__event--featured',
                            )}
                            aria-label={event.label}
                            aria-describedby={open ? tipId : undefined}
                            onClick={() => onOpen(event.id)}
                            onMouseEnter={() => setPreviewId(event.id)}
                            onMouseLeave={() => closePreview(event.id)}
                            onFocus={() => setPreviewId(event.id)}
                            onBlur={() => closePreview(event.id)}
                          >
                            {event.kind === 'race' ? (
                              <RaceFlag />
                            ) : (
                              <span
                                className={cx('ui-week-track__dot', interestClass(event.interest))}
                                aria-hidden="true"
                              />
                            )}
                          </button>
                          {event.featured && event.kind === 'match' && (
                            <span className="ui-week-track__featured" aria-hidden="true">
                              главный матч
                            </span>
                          )}
                          {open && (
                            <div className="ui-week-track__tip" role="tooltip" id={tipId}>
                              {renderPreview(event.id)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {index === nowDay && (
                    <span className={cx('ui-week-track__now', atClass(nowBase))} aria-hidden="true">
                      <span className="ui-week-track__now-stem" />
                      <span className="ui-week-track__now-dot" />
                      <span className="ui-week-track__now-label">
                        сейчас · {clockText(nowDate)}
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <IconButton
          aria-label="Следующая неделя"
          title="Следующая неделя"
          small
          icon={<ChevronRight size={16} aria-hidden="true" />}
          onClick={onNextWeek}
        />
      </div>
    </section>
  );
}
