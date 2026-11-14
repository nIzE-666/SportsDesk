import { grandPrixTitle } from './calendarModel';
import { formatShort, parseUtc } from './time';
import type { OpenF1Meeting, OpenF1Session } from './types';

/** OpenF1 names meetings in English; show the Russian name the calendar uses. */
export function meetingTitle(meeting: OpenF1Meeting): string | null {
  const name = meeting.meeting_name ?? meeting.meeting_official_name;
  return name ? grandPrixTitle(name).title : null;
}

export function meetingLabel(meeting: OpenF1Meeting): string {
  const title = meetingTitle(meeting) ?? 'Гран-при';
  return meeting.location ? `${title} — ${meeting.location}` : title;
}

export function sessionShortDate(session: OpenF1Session): string | null {
  if (!session.date_start) return null;
  return formatShort(parseUtc(session.date_start.slice(0, 10), session.date_start.slice(11)));
}

const SESSION_NAMES: Record<string, string> = {
  race: 'Гонка',
  qualifying: 'Квалификация',
  sprint: 'Спринт',
  'sprint qualifying': 'Квалификация спринта',
  'sprint shootout': 'Квалификация спринта',
  'practice 1': 'Практика 1',
  'practice 2': 'Практика 2',
  'practice 3': 'Практика 3',
};

/** OpenF1 sends session names in English; show the Russian names the app uses. */
export function sessionNameLabel(name: string | null | undefined): string | null {
  const value = name?.trim();
  if (!value) return null;
  return SESSION_NAMES[value.toLowerCase()] ?? value;
}

export function sessionLabel(session: OpenF1Session): string {
  const name = sessionNameLabel(session.session_name) ?? `Сессия ${session.session_key}`;
  const date = sessionShortDate(session);
  return date ? `${name} · ${date}` : name;
}
