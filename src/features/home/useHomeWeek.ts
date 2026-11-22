import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/bridge';
import { isCompetitionVisibleWith, useModules } from '../../lib/modules';
import { retainResource } from '../../lib/resourceHealth';
import { getUserTimezone } from '../football/storage';
import type { MatchSummary } from '../football/types';
import {
  archiveDay,
  archiveEvents,
  pruneWeekArchive,
  readArchivedDay,
  readArchivedEvents,
} from './weekArchive';
import {
  appendError,
  buildWeekDays,
  createTaskQueue,
  earlierFetchedAt,
  EVENTS_CONCURRENCY,
  FOLLOWED_COMPETITION_IDS,
  localDayKey,
  orderFinishedForEvents,
  parseDateMatches,
  parseEvents,
  parseSeasonMatches,
  resolveWeekWindow,
  selectWeekMatches,
  weekProgress,
  type WeekDay,
  type WeekError,
  type WeekEventState,
  type WeekMatch,
} from './weekData';

export interface HomeWeekData {
  /** Local days, oldest first; includes the week selected on the track. */
  days: WeekDay[];
  /** Details of finished matches, keyed by match id. */
  events: Record<string, WeekEventState>;
  /** Season matches of every followed competition, keyed by league id. */
  seasonMatches: Record<string, MatchSummary[]>;
  /** «загружено 34 из 61» for the event requests. */
  progress: ReturnType<typeof weekProgress>;
  errors: WeekError[];
  /** Oldest data timestamp of the week, for the screen's source line. */
  fetchedAt: string | null;
  /** At least one reply came from the local cache after a network failure. */
  stale: boolean;
  /** A day list, a season list or an event request is still running. */
  loading: boolean;
  timezone: string;
  reload: () => void;
}

interface WeekState {
  matches: Record<string, WeekMatch>;
  events: Record<string, WeekEventState>;
  seasons: Record<string, SeasonState>;
  errors: WeekError[];
  fetchedAt: string | null;
  stale: boolean;
  datesPending: number;
  eventsTotal: number;
}

interface SeasonState {
  matches: MatchSummary[] | null;
  fetchedAt: string | null;
  stale: boolean;
  loading: boolean;
}

function emptyState(): WeekState {
  return {
    matches: {},
    events: {},
    seasons: {},
    errors: [],
    fetchedAt: null,
    stale: false,
    datesPending: 0,
    eventsTotal: 0,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Не удалось загрузить данные.';
}

function calendarDay(now: number, timeZone: string): string {
  return localDayKey(now, timeZone);
}

function weekRequests(queue: ReturnType<typeof createTaskQueue>) {
  let active = true;
  const releases: Array<() => void> = [];
  return {
    alive: () => active,
    load: (path: string) =>
      queue.run(async () => {
        if (!active) return null;
        releases.push(retainResource('pitch', path));
        return api('pitch', path);
      }),
    dispose: () => {
      active = false;
      releases.forEach((release) => release());
    },
  };
}

/**
 * The week of the «Главное» screen: matches of the followed competitions from
 * seven days back to seven days ahead, their events and the season matches
 * used by the interest model. Results arrive progressively; nothing waits for
 * the whole week.
 */
export function useHomeWeek(now: number, weekStart?: string, enabled = true): HomeWeekData {
  const timeZone = getUserTimezone();
  const modules = useModules();
  const followedIds = useMemo(
    () =>
      enabled ? FOLLOWED_COMPETITION_IDS.filter((id) => isCompetitionVisibleWith(id, modules)) : [],
    [enabled, modules],
  );
  const followedKey = followedIds.join(',');
  const today = calendarDay(now, timeZone);
  const window = useMemo(
    () => resolveWeekWindow(now, timeZone, weekStart),
    [today, timeZone, weekStart],
  );
  const windowKey = `${window.startMs}:${window.endMs}:${window.days[0] ?? ''}:${followedKey}`;
  const [state, setState] = useState<WeekState>(emptyState);
  const [retry, setRetry] = useState(0);
  const [queue] = useState(() => createTaskQueue(EVENTS_CONCURRENCY));
  const reload = useCallback(() => setRetry((value) => value + 1), []);

  useEffect(() => pruneWeekArchive(Date.now()), [today]);

  // Day lists: every UTC date that overlaps the local window. They are
  // requested through the same pool as details, so the app never exceeds four
  // requests at once.
  useEffect(() => {
    const { alive, load, dispose } = weekRequests(queue);
    const followed = new Set(followedIds);
    const matchesById = new Map<string, WeekMatch>();

    setState((prev) => ({
      ...prev,
      matches: {},
      events: {},
      eventsTotal: 0,
      fetchedAt: null,
      stale: false,
      datesPending: followed.size ? window.utcDates.length : 0,
      errors: prev.errors.filter((error) => error.scope === 'season'),
    }));

    if (!followed.size) return dispose;

    const addDay = (
      summaries: Parameters<typeof selectWeekMatches>[0],
      fetchedAt: string,
      stale: boolean,
    ) => {
      const selected = selectWeekMatches(summaries, followed, window);
      for (const match of selected) matchesById.set(match.summary.id, match);
      setState((prev) => {
        const matches = { ...prev.matches };
        const events = { ...prev.events };
        let added = 0;
        for (const match of selected) {
          matches[match.summary.id] = match;
          if (match.state === 'finished' && !events[match.summary.id]) {
            events[match.summary.id] = { status: 'pending', events: [] };
            added += 1;
          }
        }
        return {
          ...prev,
          matches,
          events,
          eventsTotal: prev.eventsTotal + added,
          fetchedAt: earlierFetchedAt(prev.fetchedAt, fetchedAt),
          stale: prev.stale || stale,
        };
      });
    };

    const loadDay = async (date: string) => {
      try {
        const reply = await load(`date/${date}?status=all`);
        if (!alive() || !reply) return;
        const summaries = parseDateMatches(reply.payload);
        if (!summaries) throw new Error('Не удалось прочитать расписание.');
        archiveDay(date, summaries, reply.fetchedAt);
        addDay(summaries, reply.fetchedAt, reply.stale);
      } catch (error) {
        if (!alive()) return;
        const saved = readArchivedDay(date);
        if (saved) {
          addDay(saved.matches, saved.fetchedAt, true);
          return;
        }
        const message = messageOf(error);
        setState((prev) => {
          const errors = appendError(prev.errors, { scope: 'day', key: date, message });
          return errors === prev.errors ? prev : { ...prev, errors };
        });
      } finally {
        if (alive())
          setState((prev) => ({
            ...prev,
            datesPending: Math.max(0, prev.datesPending - 1),
          }));
      }
    };

    const dayTasks = window.utcDates.map((date) => loadDay(date));
    void Promise.allSettled(dayTasks).then(() => {
      if (!alive()) return;
      const finished = orderFinishedForEvents(matchesById.values());
      const finishedIds = new Set(finished.map((match) => match.summary.id));
      setState((prev) => {
        const events = { ...prev.events };
        for (const [id, event] of Object.entries(events))
          if (!finishedIds.has(id) && event.status === 'pending') delete events[id];
        for (const match of finished)
          if (!events[match.summary.id])
            events[match.summary.id] = { status: 'pending', events: [] };
        return { ...prev, events, eventsTotal: finished.length };
      });
      for (const match of finished) {
        const id = match.summary.id;
        const saved = readArchivedEvents(match.summary);
        if (saved) {
          setState((prev) => ({
            ...prev,
            events: { ...prev.events, [id]: { status: 'loaded', events: saved } },
          }));
          continue;
        }
        void load(`matches/${id}/events`)
          .then((reply) => {
            if (!alive() || !reply) return;
            const events = parseEvents(reply.payload);
            if (!events) throw new Error('Не удалось прочитать события матча.');
            if (!reply.stale) archiveEvents(match.summary, events);
            setState((prev) => ({
              ...prev,
              events: {
                ...prev.events,
                [id]: events.length
                  ? { status: 'loaded', events }
                  : { status: 'missing', events: [] },
              },
              fetchedAt: earlierFetchedAt(prev.fetchedAt, reply.fetchedAt),
              stale: prev.stale || reply.stale,
            }));
          })
          .catch((error) => {
            if (!alive()) return;
            const message = messageOf(error);
            setState((prev) => {
              const errors = appendError(prev.errors, {
                scope: 'events',
                key: id,
                message,
              });
              return {
                ...prev,
                events: {
                  ...prev.events,
                  [id]: { status: 'failed', events: [], error: message },
                },
                errors,
              };
            });
          });
      }
    });
    return dispose;
  }, [windowKey, followedKey, queue, retry]);

  // Keep prior seasons visible during refresh and account for their own freshness.
  useEffect(() => {
    const { alive, load, dispose } = weekRequests(queue);
    setState((prev) => ({
      ...prev,
      seasons: Object.fromEntries(
        followedIds.map((leagueId) => [
          leagueId,
          {
            matches: null,
            fetchedAt: null,
            stale: false,
            ...prev.seasons[leagueId],
            loading: true,
          },
        ]),
      ),
      errors: prev.errors.filter((error) => error.scope !== 'season'),
    }));
    for (const leagueId of followedIds) {
      void load(`leagues/${leagueId}/matches?status=all`)
        .then((reply) => {
          if (!alive() || !reply) return;
          const matches = parseSeasonMatches(reply.payload);
          if (!matches) throw new Error('Не удалось прочитать матчи турнира.');
          setState((prev) => ({
            ...prev,
            seasons: {
              ...prev.seasons,
              [leagueId]: {
                matches,
                fetchedAt: reply.fetchedAt,
                stale: reply.stale,
                loading: false,
              },
            },
          }));
        })
        .catch((error) => {
          if (!alive()) return;
          const message = messageOf(error);
          setState((prev) => ({
            ...prev,
            seasons: {
              ...prev.seasons,
              [leagueId]: {
                ...prev.seasons[leagueId]!,
                stale: prev.seasons[leagueId]?.fetchedAt != null,
                loading: false,
              },
            },
            errors: appendError(prev.errors, { scope: 'season', key: leagueId, message }),
          }));
        });
    }
    return dispose;
  }, [followedKey, queue, retry]);

  const seasonMatches = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(state.seasons).flatMap(([id, season]) =>
          season.matches ? [[id, season.matches]] : [],
        ),
      ),
    [state.seasons],
  );
  const seasons = Object.values(state.seasons);
  const fetchedAt = seasons.reduce(
    (oldest, season) => (season.fetchedAt ? earlierFetchedAt(oldest, season.fetchedAt) : oldest),
    state.fetchedAt,
  );
  const days = useMemo(
    () => buildWeekDays(window, Object.values(state.matches), timeZone),
    [window, state.matches, timeZone],
  );
  const progress = useMemo(
    () => weekProgress(state.events, state.eventsTotal),
    [state.events, state.eventsTotal],
  );
  const loading =
    state.datesPending > 0 ||
    seasons.some((season) => season.loading) ||
    Object.values(state.events).some((event) => event.status === 'pending');

  return {
    days,
    events: state.events,
    seasonMatches,
    progress,
    errors: state.errors,
    fetchedAt,
    stale: state.stale || seasons.some((season) => season.stale),
    loading,
    timezone: timeZone,
    reload,
  };
}
