import type { SportsEvent } from './EventCenter';

export type EventFilter = 'all' | 'unread' | 'football' | 'f1';

/**
 * Filters worth offering. «Все» comes first and only together with another choice; «Непрочитанные»
 * appears while some, but not all, events are unread, and the sports while both are present.
 * A selected filter always stays, so it can be undone.
 */
export function eventFilterChoices(
  events: readonly SportsEvent[],
  active: EventFilter,
): EventFilter[] {
  const unread = events.filter((e) => !e.read).length;
  const choices: EventFilter[] = [];
  if ((unread > 0 && unread < events.length) || active === 'unread') choices.push('unread');
  if (new Set(events.map((e) => e.sport)).size > 1 || active === 'football' || active === 'f1')
    choices.push('football', 'f1');
  return choices.length ? ['all', ...choices] : [];
}

export function filterEvents(events: readonly SportsEvent[], filter: EventFilter): SportsEvent[] {
  return events.filter(
    (e) => filter === 'all' || (filter === 'unread' ? !e.read : e.sport === filter),
  );
}
