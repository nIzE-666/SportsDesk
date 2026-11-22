// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import {
  LIVE_SOURCE_KEY,
  findPitchMatchId,
  loadLiveDay,
  loadLiveNow,
  needsLiveUpdates,
  utcDatesForLocalDay,
  useLiveMatches,
  type UseLiveMatchesResult,
} from './liveData';
import { parseLiveScore, type LiveMatch } from './liveSources';
import { setString } from './storage';

vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`src/test/fixtures/liveSources/${name}`, 'utf8')) as unknown;
}

const DAY_0 = fixture('livescore-date-20261108-offset0.json');
const DAY_9 = fixture('livescore-date-20261108-offset9.json');
const LIVE_9 = fixture('livescore-live-offset9.json');
const ESPN_ENG1 = fixture('espn-eng1-20261108.json');

/** A followed competition with one running and one later match, for polling tests. */
const HOOK_LIVE = {
  Stages: [
    {
      CompN: 'Premier League',
      CompD: 'England',
      Cnm: 'England',
      Events: [
        {
          Eid: 'hook-live',
          T1: [{ Nm: 'Arsenal' }],
          T2: [{ Nm: 'Chelsea' }],
          Eps: "67'",
          Esd: 20261115000000,
          Tr1: '1',
          Tr2: '0',
        },
        {
          Eid: 'hook-scheduled',
          T1: [{ Nm: 'Everton' }],
          T2: [{ Nm: 'Fulham' }],
          Eps: 'NS',
          Esd: 20261115003000,
        },
      ],
    },
  ],
};

function reply(payload: unknown, fetchedAt = '2026-11-08T10:00:00.000Z', stale = false) {
  return { payload, source: 'fixture', fetchedAt, stale };
}

function calledPaths(source?: string): string[] {
  return vi
    .mocked(api)
    .mock.calls.filter(([callSource]) => !source || callSource === source)
    .map(([, path]) => path);
}

describe('loadLiveDay', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api).mockReset();
  });

  it('asks for one whole-offset day and keeps only the local day', async () => {
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockResolvedValue(reply(DAY_9));
    const result = await loadLiveDay({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Yakutsk',
      now: new Date('2026-11-08T10:00:00Z'),
    });
    expect(calledPaths('livescore')).toEqual(['date/soccer/20261108/9?MD=1']);
    expect(result.source).toBe('livescore');
    expect(result.fetchedAt).toBe('2026-11-08T10:00:00.000Z');
    expect(result.matches).toHaveLength(49);
    expect(result.matches.every((match) => match.source === 'livescore')).toBe(true);
    expect(result.matches.some((match) => match.id === 'livescore:1793601')).toBe(true);
  });

  it('uses offset zero for UTC', async () => {
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockResolvedValue(reply(DAY_0));
    const result = await loadLiveDay({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'UTC',
      now: new Date('2026-11-08T10:00:00Z'),
    });
    expect(calledPaths('livescore')).toEqual(['date/soccer/20261108/0?MD=1']);
    expect(result.matches).toHaveLength(40);
  });

  it('covers a fractional local day with two offset-zero UTC days and filters it', async () => {
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockResolvedValue(reply(DAY_0));
    const result = await loadLiveDay({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Kolkata',
      now: new Date('2026-11-08T10:00:00Z'),
    });
    expect(calledPaths('livescore').sort()).toEqual([
      'date/soccer/20261107/0?MD=1',
      'date/soccer/20261108/0?MD=1',
    ]);
    expect(result.matches).toHaveLength(35);
    expect(result.matches.some((match) => match.id === 'livescore:1810746')).toBe(false);
    expect(result.matches.some((match) => match.id === 'livescore:1793599')).toBe(true);
    expect(utcDatesForLocalDay('2026-11-08', 'Asia/Kolkata')).toEqual(['2026-11-07', '2026-11-08']);
    expect(utcDatesForLocalDay('2026-11-08', 'America/St_Johns')).toEqual([
      '2026-11-08',
      '2026-11-09',
    ]);
  });

  it('falls back to ESPN when LiveScore fails', async () => {
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockImplementation(async (source) => {
      if (source === 'livescore') throw new Error('LiveScore недоступен');
      return reply(ESPN_ENG1);
    });
    const result = await loadLiveDay({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Yakutsk',
      now: new Date('2026-11-08T10:00:00Z'),
    });
    expect(calledPaths('livescore')).toEqual(['date/soccer/20261108/9?MD=1']);
    expect(calledPaths('espn').sort()).toEqual([
      'eng.1/scoreboard?dates=20261107',
      'eng.1/scoreboard?dates=20261108',
    ]);
    expect(result.source).toBe('espn');
    expect(result.matches).toHaveLength(4);
    expect(result.matches.every((match) => match.source === 'espn')).toBe(true);
  });

  it('falls back when LiveScore returns nothing usable', async () => {
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockImplementation(async (source) =>
      source === 'livescore' ? reply({ Stages: [] }) : reply(ESPN_ENG1),
    );
    const result = await loadLiveDay({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Yakutsk',
      now: new Date('2026-11-08T10:00:00Z'),
    });
    expect(result.source).toBe('espn');
    expect(result.matches).toHaveLength(4);
  });

  it('keeps the livescore-only choice even when it fails', async () => {
    setString(LIVE_SOURCE_KEY, 'livescore');
    vi.mocked(api).mockRejectedValue(new Error('LiveScore недоступен'));
    await expect(
      loadLiveDay({
        leagueIds: ['l_4WFCIZ'],
        timeZone: 'Asia/Yakutsk',
        now: new Date('2026-11-08T10:00:00Z'),
      }),
    ).rejects.toThrow('LiveScore недоступен');
    expect(calledPaths('espn')).toEqual([]);
  });

  it('asks ESPN only when it is the chosen source', async () => {
    setString(LIVE_SOURCE_KEY, 'espn');
    vi.mocked(api).mockResolvedValue(reply(ESPN_ENG1));
    const result = await loadLiveDay({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Yakutsk',
      now: new Date('2026-11-08T10:00:00Z'),
    });
    expect(calledPaths('livescore')).toEqual([]);
    expect(calledPaths('espn').length).toBe(2);
    expect(result.source).toBe('espn');
  });

  it('treats a missing or unknown setting as auto', async () => {
    for (const value of [null, 'other']) {
      localStorage.clear();
      if (value !== null) setString(LIVE_SOURCE_KEY, value);
      vi.mocked(api).mockReset();
      vi.mocked(api).mockResolvedValue(reply(DAY_9));
      const result = await loadLiveDay({
        leagueIds: ['l_4WFCIZ'],
        timeZone: 'Asia/Yakutsk',
        now: new Date('2026-11-08T10:00:00Z'),
      });
      expect(result.source).toBe('livescore');
    }
  });
});

describe('loadLiveNow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api).mockReset();
  });

  it('asks the live endpoint at the local whole-hour offset', async () => {
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockResolvedValue(reply(LIVE_9));
    const result = await loadLiveNow({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Yakutsk',
      now: new Date('2026-11-14T15:01:00Z'),
      source: 'livescore',
    });
    expect(calledPaths('livescore')).toEqual(['live/soccer/9?MD=1']);
    expect(result.source).toBe('livescore');
    expect(result.matches).toHaveLength(15);
  });

  it('uses offset zero for a fractional zone', async () => {
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockResolvedValue(reply(LIVE_9));
    await loadLiveNow({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Kolkata',
      now: new Date('2026-11-14T15:01:00Z'),
      source: 'livescore',
    });
    expect(calledPaths('livescore')).toEqual(['live/soccer/0?MD=1']);
  });

  it('does not call ESPN for the live sheet when the day sheet is LiveScore', async () => {
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockRejectedValue(new Error('LiveScore недоступен'));
    await expect(
      loadLiveNow({
        leagueIds: ['l_4WFCIZ'],
        timeZone: 'Asia/Yakutsk',
        now: new Date('2026-11-14T15:01:00Z'),
        source: 'livescore',
      }),
    ).rejects.toThrow('LiveScore недоступен');
    expect(calledPaths('espn')).toEqual([]);
  });

  it('re-reads ESPN scoreboards when the day sheet is ESPN', async () => {
    vi.mocked(api).mockResolvedValue(reply(ESPN_ENG1));
    const result = await loadLiveNow({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Yakutsk',
      now: new Date('2026-11-08T10:00:00Z'),
      source: 'espn',
    });
    expect(calledPaths('livescore')).toEqual([]);
    expect(calledPaths('espn').sort()).toEqual([
      'eng.1/scoreboard?dates=20261107',
      'eng.1/scoreboard?dates=20261108',
    ]);
    expect(result.source).toBe('espn');
    expect(result.matches).toHaveLength(4);
  });

  it('treats an empty LiveScore live answer as normal', async () => {
    vi.mocked(api).mockResolvedValue(reply({ Stages: [] }));
    const result = await loadLiveNow({
      leagueIds: ['l_4WFCIZ'],
      timeZone: 'Asia/Yakutsk',
      now: new Date('2026-11-14T15:01:00Z'),
      source: 'livescore',
    });
    expect(result.source).toBe('livescore');
    expect(result.matches).toEqual([]);
    expect(calledPaths('espn')).toEqual([]);
  });
});

function liveMatch(overrides: Partial<LiveMatch> = {}): LiveMatch {
  return {
    id: 'livescore:1',
    source: 'livescore',
    leagueId: 'l_4WFCIZ',
    competition: 'Premier League',
    home: { name: 'Arsenal', clubKey: 'arsenal' },
    away: { name: 'Chelsea', clubKey: 'chelsea' },
    kickoffUtc: '2026-11-08T14:00:00.000Z',
    state: 'scheduled',
    minute: null,
    score: { home: null, away: null },
    ...overrides,
  };
}

describe('needsLiveUpdates', () => {
  const now = Date.parse('2026-11-08T14:00:00.000Z');
  const leagues = ['l_4WFCIZ'];

  it('wants updates for a live match and a match starting within fifteen minutes', () => {
    expect(needsLiveUpdates([liveMatch({ state: 'live' })], leagues, now)).toBe(true);
    expect(
      needsLiveUpdates([liveMatch({ kickoffUtc: '2026-11-08T14:14:00.000Z' })], leagues, now),
    ).toBe(true);
    expect(
      needsLiveUpdates([liveMatch({ kickoffUtc: '2026-11-08T14:16:00.000Z' })], leagues, now),
    ).toBe(false);
  });

  it('wants updates for a recent kickoff that is not finished', () => {
    expect(
      needsLiveUpdates([liveMatch({ kickoffUtc: '2026-11-08T11:31:00.000Z' })], leagues, now),
    ).toBe(true);
    expect(
      needsLiveUpdates([liveMatch({ kickoffUtc: '2026-11-08T11:30:00.000Z' })], leagues, now),
    ).toBe(false);
    expect(
      needsLiveUpdates(
        [liveMatch({ kickoffUtc: '2026-11-08T13:00:00.000Z', state: 'finished' })],
        leagues,
        now,
      ),
    ).toBe(false);
  });

  it('ignores leagues and matches it was not asked about', () => {
    expect(
      needsLiveUpdates([liveMatch({ state: 'live', leagueId: 'l_0eg6C9' })], leagues, now),
    ).toBe(false);
    expect(needsLiveUpdates([liveMatch({ state: 'live', leagueId: null })], leagues, now)).toBe(
      false,
    );
  });
});

describe('findPitchMatchId', () => {
  const live = liveMatch({
    id: 'livescore:1793601',
    home: { name: 'Arsenal', clubKey: 'arsenal' },
    away: { name: 'Hull City', clubKey: 'hull city' },
    kickoffUtc: '2026-11-07T15:00:00.000Z',
    state: 'finished',
    score: { home: 1, away: 0 },
  });
  const pitch = {
    leagueId: 'l_4WFCIZ',
    match: {
      id: 'pitch-1',
      status: 'finished',
      home_team: { id: 'a', name: 'Arsenal' },
      away_team: { id: 'h', name: 'Hull City' },
      time_utc: '2026-11-07T16:00:00.000Z',
      score_home: 1,
      score_away: 0,
    },
  };

  it('matches the same league, both club keys and a kickoff within three hours', () => {
    expect(findPitchMatchId(live, [pitch])).toBe('pitch-1');
    expect(findPitchMatchId(live, [{ ...pitch, leagueId: 'l_0eg6C9' }])).toBeNull();
    expect(
      findPitchMatchId(live, [
        {
          ...pitch,
          match: { ...pitch.match, time_utc: '2026-11-07T19:00:00.000Z' },
        },
      ]),
    ).toBeNull();
    expect(
      findPitchMatchId(live, [
        {
          ...pitch,
          match: { ...pitch.match, away_team: { id: 'c', name: 'Chelsea' } },
        },
      ]),
    ).toBeNull();
  });
});

const HOOK_LEAGUES = ['l_4WFCIZ'];
let latest: UseLiveMatchesResult | null = null;
function Probe() {
  latest = useLiveMatches({ leagueIds: HOOK_LEAGUES });
  return null;
}

describe('useLiveMatches', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    localStorage.clear();
    vi.mocked(api).mockReset();
    latest = null;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function render() {
    await act(async () => root.render(<Probe />));
    await act(async () => {});
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await act(async () => {});
  }

  it('makes no live requests when no followed match qualifies', async () => {
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    vi.mocked(api).mockImplementation(async (source, path) => {
      if (source === 'livescore' && path.startsWith('date/')) return reply(DAY_9);
      if (source === 'livescore' && path.startsWith('live/')) return reply(LIVE_9);
      return reply({});
    });
    await render();
    expect(latest?.matches).toHaveLength(49);
    expect(calledPaths('livescore')).toHaveLength(1);
    await advance(120_000);
    expect(calledPaths('livescore').filter((path) => path.startsWith('live/'))).toEqual([]);
  });

  it('loads the day on mount and the live sheet every sixty seconds while a match qualifies', async () => {
    vi.setSystemTime(new Date('2026-11-14T15:01:00Z'));
    vi.mocked(api).mockImplementation(async (source, path) => {
      if (source === 'livescore' && path.startsWith('date/')) return reply(HOOK_LIVE);
      if (source === 'livescore' && path.startsWith('live/')) return reply(HOOK_LIVE);
      return reply({});
    });
    await render();
    expect(calledPaths('livescore')).toContain('date/soccer/20261115/9?MD=1');
    expect(calledPaths('livescore').filter((path) => path.startsWith('live/'))).toHaveLength(1);
    expect(latest?.matches.some((match) => match.state === 'live')).toBe(true);
    await advance(60_000);
    expect(calledPaths('livescore').filter((path) => path.startsWith('live/'))).toHaveLength(2);
    await advance(60_000);
    expect(calledPaths('livescore').filter((path) => path.startsWith('live/'))).toHaveLength(3);
  });

  it('keeps the day sheet when LiveScore reports that nothing is running', async () => {
    vi.setSystemTime(new Date('2026-11-14T15:01:00Z'));
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockImplementation(async (source, path) => {
      if (source === 'livescore' && path.startsWith('date/')) return reply(HOOK_LIVE);
      if (source === 'livescore' && path.startsWith('live/')) return reply({ Stages: [] });
      return reply({});
    });
    await render();
    expect(calledPaths('livescore').filter((path) => path.startsWith('live/'))).toHaveLength(1);
    expect(calledPaths('espn')).toEqual([]);
    expect(latest?.error).toBeNull();
    expect(latest?.matches).toHaveLength(2);
    expect(latest?.source).toBe('livescore');
  });

  it('re-reads ESPN scoreboards when ESPN answered the day sheet', async () => {
    vi.setSystemTime(new Date('2026-11-14T15:01:00Z'));
    setString(LIVE_SOURCE_KEY, 'auto');
    const espnLive = {
      leagues: [{ slug: 'eng.1', name: 'English Premier League' }],
      events: [
        {
          id: 'espn-live',
          date: '2026-11-14T15:00Z',
          status: {
            displayClock: "10'",
            type: { name: 'STATUS_FIRST_HALF', state: 'in', completed: false },
          },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', score: '0', team: { displayName: 'Arsenal' } },
                { homeAway: 'away', score: '0', team: { displayName: 'Chelsea' } },
              ],
            },
          ],
        },
      ],
    };
    vi.mocked(api).mockImplementation(async (source) => {
      if (source === 'livescore') throw new Error('LiveScore недоступен');
      return reply(espnLive);
    });
    await render();
    expect(calledPaths('livescore').filter((path) => path.startsWith('live/'))).toEqual([]);
    expect(calledPaths('espn').length).toBeGreaterThan(2);
    expect(latest?.source).toBe('espn');
    expect(latest?.matches).toHaveLength(1);
    expect(latest?.matches[0]).toMatchObject({ state: 'live', minute: "10'" });
  });

  it('waits longer after each live error, up to fifteen minutes, without switching sources', async () => {
    vi.setSystemTime(new Date('2026-11-14T15:01:00Z'));
    setString(LIVE_SOURCE_KEY, 'auto');
    vi.mocked(api).mockImplementation(async (source, path) => {
      if (source === 'livescore' && path.startsWith('date/')) return reply(HOOK_LIVE);
      if (source === 'livescore' && path.startsWith('live/')) throw new Error('нет связи');
      return reply({});
    });
    await render();
    const liveCalls = () =>
      calledPaths('livescore').filter((path) => path.startsWith('live/')).length;
    expect(liveCalls()).toBe(1);
    await advance(60_000);
    expect(liveCalls()).toBe(2);
    await advance(60_000);
    expect(liveCalls()).toBe(2);
    await advance(60_000);
    expect(liveCalls()).toBe(3);
    await advance(180_000);
    expect(liveCalls()).toBe(3);
    await advance(60_000);
    expect(liveCalls()).toBe(4);
    expect(latest?.error).toBe('нет связи');
    expect(latest?.matches.length).toBeGreaterThan(0);
    expect(calledPaths('espn')).toEqual([]);
  });

  it('keeps the last day and its fetch time when an hourly refresh fails', async () => {
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    vi.mocked(api).mockResolvedValue(reply(DAY_9));
    await render();
    expect(latest?.matches).toHaveLength(49);
    const fetchedAt = latest?.fetchedAt;
    vi.mocked(api).mockRejectedValue(new Error('источник не ответил'));
    await advance(3_660_000);
    expect(latest?.matches).toHaveLength(49);
    expect(latest?.fetchedAt).toBe(fetchedAt);
    expect(latest?.error).toBe('источник не ответил');
  });

  it('reloads the day when the local date changes', async () => {
    vi.setSystemTime(new Date('2026-11-08T14:59:30Z'));
    const nextDay = {
      Stages: [
        {
          CompN: 'Premier League',
          CompD: 'England',
          Cnm: 'England',
          Events: [
            {
              Eid: 'new-day',
              T1: [{ Nm: 'Arsenal' }],
              T2: [{ Nm: 'Chelsea' }],
              Eps: 'NS',
              Esd: 20261109120000,
            },
          ],
        },
      ],
    };
    vi.mocked(api).mockImplementation(async (source, path) => {
      if (source === 'livescore' && path.includes('20261109')) return reply(nextDay);
      if (source === 'livescore' && path.startsWith('date/')) return reply(DAY_9);
      return reply({ Stages: [] });
    });
    await render();
    expect(latest?.matches).toHaveLength(49);
    await advance(60_000);
    expect(calledPaths('livescore')).toContain('date/soccer/20261109/9?MD=1');
    expect(latest?.matches.map((match) => match.id)).toEqual(['livescore:new-day']);
    expect(latest?.source).toBe('livescore');
  });

  it('keeps the latest score and minute when a match leaves the live feed, refreshes the day sheet immediately, and adopts finished only when confirmed', async () => {
    vi.setSystemTime(new Date('2026-11-14T15:00:00Z'));
    let dayCalls = 0;
    let liveCalls = 0;

    const makeStage = (eps: string, tr1: string, tr2: string) => ({
      Stages: [
        {
          CompN: 'Premier League',
          CompD: 'England',
          Cnm: 'England',
          Events: [
            {
              Eid: 'ev_100',
              Eps: eps,
              Esd: 20261115000000,
              T1: [{ Nm: 'Arsenal' }],
              T2: [{ Nm: 'Liverpool' }],
              Tr1: tr1,
              Tr2: tr2,
            },
          ],
        },
      ],
    });

    vi.mocked(api).mockImplementation(async (source, path) => {
      const nowIso = new Date().toISOString();
      if (source === 'livescore' && path.startsWith('date/')) {
        dayCalls += 1;
        // First two day calls (initial mount + first immediate refresh after disappearance) still lag at 65' 1:0;
        // third day call confirms FT 2:1.
        if (dayCalls < 3) return reply(makeStage("65'", '1', '0'), nowIso);
        return reply(makeStage('FT', '2', '1'), nowIso);
      }
      if (source === 'livescore' && path.startsWith('live/')) {
        liveCalls += 1;
        if (liveCalls === 1) return reply(makeStage("85'", '2', '1'), nowIso);
        return reply({ Stages: [] }, nowIso);
      }
      return reply({}, nowIso);
    });

    await render();
    expect(dayCalls).toBe(1);
    expect(liveCalls).toBe(1);
    expect(latest?.matches[0]).toMatchObject({
      id: 'livescore:ev_100',
      state: 'live',
      minute: "85'",
      score: { home: 2, away: 1 },
    });

    // At +60s, the match disappears from /live/soccer/.
    // Day sheet refreshes immediately without waiting an hour, and while date/ lags at 65' 1:0,
    // the visible match keeps 85' and 2:1 instead of regressing or inventing a finished status.
    await advance(60_000);
    expect(liveCalls).toBe(2);
    expect(dayCalls).toBe(2);
    expect(latest?.matches[0]).toMatchObject({
      id: 'livescore:ev_100',
      state: 'live',
      minute: "85'",
      score: { home: 2, away: 1 },
    });

    // At +120s, the next live check sees the match still unconfirmed and refreshes date/, which now confirms FT 2:1.
    await advance(60_000);
    expect(liveCalls).toBe(3);
    expect(dayCalls).toBe(3);
    expect(latest?.matches[0]).toMatchObject({
      id: 'livescore:ev_100',
      state: 'finished',
      minute: null,
      score: { home: 2, away: 1 },
    });
    expect(needsLiveUpdates(latest!.matches, HOOK_LEAGUES, Date.now())).toBe(false);

    // Once confirmed finished, no more 1-minute live polls occur.
    await advance(60_000);
    expect(liveCalls).toBe(3);
  });

  it('ignores stale and older reordered replies so live or finished scores do not regress', async () => {
    vi.setSystemTime(new Date('2026-11-14T15:00:00Z'));
    let liveCalls = 0;
    const makeStage = (eps: string, tr1: string, tr2: string) => ({
      Stages: [
        {
          CompN: 'Premier League',
          CompD: 'England',
          Cnm: 'England',
          Events: [
            {
              Eid: 'ev_200',
              Eps: eps,
              Esd: 20261115000000,
              T1: [{ Nm: 'Arsenal' }],
              T2: [{ Nm: 'Chelsea' }],
              Tr1: tr1,
              Tr2: tr2,
            },
          ],
        },
      ],
    });

    vi.mocked(api).mockImplementation(async (source, path) => {
      if (source === 'livescore' && path.startsWith('date/')) {
        return reply(makeStage("50'", '1', '0'), '2026-11-14T15:00:00.000Z');
      }
      if (source === 'livescore' && path.startsWith('live/')) {
        liveCalls += 1;
        if (liveCalls === 1) {
          return reply(makeStage("80'", '2', '1'), '2026-11-14T15:00:30.000Z', false);
        }
        if (liveCalls === 2) {
          // Older reordered reply
          return reply(makeStage("60'", '1', '1'), '2026-11-14T15:00:10.000Z', false);
        }
        // Stale empty reply
        return reply({ Stages: [] }, '2026-11-14T14:55:00.000Z', true);
      }
      return reply({});
    });

    await render();
    expect(latest?.matches[0]).toMatchObject({
      minute: "80'",
      score: { home: 2, away: 1 },
    });

    // Older reordered reply at +60s is ignored
    await advance(60_000);
    expect(latest?.matches[0]).toMatchObject({
      minute: "80'",
      score: { home: 2, away: 1 },
    });

    // Stale empty reply at +120s does not drop the match or regress to 50' 1:0
    await advance(60_000);
    expect(latest?.matches[0]).toMatchObject({
      minute: "80'",
      score: { home: 2, away: 1 },
    });
    expect(latest?.stale).toBe(true);
  });
});

describe('fixture parser stays compatible', () => {
  it('reads the saved live fixture with the offset used by the hook tests', () => {
    expect(parseLiveScore(LIVE_9, 9)).toHaveLength(15);
  });
});
