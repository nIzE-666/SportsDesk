import { getJson, setJson } from '../football/storage';
import { spoilerKey } from '../spoilers/spoilerStore';
import type { SportsEvent } from '../events/EventCenter';

/**
 * «Праздник гола»: какие события Центра событий празднуются.
 *
 * Празднуется только подтверждённый новый гол (событие с автором из ленты
 * матча, id «football|goal|…»). Изменение счёта без события — это может быть
 * исправление или отмена — не празднуется. Уже показанные id запоминаются,
 * поэтому перерендер, обновление данных и перезапуск не повторяют праздник.
 */

export const CELEBRATED_KEY = 'sportsdesk.view.celebrated';
export const CELEBRATE_PREVIEW_EVENT = 'sportsdesk-celebrate-preview';
export const MAX_CELEBRATED = 300;
/** Гол старше этого окна считается архивным и не празднуется. */
export const FRESH_WINDOW_MS = 10 * 60 * 1000;

type GoalLike = Pick<SportsEvent, 'id' | 'sport' | 'kind' | 'occurredAt' | 'matchId'>;

export function isCelebratableGoal(event: Pick<SportsEvent, 'id' | 'sport' | 'kind'>): boolean {
  return (
    event.sport === 'football' && event.kind === 'goal' && event.id.startsWith('football|goal|')
  );
}

export function readCelebrated(): string[] {
  const value = getJson<unknown>(CELEBRATED_KEY, []);
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string').slice(-MAX_CELEBRATED);
}

export function rememberCelebrated(ids: string[]): void {
  if (!ids.length) return;
  const merged = [...new Set([...readCelebrated(), ...ids])].slice(-MAX_CELEBRATED);
  setJson(CELEBRATED_KEY, merged);
}

export function pickCelebrations<T extends GoalLike>(
  events: T[],
  options: { seen: ReadonlySet<string>; hidden: ReadonlySet<string>; now: number; since: number },
): T[] {
  return events.filter(
    (event) =>
      isCelebratableGoal(event) &&
      !options.seen.has(event.id) &&
      event.occurredAt >= options.since &&
      options.now - event.occurredAt <= FRESH_WINDOW_MS &&
      !(event.matchId && options.hidden.has(spoilerKey('football', event.matchId))),
  );
}
