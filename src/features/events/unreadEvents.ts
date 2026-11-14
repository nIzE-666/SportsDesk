import { useEffect, useState } from 'react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import type { SportsEvent } from './EventCenter';

/** A local note that read flags changed; the rail badge reloads the list. */
export const EVENTS_CHANGED_EVENT = 'sportsdesk-events-changed';

export function notifyEventsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTS_CHANGED_EVENT));
}

function unreadOf(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter(
    (event) => event && typeof event === 'object' && (event as { read?: unknown }).read === false,
  ).length;
}

/** The unread count of the event center, as stored by the app. */
export function useUnreadEvents(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true,
      stop: (() => void) | undefined;
    const load = () => {
      void rpc<SportsEvent[]>('event_center_list')
        .then((events) => {
          if (active) setCount(unreadOf(events));
        })
        .catch(() => {
          /* No list, no badge: a guessed count would be worse than none. */
        });
    };
    load();
    window.addEventListener(EVENTS_CHANGED_EVENT, load);
    if (isTauriRuntime()) {
      void import('@tauri-apps/api/event')
        .then(async ({ listen }) => {
          const off = await listen('sportsdesk://events-changed', load);
          if (active) stop = off;
          else off();
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
      window.removeEventListener(EVENTS_CHANGED_EVENT, load);
      stop?.();
    };
  }, []);
  return count;
}
