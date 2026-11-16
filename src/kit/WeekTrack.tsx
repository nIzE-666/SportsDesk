import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
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

function interestClass(interest: number | null): string {
  if (interest == null || !Number.isInteger(interest) || interest < 1 || interest > 5) {
    return 'ui-week-track__dot--none';
  }
  return `ui-week-track__dot--interest-${interest}`;
}

/** A small checkered flag on a short pole, drawn with the showcase tokens. */
function RaceFlag() {
  return (
    <svg className="ui-week-track__flag" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className="ui-week-track__flag-pole" d="M4 1.5v21" />
      <path className="ui-week-track__flag-cloth" d="M4 3h18l-4 5 4 5H4z" />
      <path
        className="ui-week-track__flag-check"
        d="M4 3h4.6v5H4zM13.2 3h4.6v5h-4.6zM8.6 8h4.6v5H8.6z"
      />
    </svg>
  );
}

/**
 * The week from Monday to Sunday drawn on the showcase track: matches are dots
 * sized by interest, races are checkered flags, and «сейчас» glows where the
 * current moment falls inside the week.
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
    .filter((event) => {
      const start = new Date(event.start).getTime();
      return Number.isFinite(start);
    })
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
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
  const nowHour = Math.min(23, Math.max(0, nowDate.getHours()));
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
      <header className="ui-week-track__head">
        <Button variant="quiet" small onClick={onPrevWeek}>
          Предыдущая неделя
        </Button>
        <p className="ui-week-track__range">{range}</p>
        <Button variant="quiet" small onClick={onNextWeek}>
          Следующая неделя
        </Button>
      </header>

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
                <span className="ui-week-track__day-label">{WEEKDAYS[weekdayIndex(day)]}</span>
                <span className="ui-week-track__day-date" aria-hidden="true">
                  {day.getDate()}
                </span>
                <div className="ui-week-track__day-events">
                  {eventsByDay[index]!.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={cx(
                        'ui-week-track__event',
                        `ui-week-track__event--${event.kind}`,
                        event.mine && 'ui-week-track__event--mine',
                      )}
                      aria-label={event.label}
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
                  ))}
                </div>
                {index === nowDay && (
                  <span
                    className={cx('ui-week-track__now', `ui-week-track__now--h${nowHour}`)}
                    aria-hidden="true"
                  >
                    <span className="ui-week-track__now-stem" />
                    <span className="ui-week-track__now-dot" />
                    <span className="ui-week-track__now-label">сейчас</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="ui-week-track__preview">{previewId && renderPreview(previewId)}</div>
    </section>
  );
}
