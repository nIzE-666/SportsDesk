import type { Dispatch, SetStateAction } from 'react';
import { useMemo } from 'react';
import { useApiResource, type F1Data } from './api';
import {
  findMeetingForRound,
  pickDefaultMeeting,
  pickDefaultSession,
  useAnalysisChoice,
  type F1AnalysisChoice,
} from './analysisChoice';
import type { F1AnalysisMode } from './f1Tabs';
import { parseOpenF1Meetings, parseOpenF1Sessions } from './openf1';
import { parseSchedule } from './parsing';
import type { JolpicaRace, OpenF1Meeting, OpenF1Session } from './types';

export interface AnalysisSelection {
  year: number;
  mode: F1AnalysisMode;
  choice: F1AnalysisChoice;
  setChoice: Dispatch<SetStateAction<F1AnalysisChoice>>;
  rounds: readonly JolpicaRace[];
  meetings: F1Data<OpenF1Meeting[]>;
  sessions: F1Data<OpenF1Session[]>;
  meetingList: readonly OpenF1Meeting[];
  sessionList: readonly OpenF1Session[];
  meeting: OpenF1Meeting | null;
  session: OpenF1Session | null;
  /** Set when the shown weekend or session is a local fallback, not the shared choice. */
  notice: string | null;
  fallback: boolean;
}

export function useAnalysisSelection(year: number, mode: F1AnalysisMode): AnalysisSelection {
  const [choice, setChoice] = useAnalysisChoice(year);
  const schedule = useApiResource(
    `${year}-analysis-calendar`,
    `${year}.json?limit=100`,
    parseSchedule,
  );
  const meetings = useApiResource(
    `openf1-meetings-${year}`,
    `meetings?year=${year}`,
    parseOpenF1Meetings,
    { source: 'openf1', enabled: year >= 2023 },
  );

  const rounds = schedule.data?.races ?? [];
  const meetingList = meetings.data ?? [];

  const selectedMeeting = useMemo(() => {
    if (choice.round !== 'season') {
      const byRound = findMeetingForRound(choice.round, rounds, meetingList);
      if (byRound) return byRound;
    }
    if (choice.meeting !== null) {
      const stored = meetingList.find((meeting) => meeting.meeting_key === choice.meeting);
      if (stored) return stored;
    }
    return null;
  }, [choice.meeting, choice.round, meetingList, rounds]);

  const needsMeeting = mode !== 'compare';
  const fallbackMeeting = useMemo(
    () =>
      needsMeeting && !selectedMeeting && meetingList.length > 0
        ? pickDefaultMeeting(meetingList, Date.now())
        : null,
    [needsMeeting, selectedMeeting, meetingList],
  );
  const meeting = selectedMeeting ?? fallbackMeeting;

  const sessions = useApiResource(
    `openf1-sessions-${meeting?.meeting_key ?? 'none'}`,
    meeting ? `sessions?meeting_key=${meeting.meeting_key}` : null,
    parseOpenF1Sessions,
    { source: 'openf1' },
  );
  const sessionList = sessions.data ?? [];
  const defaultSession = useMemo(() => pickDefaultSession(sessionList, Date.now()), [sessionList]);
  const chosenSession =
    choice.session !== null
      ? (sessionList.find((session) => session.session_key === choice.session) ?? null)
      : null;
  const session = chosenSession ?? defaultSession;

  let notice: string | null = null;
  if (needsMeeting && !selectedMeeting && meetingList.length > 0) {
    const missingRound = choice.round !== 'season';
    if (fallbackMeeting)
      notice = missingRound
        ? 'Для этого этапа нет данных сессий — показан последний завершённый.'
        : 'Для этого режима нужен один этап — показан последний завершённый.';
    else
      notice = missingRound
        ? 'Для этого этапа нет данных сессий.'
        : 'Для этого режима нужен один завершённый этап.';
  }

  return {
    year,
    mode,
    choice,
    setChoice,
    rounds,
    meetings,
    sessions,
    meetingList,
    sessionList,
    meeting,
    session,
    notice,
    fallback: needsMeeting && !selectedMeeting && meeting !== null,
  };
}
