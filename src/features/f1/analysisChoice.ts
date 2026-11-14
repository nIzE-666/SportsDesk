import type { Dispatch, SetStateAction } from 'react';
import { useMemo } from 'react';
import { useViewState } from '../../lib/useViewState';
import { viewState } from '../../lib/viewState';
import { grandPrixTitle } from './calendarModel';
import { parseUtc } from './time';
import type { JolpicaRace, OpenF1Meeting, OpenF1Session } from './types';

/** The single Grand Prix and session choice shared by all three analysis modes. */
export interface F1AnalysisChoice {
  /** 'season' means the whole season (compare only); otherwise a calendar round. */
  round: 'season' | number;
  /** OpenF1 meeting key for the chosen round, when it is known. */
  meeting: number | null;
  /** OpenF1 session key inside the chosen meeting. */
  session: number | null;
}

export function analysisChoiceKey(year: number) {
  return `f1.${year}.analysis.choice`;
}

const MISSING = Symbol('missing');

function legacy<T>(key: string): T | typeof MISSING {
  return viewState.read<T | typeof MISSING>(key, MISSING, () => true);
}

function positiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function legacyRound(year: number): 'season' | number {
  const raw = legacy<unknown>(`f1.${year}.compare.round`);
  if (raw === MISSING || raw === 'season') return 'season';
  return positiveInt(raw) ?? 'season';
}

/**
 * Reads the old compare round and session-centre keys once, so a choice made
 * before the analysis tab existed is kept when the user opens it.
 */
export function readLegacyAnalysisChoice(year: number): F1AnalysisChoice {
  const meeting = positiveInt(legacy<unknown>(`f1.openf1.${year}.meeting`));
  const session = meeting
    ? positiveInt(legacy<unknown>(`f1.openf1.${year}.${meeting}.session`))
    : null;
  return { round: legacyRound(year), meeting, session };
}

export function isAnalysisChoice(value: unknown): value is F1AnalysisChoice {
  if (!value || typeof value !== 'object') return false;
  const choice = value as Record<string, unknown>;
  const round = choice.round;
  const meeting = choice.meeting;
  const session = choice.session;
  return (
    (round === 'season' || (typeof round === 'number' && Number.isInteger(round) && round > 0)) &&
    (meeting === null || positiveInt(meeting) !== null) &&
    (session === null || positiveInt(session) !== null)
  );
}

export function useAnalysisChoice(
  year: number,
): [F1AnalysisChoice, Dispatch<SetStateAction<F1AnalysisChoice>>] {
  const initial = useMemo(() => readLegacyAnalysisChoice(year), [year]);
  return useViewState<F1AnalysisChoice>(analysisChoiceKey(year), initial, isAnalysisChoice);
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * OpenF1 meeting keys are not calendar round numbers, so the shared choice is
 * matched by the Grand Prix name first and by the weekend date second.
 */
export function findMeetingForRound(
  round: number,
  rounds: readonly JolpicaRace[],
  meetings: readonly OpenF1Meeting[],
): OpenF1Meeting | null {
  const race = rounds.find((entry) => Number(entry.round) === round);
  if (!race) return null;
  const titles = [normalize(race.raceName), normalize(grandPrixTitle(race.raceName).title)].filter(
    Boolean,
  );
  if (titles.length > 0) {
    const byName = meetings.find((meeting) => {
      const names = [meeting.meeting_name, meeting.meeting_official_name]
        .filter((name): name is string => !!name)
        .flatMap((name) => [normalize(name), normalize(grandPrixTitle(name).title)])
        .filter(Boolean);
      return names.some((name) =>
        titles.some((title) => name.includes(title) || title.includes(name)),
      );
    });
    if (byName) return byName;
  }
  if (!race.date) return null;
  const target = Date.parse(`${race.date}T12:00:00Z`);
  if (!Number.isFinite(target)) return null;
  const nearby = meetings
    .map((meeting) => {
      const date = meeting.date_start ?? meeting.date_end;
      return {
        meeting,
        distance: date ? Math.abs(Date.parse(date) - target) : Number.POSITIVE_INFINITY,
      };
    })
    .filter(({ distance }) => Number.isFinite(distance) && distance <= 4 * 86_400_000)
    .sort((a, b) => a.distance - b.distance)[0];
  return nearby?.meeting ?? null;
}

export function isCompleted(session: OpenF1Session, now: number): boolean {
  if (!session.date_end) return false;
  const date = parseUtc(session.date_end.slice(0, 10), session.date_end.slice(11));
  return !!date && date.getTime() < now;
}

export function isMeetingCompleted(meeting: OpenF1Meeting, now: number): boolean {
  if (!meeting.date_end) return false;
  const date = parseUtc(meeting.date_end.slice(0, 10), meeting.date_end.slice(11));
  return !!date && date.getTime() < now;
}

/**
 * The default session is the completed race, or the latest completed session
 * of the weekend. Future sessions stay manually selectable.
 */
export function pickDefaultSession(
  sessions: readonly OpenF1Session[],
  now: number,
): OpenF1Session | null {
  const completed = sessions.filter((session) => isCompleted(session, now));
  if (completed.length === 0) return null;
  const races = completed.filter(
    (session) =>
      (session.session_type ?? '').toLowerCase() === 'race' ||
      (session.session_name ?? '').toLowerCase() === 'race',
  );
  if (races.length > 0)
    return races.reduce((best, current) =>
      (current.date_end ?? '') > (best.date_end ?? '') ? current : best,
    );
  return completed.reduce((best, current) =>
    (current.date_end ?? '') > (best.date_end ?? '') ? current : best,
  );
}

/** The default meeting is the most recent completed weekend. */
export function pickDefaultMeeting(
  meetings: readonly OpenF1Meeting[],
  now: number,
): OpenF1Meeting | null {
  const completed = meetings.filter((meeting) => isMeetingCompleted(meeting, now));
  if (completed.length === 0) return null;
  return completed.reduce((best, current) =>
    (current.date_end ?? '') > (best.date_end ?? '') ? current : best,
  );
}
