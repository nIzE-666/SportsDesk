import { getUserTimezone } from '../football/storage';
import { readPolicy } from '../settings/notificationPolicy';

/**
 * Тихие часы уведомлений для атмосферных сигналов. Правило то же, что в Rust
 * (`NotificationPolicy::quiet`): часовой пояс пользователя, окно может идти
 * через полночь, а совпадающие границы означают «тихо всегда».
 */

/** «ЧЧ:ММ» → минуты от начала суток; null для некорректной записи. */
export function clockMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** Минуты от начала суток в выбранном часовом поясе. */
export function localMinutes(now: number, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(now));
    const hours = Number(parts.find((part) => part.type === 'hour')?.value);
    const minutes = Number(parts.find((part) => part.type === 'minute')?.value);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
  } catch {
    return null;
  }
}

export function isQuietNow(now: number = Date.now()): boolean {
  const policy = readPolicy();
  if (!policy.quietEnabled) return false;
  const start = clockMinutes(policy.quietStart);
  const end = clockMinutes(policy.quietEnd);
  if (start === null || end === null) return false;
  const minute = localMinutes(now, getUserTimezone());
  if (minute === null) return false;
  if (start === end) return true;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
