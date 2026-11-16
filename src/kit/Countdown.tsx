import { useEffect, useRef, useState } from 'react';
import { cx } from './classes';

export interface CountdownProps {
  /** ISO time of the start. */
  target: string;
  /** Shown when the target time has come. */
  endedLabel: string;
  /** Clock for tests; the app uses the real time. */
  now?: () => number;
  className?: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

/** «1 день», «2 дня», «5 дней» — the Russian plural for whole days. */
export function pluralDays(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function clockPart(totalSeconds: number): string {
  const rest = totalSeconds % (DAY / SECOND);
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor((rest % 3600) / 60);
  const seconds = rest % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function visibleLabel(remaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remaining / SECOND));
  const days = Math.floor(totalSeconds / (DAY / SECOND));
  if (days >= 1) return `через ${days} ${pluralDays(days)} · ${clockPart(totalSeconds)}`;
  return clockPart(totalSeconds);
}

function spokenLabel(remaining: number, endedLabel: string): string {
  if (remaining <= 0) return endedLabel;
  const totalSeconds = Math.max(0, Math.floor(remaining / MINUTE) * 60);
  const days = Math.floor(totalSeconds / (DAY / SECOND));
  const clock = clockPart(totalSeconds).slice(0, 5);
  return days >= 1 ? `через ${days} ${pluralDays(days)} · ${clock}` : clock;
}

/**
 * Time left until a start. The seconds tick only while the component is mounted
 * and the document is visible; the screen-reader label is refreshed once a minute.
 */
export function Countdown({ target, endedLabel, now, className }: CountdownProps) {
  const nowRef = useRef(now);
  nowRef.current = now;
  const [current, setCurrent] = useState(() => (now ?? Date.now)());
  const targetMs = new Date(target).getTime();
  const remaining = targetMs - current;

  useEffect(() => {
    let timer: number | null = null;
    const tick = () => setCurrent((nowRef.current ?? Date.now)());
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      tick();
      timer = window.setInterval(tick, SECOND);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };
    if (document.visibilityState === 'hidden') tick();
    else start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!Number.isFinite(targetMs)) return null;

  const label = remaining <= 0 ? endedLabel : visibleLabel(remaining);

  return (
    <span
      className={cx('ui-countdown', className)}
      role="timer"
      aria-label={spokenLabel(remaining, endedLabel)}
    >
      <span className="ui-countdown__digits" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
