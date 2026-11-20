import { getJson, setJson } from '../football/storage';

export const HIDE_HOME_INTEREST_KEY = 'sportsdesk.view.home.hideInterest';
export const HOME_REMINDERS_KEY = 'sportsdesk.view.home.reminders';

export interface HomeReminder {
  key: string;
  start: number;
  fixture?: { id: string; leagueId: string };
}

export function readHomeReminders(now = Date.now()): HomeReminder[] {
  const saved = getJson<unknown>(HOME_REMINDERS_KEY, []);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter(
      (row): row is HomeReminder =>
        !!row &&
        typeof row === 'object' &&
        typeof row.key === 'string' &&
        row.key.length <= 200 &&
        Number.isFinite(row.start) &&
        row.start > now - 7 * 24 * 60 * 60 * 1000 &&
        (row.fixture === undefined ||
          (typeof row.fixture?.id === 'string' && typeof row.fixture?.leagueId === 'string')),
    )
    .slice(-100);
}

export function toggleHomeReminder(reminder: HomeReminder, now: number): HomeReminder[] {
  const current = readHomeReminders(now);
  const next = current.some((row) => row.key === reminder.key)
    ? current.filter((row) => row.key !== reminder.key)
    : [...current, reminder].slice(-100);
  setJson(HOME_REMINDERS_KEY, next);
  return next;
}
