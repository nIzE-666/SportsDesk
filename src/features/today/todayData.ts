import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useNow } from '../../lib/useNow';
import { useApiResource, type F1Data } from '../f1/api';
import { parseSchedule } from '../f1/parsing';
import type { JolpicaRace } from '../f1/types';
import { useFavorites } from '../football/FavoritesProvider';
import { getString, getUserTimezone, setJson } from '../football/storage';
import { useFootballData, type UseFootballResult } from '../football/useFootballData';
import { buildViewingEvents, viewingDayKey, type ViewingPlan } from '../planner/plannerData';

/** The planner's «буду смотреть» marks; the same key the planner already uses. */
export const PRIORITIES_KEY = 'sportsdesk.planner.priorities';
const PRIORITIES_LIMIT = 500;

function readPriorities(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is string => typeof value === 'string'))].slice(
      -PRIORITIES_LIMIT,
    );
  } catch {
    return [];
  }
}

let prioritiesRaw: string | null | undefined;
let prioritiesCache: string[] = [];

function prioritiesSnapshot(): string[] {
  const raw = getString(PRIORITIES_KEY);
  if (raw === prioritiesRaw) return prioritiesCache;
  prioritiesRaw = raw;
  prioritiesCache = readPriorities(raw);
  return prioritiesCache;
}

function subscribePriorities(listener: () => void): () => void {
  window.addEventListener('storage', listener);
  window.addEventListener('sportsdesk-storage-changed', listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener('sportsdesk-storage-changed', listener);
  };
}

export function writePriorities(items: readonly string[]): void {
  const next = [...new Set(items)].slice(-PRIORITIES_LIMIT);
  setJson(PRIORITIES_KEY, next);
  prioritiesRaw = undefined;
}

/** Marks of the planner, shared by «Сегодня», «Неделя» and the planner itself. */
export function usePlannerPriorities(): [string[], (id: string) => void] {
  const items = useSyncExternalStore(subscribePriorities, prioritiesSnapshot, () => []);
  const toggle = useCallback((id: string) => {
    const current = prioritiesSnapshot();
    writePriorities(
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }, []);
  return [items, toggle];
}

type ScheduleData = { season: string | null; races: JolpicaRace[] };

export interface TodayPlanData {
  football: UseFootballResult;
  plan: ViewingPlan;
  now: number;
  tz: string;
  today: string;
  schedule: F1Data<ScheduleData>;
  nextSchedule: F1Data<ScheduleData>;
  needsNextYear: boolean;
  loading: boolean;
  fetchedAt: string | null;
  stale: boolean;
}

/**
 * Football schedule (PitchAPI) and Formula 1 sessions (Jolpica) for the planner
 * screens. The loaded results also feed the club table on «Сегодня», so the
 * screen makes no SportScore requests of its own.
 */
export function useTodayPlanData(): TodayPlanData {
  const now = useNow();
  const tz = getUserTimezone();
  const today = viewingDayKey(now, tz);
  const year = Number(today.slice(0, 4));
  const football = useFootballData();
  const { teamIds, favoriteTeamNames, seedFromCatalogue } = useFavorites();
  useEffect(() => seedFromCatalogue(football.teams), [football.teams, seedFromCatalogue]);
  const schedule = useApiResource(`today.${year}`, `${year}.json?limit=100`, parseSchedule);
  const needsNextYear = today.slice(5, 7) >= '11';
  const nextSchedule = useApiResource(
    `today.${year + 1}`,
    needsNextYear ? `${year + 1}.json?limit=100` : null,
    parseSchedule,
  );
  const races = useMemo(
    () => [...(schedule.data?.races ?? []), ...(nextSchedule.data?.races ?? [])],
    [schedule.data, nextSchedule.data],
  );
  const plan = useMemo(
    () => buildViewingEvents(football.allMatches, races, teamIds, favoriteTeamNames, now),
    [football.allMatches, races, teamIds, favoriteTeamNames, now],
  );
  const fetchedTimes = [
    football.fetchedAt,
    schedule.fetchedAt,
    ...(needsNextYear ? [nextSchedule.fetchedAt] : []),
  ].filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
  const fetchedAt = fetchedTimes.length
    ? [...fetchedTimes].sort((a, b) => Date.parse(a) - Date.parse(b))[0]!
    : null;
  return {
    football,
    plan,
    now,
    tz,
    today,
    schedule,
    nextSchedule,
    needsNextYear,
    loading:
      football.matchesLoading ||
      schedule.loading ||
      (needsNextYear && nextSchedule.loading && !nextSchedule.data),
    fetchedAt,
    stale: football.stale || schedule.stale || (needsNextYear && nextSchedule.stale),
  };
}
