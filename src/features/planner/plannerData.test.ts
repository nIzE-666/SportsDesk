import { describe, expect, it } from 'vitest';
import type { MatchSummary } from '../football/types';
import type { JolpicaRace } from '../f1/types';
import {
  buildViewingEvents,
  filterViewingEventsByDay,
  findViewingConflicts,
  groupViewingEventsByDay,
  viewingDayKey,
  type ViewingEvent,
} from './plannerData';

const now = Date.parse('2026-10-25T00:00:00Z');
const fixture = (
  id: string,
  time_utc = '2026-10-25T15:00:00Z',
  status = 'scheduled',
): MatchSummary => ({
  id,
  status,
  time_utc,
  date: time_utc.slice(0, 10),
  home_team: { id: 'barcelona', name: 'Barcelona' },
  away_team: { id: 'betis', name: 'Real Betis' },
  score_home: null,
  score_away: null,
});
const grandPrix = (overrides: Partial<JolpicaRace> = {}): JolpicaRace => ({
  season: '2026',
  round: '20',
  raceName: 'Mexico Grand Prix',
  date: '2026-10-25',
  time: '20:00:00Z',
  Circuit: { circuitId: 'mexico', circuitName: 'Autódromo Hermanos Rodríguez' },
  ...overrides,
});
const interval = (id: string, start: string, end: string): ViewingEvent => ({
  kind: 'football',
  id,
  title: id,
  match: fixture(id),
  start: Date.parse(start),
  end: Date.parse(end),
  estimatedEnd: true,
  durationMinutes: (Date.parse(end) - Date.parse(start)) / 60_000,
  state: 'upcoming',
  isLive: false,
});

describe('personal viewing events', () => {
  it('filters fixtures by favorite IDs or an exact normalized favorite name', () => {
    const other = {
      ...fixture('other'),
      home_team: { id: 'other-home', name: 'Other' },
      away_team: { id: 'other-away', name: 'Another' },
    };
    expect(
      buildViewingEvents([fixture('favorite'), other], [], ['barcelona'], [], now).events.map(
        (event) => event.id,
      ),
    ).toEqual(['football:favorite']);
    expect(
      buildViewingEvents([fixture('favorite'), other], [], [], [' BARCELONA '], now).events,
    ).toHaveLength(1);
    expect(buildViewingEvents([fixture('favorite')], [], [], ['Barce'], now).events).toHaveLength(
      0,
    );
    expect(buildViewingEvents([fixture('favorite')], [], [], [], now).events).toHaveLength(0);
  });

  it('keeps unfamiliar scheduled statuses while excluding known terminal and cancelled states', () => {
    const excluded = [
      'finished',
      'Full time',
      'FT',
      'ended',
      'after-penalties',
      'cancelled',
      'canceled',
      'postponed',
      'suspended',
      'abandoned',
      'walkover',
      'awarded',
    ];
    const plan = buildViewingEvents(
      [
        ...excluded.map((status) => fixture(status, undefined, status)),
        fixture('future-alias', undefined, 'not_started'),
      ],
      [],
      ['barcelona'],
      [],
      now,
    );
    expect(plan.events.map((event) => event.id)).toEqual(['football:future-alias']);
    expect(plan.unscheduled).toHaveLength(0);
  });

  it('retains only current estimated intervals and future events; a finished live snapshot is excluded', () => {
    const plan = buildViewingEvents(
      [
        fixture('old', '2026-10-24T22:00:00Z'),
        fixture('live', '2026-10-24T23:00:00Z', 'in progress'),
        fixture('scheduled-interval', '2026-10-24T23:30:00Z'),
        fixture('finished', '2026-10-24T23:30:00Z', 'finished'),
        fixture('future'),
      ],
      [],
      ['barcelona'],
      [],
      now,
    );
    expect(plan.events.map((event) => event.id)).toEqual([
      'football:live',
      'football:scheduled-interval',
      'football:future',
    ]);
    expect(plan.events[0]).toMatchObject({
      state: 'underway',
      isLive: true,
      estimatedEnd: true,
      durationMinutes: 120,
    });
    expect(plan.events[1]).toMatchObject({ state: 'underway', isLive: false });
    expect(plan.events[2]).toMatchObject({ state: 'upcoming', isLive: false });
  });

  it('keeps explicitly live matches beyond the usual estimate with a provisional rolling end', () => {
    const kickoff = '2026-10-24T21:30:00Z';
    const plan = buildViewingEvents(
      [
        fixture('extra-time', kickoff, 'extra time'),
        fixture('stale-scheduled', kickoff, 'scheduled'),
        fixture('stale-alias', kickoff, 'new_provider_alias'),
      ],
      [],
      ['barcelona'],
      [],
      now,
    );
    expect(plan.events.map((event) => event.id)).toEqual(['football:extra-time']);
    expect(plan.events[0]).toMatchObject({
      isLive: true,
      state: 'underway',
      estimatedEnd: true,
      liveExtended: true,
    });
    expect(plan.events[0]!.end).toBe(now + 15 * 60_000);
    expect(plan.events[0]!.durationMinutes).toBe(165);
    const later = buildViewingEvents(
      [fixture('extra-time', kickoff, 'extra time')],
      [],
      ['barcelona'],
      [],
      now + 20 * 60_000,
    );
    expect(later.events[0]!.id).toBe(plan.events[0]!.id);
    expect(later.events[0]!.end).toBe(now + 35 * 60_000);
    expect(
      findViewingConflicts([
        ...plan.events,
        interval('next-broadcast', '2026-10-25T00:05Z', '2026-10-25T01:05Z'),
      ]),
    ).toHaveLength(1);
  });

  it('uses explicit inprogress aliases and tolerates a missing provider status', () => {
    const unknownStatus = { ...fixture('no-status'), status: undefined } as unknown as MatchSummary;
    const liveUnknownTime = {
      ...fixture('live-no-time', undefined, 'inprogress'),
      time_utc: undefined,
      date: '2026-10-01',
    };
    const plan = buildViewingEvents(
      [fixture('live', '2026-10-24T21:30:00Z', 'inprogress'), unknownStatus, liveUnknownTime],
      [],
      ['barcelona'],
      [],
      now,
    );
    expect(plan.events.find((event) => event.id === 'football:live')).toMatchObject({
      isLive: true,
      liveExtended: true,
    });
    expect(plan.events.find((event) => event.id === 'football:no-status')).toMatchObject({
      state: 'upcoming',
      isLive: false,
    });
    expect(plan.unscheduled.map((event) => event.id)).toEqual(['football:live-no-time']);
  });

  it('separates unknown, invalid and date-only kickoffs instead of scheduling them at midnight', () => {
    const unknown = { ...fixture('unknown'), time_utc: undefined, date: '2026-10-26' };
    const dateOnly = { ...fixture('date-only'), time_utc: '2026-10-26', date: '2026-10-26' };
    const invalid = fixture('invalid', '2026-10-26T25:00:00Z');
    const impossible = fixture('impossible', '2027-02-30T15:00:00Z');
    const plan = buildViewingEvents(
      [unknown, dateOnly, invalid, impossible],
      [grandPrix({ time: undefined })],
      ['barcelona'],
      [],
      now,
    );
    expect(plan.events).toEqual([]);
    expect(plan.unscheduled).toHaveLength(5);
    expect(plan.unscheduled.find((event) => event.id === 'football:unknown')).toMatchObject({
      date: '2026-10-26',
      reason: 'time-unknown',
    });
    expect(plan.unscheduled.find((event) => event.id === 'football:date-only')?.reason).toBe(
      'time-unknown',
    );
    expect(plan.unscheduled.find((event) => event.id === 'football:invalid')?.reason).toBe(
      'invalid-time',
    );
    expect(plan.unscheduled.find((event) => event.id === 'football:impossible')?.date).toBeNull();
    expect(plan.unscheduled.find((event) => event.kind === 'f1')).toMatchObject({
      date: '2026-10-25',
      reason: 'time-unknown',
    });
  });

  it('does not retain date-only fixtures from previous weeks', () => {
    const old = { ...fixture('old'), time_utc: undefined, date: '2026-10-01' };
    expect(
      buildViewingEvents(
        [old],
        [grandPrix({ date: '2026-10-01', time: undefined })],
        ['barcelona'],
        [],
        now,
      ),
    ).toEqual({ events: [], unscheduled: [] });
  });

  it('interprets timezone offsets and UTC-labelled timestamps independently of host timezone', () => {
    const plan = buildViewingEvents(
      [
        fixture('offset', '2026-10-26T00:30:00+09:00'),
        fixture('utc-space', '2026-10-25 15:30:00'),
        fixture('utc-minutes', '2026-10-25T15:30'),
      ],
      [],
      ['barcelona'],
      [],
      now,
    );
    expect(plan.events.map((event) => event.start)).toEqual(
      Array(3).fill(Date.parse('2026-10-25T15:30:00Z')),
    );
    expect(viewingDayKey(plan.events[0]!.start, 'Asia/Yakutsk')).toBe('2026-10-26');
    expect(viewingDayKey(plan.events[0]!.start, 'UTC')).toBe('2026-10-25');
  });

  it('includes all provided weekend sessions and deduplicates sprint qualifying aliases', () => {
    const race = grandPrix({
      FirstPractice: { date: '2026-10-25', time: '09:00:00Z' },
      SecondPractice: { date: '2026-10-25', time: '11:00:00Z' },
      ThirdPractice: { date: '2026-10-25', time: '13:00:00Z' },
      SprintQualifying: { date: '2026-10-25', time: '14:00:00Z' },
      SprintShootout: { date: '2026-10-25', time: '14:00:00Z' },
      Sprint: { date: '2026-10-25', time: '16:00:00Z' },
      Qualifying: { date: '2026-10-25', time: '18:00:00Z' },
    });
    const plan = buildViewingEvents([], [race], [], [], now);
    expect(plan.events.map((event) => event.kind === 'f1' && event.sessionId)).toEqual([
      'fp1',
      'fp2',
      'fp3',
      'sprint-qualifying',
      'sprint',
      'qualifying',
      'race',
    ]);
    expect(plan.events.map((event) => event.durationMinutes)).toEqual([
      60, 60, 60, 45, 45, 60, 120,
    ]);
    expect(plan.events.every((event) => event.estimatedEnd && !event.isLive)).toBe(true);
  });

  it('deduplicates provider records, uses collision-proof IDs and keeps IDs stable as time changes', () => {
    const first = buildViewingEvents(
      [fixture('20:race'), fixture('20:race', '2026-10-25T18:00:00Z')],
      [grandPrix(), grandPrix()],
      ['barcelona'],
      [],
      now,
    );
    expect(first.events).toHaveLength(2);
    expect(new Set(first.events.map((event) => event.id)).size).toBe(2);
    expect(first.events.find((event) => event.kind === 'football')?.id).toBe('football:20%3Arace');
    expect(first.events.find((event) => event.kind === 'football')?.start).toBe(
      Date.parse('2026-10-25T18:00:00Z'),
    );
    const shifted = buildViewingEvents(
      [fixture('20:race', '2026-10-26T18:00:00Z')],
      [grandPrix({ time: '21:00:00Z' })],
      ['barcelona'],
      [],
      now,
    );
    expect(shifted.events.map((event) => event.id).sort()).toEqual(
      first.events.map((event) => event.id).sort(),
    );
  });
});

describe('viewing conflicts', () => {
  it('finds transitive overlap groups including same-sport events and excludes touching intervals', () => {
    const events = [
      interval('a', '2026-10-25T10:00Z', '2026-10-25T12:00Z'),
      interval('b', '2026-10-25T11:30Z', '2026-10-25T13:30Z'),
      interval('c', '2026-10-25T13:00Z', '2026-10-25T14:00Z'),
      interval('touching', '2026-10-25T14:00Z', '2026-10-25T15:00Z'),
      interval('later', '2026-10-25T15:00Z', '2026-10-25T16:00Z'),
    ];
    const groups = findViewingConflicts(events.reverse());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.eventIds).toEqual(['a', 'b', 'c']);
    expect(groups[0]?.end).toBe(Date.parse('2026-10-25T14:00Z'));
  });

  it('finds cross-sport overlaps and skips invalid or duplicate intervals', () => {
    const plan = buildViewingEvents(
      [fixture('match', '2026-10-25T20:30:00Z')],
      [grandPrix()],
      ['barcelona'],
      [],
      now,
    );
    const groups = findViewingConflicts([
      ...plan.events,
      ...plan.events,
      { ...plan.events[0]!, id: 'bad', end: NaN },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.eventIds).toHaveLength(2);
    expect(new Set(groups[0]?.events.map((event) => event.kind))).toEqual(
      new Set(['football', 'f1']),
    );
    expect(findViewingConflicts([...plan.events].reverse())[0]?.id).toBe(groups[0]?.id);
  });

  it('keeps separate conflict groups when a genuine gap separates them', () => {
    const events = [
      interval('a', '2026-10-25T10:00Z', '2026-10-25T12:00Z'),
      interval('b', '2026-10-25T11:00Z', '2026-10-25T13:00Z'),
      interval('c', '2026-10-25T14:00Z', '2026-10-25T16:00Z'),
      interval('d', '2026-10-25T15:00Z', '2026-10-25T17:00Z'),
    ];
    expect(findViewingConflicts(events).map((group) => group.eventIds)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('local viewing dates', () => {
  it('groups UTC events by the chosen local start day and filters overnight continuation', () => {
    const overnight = interval('overnight', '2026-10-25T14:30Z', '2026-10-25T16:30Z'); // 23:30–01:30 Yakutsk.
    const tomorrow = interval('tomorrow', '2026-10-25T18:00Z', '2026-10-25T20:00Z');
    expect(
      groupViewingEventsByDay([tomorrow, overnight]).map((group) => [
        group.date,
        group.events.map((event) => event.id),
      ]),
    ).toEqual([
      ['2026-10-25', ['overnight']],
      ['2026-10-26', ['tomorrow']],
    ]);
    expect(
      filterViewingEventsByDay([tomorrow, overnight], '2026-10-26').map((event) => event.id),
    ).toEqual(['overnight', 'tomorrow']);
    expect(filterViewingEventsByDay([tomorrow, overnight], '2026-10-27')).toEqual([]);
    expect(filterViewingEventsByDay([tomorrow], '2026-02-30')).toEqual([]);
  });

  it('does not count an event ending exactly at local midnight as part of the next day', () => {
    const event = interval('midnight', '2026-10-25T13:00Z', '2026-10-25T15:00Z');
    expect(filterViewingEventsByDay([event], '2026-10-25')).toHaveLength(1);
    expect(filterViewingEventsByDay([event], '2026-10-26')).toHaveLength(0);
  });

  it('keeps the same date through repeated hours on a DST transition', () => {
    const first = interval('first-hour', '2026-11-01T05:30Z', '2026-11-01T05:59Z');
    const second = interval('second-hour', '2026-11-01T06:30Z', '2026-11-01T07:30Z');
    const groups = groupViewingEventsByDay([second, first], 'America/New_York');
    expect(groups.map((group) => group.date)).toEqual(['2026-11-01']);
    expect(groups[0]?.events.map((event) => event.id)).toEqual(['first-hour', 'second-hour']);
    expect(
      filterViewingEventsByDay([second, first], '2026-11-01', 'America/New_York'),
    ).toHaveLength(2);
  });
});
