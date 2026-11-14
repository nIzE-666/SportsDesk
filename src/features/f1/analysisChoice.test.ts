// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { viewState } from '../../lib/viewState';
import {
  analysisChoiceKey,
  findMeetingForRound,
  isAnalysisChoice,
  pickDefaultMeeting,
  pickDefaultSession,
  readLegacyAnalysisChoice,
} from './analysisChoice';
import type { JolpicaRace, OpenF1Meeting, OpenF1Session } from './types';

const round = (number: string, raceName: string, date: string): JolpicaRace => ({
  season: '2025',
  round: number,
  raceName,
  date,
  Circuit: { circuitId: `circuit-${number}`, circuitName: `Circuit ${number}` },
});

const meeting = (key: number, name: string, start: string, end: string): OpenF1Meeting => ({
  meeting_key: key,
  meeting_name: name,
  date_start: start,
  date_end: end,
  year: 2025,
});

const session = (
  key: number,
  meetingKey: number,
  name: string,
  start: string,
  end: string,
): OpenF1Session => ({
  session_key: key,
  meeting_key: meetingKey,
  session_name: name,
  session_type: name,
  date_start: start,
  date_end: end,
  year: 2025,
});

beforeEach(() => {
  sessionStorage.clear();
  viewState.reset();
});

describe('analysis choice', () => {
  it('starts from the old compare round and session-centre keys', () => {
    viewState.write('f1.2025.compare.round', '2');
    viewState.write('f1.openf1.2025.meeting', 1250);
    viewState.write('f1.openf1.2025.1250.session', 9900);

    expect(readLegacyAnalysisChoice(2025)).toEqual({ round: 2, meeting: 1250, session: 9900 });
  });

  it('keeps the whole season when the old round was a season', () => {
    viewState.write('f1.2025.compare.round', 'season');
    expect(readLegacyAnalysisChoice(2025)).toEqual({
      round: 'season',
      meeting: null,
      session: null,
    });
  });

  it('falls back to the season when no old choice exists', () => {
    expect(readLegacyAnalysisChoice(2025)).toEqual({
      round: 'season',
      meeting: null,
      session: null,
    });
  });

  it('accepts only a complete stored choice', () => {
    expect(isAnalysisChoice({ round: 2, meeting: 1250, session: 9900 })).toBe(true);
    expect(isAnalysisChoice({ round: 'season', meeting: null, session: null })).toBe(true);
    expect(isAnalysisChoice({ round: 0, meeting: null, session: null })).toBe(false);
    expect(isAnalysisChoice({ round: 2, meeting: 'x', session: null })).toBe(false);
    expect(isAnalysisChoice(null)).toBe(false);
    expect(analysisChoiceKey(2025)).toBe('f1.2025.analysis.choice');
  });

  it('matches an OpenF1 meeting to a calendar round by name', () => {
    const rounds = [
      round('1', 'Australian Grand Prix', '2025-03-16'),
      round('2', 'Las Vegas Grand Prix', '2025-11-22'),
    ];
    const meetings = [
      meeting(1200, 'Australian Grand Prix', '2025-01-01T00:00:00Z', '2025-01-02T12:00:00Z'),
      meeting(1250, 'Las Vegas Grand Prix', '2025-01-03T00:00:00Z', '2025-01-04T08:00:00Z'),
    ];
    expect(findMeetingForRound(2, rounds, meetings)?.meeting_key).toBe(1250);
    expect(findMeetingForRound(1, rounds, meetings)?.meeting_key).toBe(1200);
  });

  it('matches an official meeting name that contains the calendar title', () => {
    const rounds = [round('2', 'Las Vegas Grand Prix', '2025-11-22')];
    const meetings = [
      meeting(
        1250,
        'FORMULA 1 HEINEKEN SILVER LAS VEGAS GRAND PRIX 2025',
        '2025-01-03T00:00:00Z',
        '2025-01-04T08:00:00Z',
      ),
    ];
    expect(findMeetingForRound(2, rounds, meetings)?.meeting_key).toBe(1250);
  });

  it('matches by the weekend date when the names differ', () => {
    const rounds = [round('2', 'Las Vegas Grand Prix', '2025-11-22')];
    const meetings = [
      meeting(1250, 'Unknown Weekend', '2025-11-20T00:00:00Z', '2025-11-22T08:00:00Z'),
    ];
    expect(findMeetingForRound(2, rounds, meetings)?.meeting_key).toBe(1250);
  });

  it('picks the latest completed meeting and the completed race inside it', () => {
    const now = Date.parse('2026-01-10T12:00:00Z');
    const meetings = [
      meeting(1, 'Old Grand Prix', '2025-03-14T00:00:00Z', '2025-03-16T12:00:00Z'),
      meeting(2, 'New Grand Prix', '2025-11-20T00:00:00Z', '2025-11-22T08:00:00Z'),
      meeting(3, 'Future Grand Prix', '2026-03-12T00:00:00Z', '2026-03-14T12:00:00Z'),
    ];
    expect(pickDefaultMeeting(meetings, now)?.meeting_key).toBe(2);

    const sessions = [
      session(10, 2, 'Practice 1', '2025-11-20T02:00:00Z', '2025-11-20T03:00:00Z'),
      session(11, 2, 'Race', '2025-11-22T04:00:00Z', '2025-11-22T06:00:00Z'),
      session(12, 2, 'Practice 2', '2025-11-21T02:00:00Z', '2025-11-21T03:00:00Z'),
    ];
    expect(pickDefaultSession(sessions, now)?.session_key).toBe(11);
  });

  it('returns nothing when every session is still ahead', () => {
    const now = Date.parse('2025-01-01T00:00:00Z');
    const sessions = [session(10, 2, 'Practice 1', '2025-11-20T02:00:00Z', '2025-11-20T03:00:00Z')];
    expect(pickDefaultSession(sessions, now)).toBeNull();
  });
});
