import { useMemo } from 'react';
import { useApiResource } from '../f1/api';
import { grandPrixTitle } from '../f1/calendarModel';
import { parseRaceResults, parseSchedule } from '../f1/parsing';
import type { JolpicaDriver, JolpicaRace, JolpicaResultEntry } from '../f1/types';
import { weekendSchedule } from '../f1/weekendSchedule';
import { localDayKey } from './weekData';

export interface HomeSession {
  id: string;
  key: string;
  plannerId: string;
  race: JolpicaRace;
  title: string;
  label: string;
  start: number;
  iso: string;
}

export function homeSessions(races: JolpicaRace[]): HomeSession[] {
  return races
    .flatMap((race) =>
      weekendSchedule(race).flatMap((session) => {
        if (!session.start) return [];
        const parts = [race.season, race.round, session.id];
        return [
          {
            id: session.id,
            key: parts.join('|'),
            plannerId: ['f1', ...parts].map(encodeURIComponent).join(':'),
            race,
            title: grandPrixTitle(race.raceName).title,
            label: session.label,
            start: session.start.getTime(),
            iso: session.start.toISOString(),
          },
        ];
      }),
    )
    .sort((a, b) => a.start - b.start);
}

const driverName = (driver: JolpicaDriver) => `${driver.givenName} ${driver.familyName}`;

function numeric(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

function isClassified(row: JolpicaResultEntry): boolean {
  return /^\d+$/.test(row.positionText ?? '') || /^(Finished|\+\d+ Laps?)$/i.test(row.status ?? '');
}

function isRetired(row: JolpicaResultEntry): boolean {
  return (
    !isClassified(row) &&
    (row.positionText === 'R' || /^(DNF|Retired|Accident|Collision)$/i.test(row.status ?? ''))
  );
}

export function raceHighlights(results: JolpicaResultEntry[]) {
  const winner = results.find((row) => row.position === '1' && isClassified(row));
  const runnerUp = results.find((row) => row.position === '2' && isClassified(row));
  const passes = results
    .flatMap((row) => {
      const grid = numeric(row.grid);
      const position = numeric(row.position);
      if (!grid || !position || grid <= position || !isClassified(row)) return [];
      return [{ driver: driverName(row.Driver), count: grid - position }];
    })
    .sort((a, b) => b.count - a.count);
  const winnerTime = numeric(winner?.Time?.millis);
  const runnerUpTime = numeric(runnerUp?.Time?.millis);
  const gap =
    winnerTime !== null && runnerUpTime !== null && runnerUpTime >= winnerTime
      ? (runnerUpTime - winnerTime) / 1000
      : null;
  const leaderGrid = numeric(winner?.grid);
  const retirements = results.filter(isRetired).length;
  return {
    winner: winner ? driverName(winner.Driver) : null,
    gained: passes[0] ?? null,
    retirements: retirements || (results.length && results.every(isClassified) ? 0 : null),
    closeFinish: gap !== null && gap < 2,
    winnerOutsideFrontRow: leaderGrid !== null && leaderGrid > 2,
  };
}

export function useHomeF1(now: number, timezone: string, enabled: boolean) {
  const today = localDayKey(now, timezone);
  const year = Number(today.slice(0, 4));
  const schedule = useApiResource(
    `home.f1.${year}`,
    enabled ? `${year}.json?limit=100` : null,
    parseSchedule,
  );
  const nextYear = useApiResource(
    `home.f1.${year + 1}`,
    enabled && today.slice(5, 7) >= '11' ? `${year + 1}.json?limit=100` : null,
    parseSchedule,
  );
  const previousSchedule = useApiResource(
    `home.f1.${year - 1}`,
    enabled && today.slice(5, 7) === '01' ? `${year - 1}.json?limit=100` : null,
    parseSchedule,
  );
  const results = useApiResource(
    `home.f1.result.${year}`,
    enabled ? `${year}/last/results.json?limit=100` : null,
    parseRaceResults,
  );
  const confirmed = results.data?.find((race) => race.Results.length > 0 && race.date <= today);
  const previousResults = useApiResource(
    `home.f1.result.${year - 1}`,
    enabled && results.data && !confirmed ? `${year - 1}/last/results.json?limit=100` : null,
    parseRaceResults,
  );
  const sessions = useMemo(
    () =>
      homeSessions([
        ...(previousSchedule.data?.races ?? []),
        ...(schedule.data?.races ?? []),
        ...(nextYear.data?.races ?? []),
      ]),
    [previousSchedule.data, schedule.data, nextYear.data],
  );
  const resources = [schedule, nextYear, previousSchedule, results, previousResults];
  const latest =
    confirmed ??
    previousResults.data?.find((race) => race.Results.length > 0 && race.date <= today);
  return {
    sessions,
    next: sessions.find((session) => session.start > now),
    latest,
    stale: resources.some((resource) => resource.stale),
    loading: resources.some((resource) => resource.loading),
    error: Boolean(schedule.error || results.error),
    fetchedAt: resources.map((resource) => resource.fetchedAt),
    reload: () => resources.forEach((resource) => resource.reload()),
  };
}
