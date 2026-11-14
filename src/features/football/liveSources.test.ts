import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  onLocalDay,
  parseEspnScoreboard,
  parseLiveScore,
  type LiveMatch,
  type LiveState,
} from './liveSources';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../test/fixtures/liveSources/${name}`, import.meta.url), 'utf8'),
  ) as unknown;
}

function leagueCounts(matches: LiveMatch[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of matches) {
    if (!match.leagueId) continue;
    counts[match.leagueId] = (counts[match.leagueId] ?? 0) + 1;
  }
  return counts;
}

function states(matches: LiveMatch[]): LiveState[] {
  return [...new Set(matches.map((match) => match.state))];
}

const LIVESCORE_FIXTURES: Array<{
  file: string;
  offset: number;
  total: number;
  counts: Record<string, number>;
}> = [
  {
    file: 'livescore-date-20261108-offset0.json',
    offset: 0,
    total: 40,
    counts: {
      l_4WFCIZ: 5,
      l_0ErfuF: 5,
      l_1Isor4: 3,
      l_0ALvwF: 5,
      l_3FJFUl: 6,
      l_0eg6C9: 7,
    },
  },
  {
    file: 'livescore-date-20261108-offset9.json',
    offset: 9,
    total: 49,
    counts: {
      l_4WFCIZ: 7,
      l_0ErfuF: 4,
      l_1Isor4: 2,
      l_0ALvwF: 5,
      l_3FJFUl: 3,
      l_0eg6C9: 15,
    },
  },
  {
    file: 'livescore-date-20261105-uefa-offset9.json',
    offset: 9,
    total: 22,
    counts: { l_0bfbkO: 9, l_38d9HA: 1 },
  },
  {
    file: 'livescore-date-20261106-uefa-offset9.json',
    offset: 9,
    total: 35,
    counts: { l_38d9HA: 17, l_2WZ2tt: 18 },
  },
  {
    file: 'livescore-live-offset9.json',
    offset: 9,
    total: 15,
    counts: {},
  },
];

function liveScoreEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Eid: '1',
    T1: [{ Nm: 'Alpha' }],
    T2: [{ Nm: 'Beta' }],
    Eps: 'NS',
    Esd: 20261108140000,
    ...overrides,
  };
}

function liveScoreJson(
  events: unknown[],
  stage: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    Stages: [
      { CompN: 'Premier League', CompD: 'England', Cnm: 'England', Events: events, ...stage },
    ],
  };
}

interface EspnEventOverrides {
  id?: string;
  date?: unknown;
  status?: unknown;
  homeName?: string;
  awayName?: string;
  homeScore?: unknown;
  awayScore?: unknown;
}

function espnStatus(
  name: string,
  state: string,
  shortDetail?: string,
  displayClock?: string,
  completed = false,
): Record<string, unknown> {
  return {
    displayClock: displayClock ?? shortDetail ?? '',
    type: { name, state, completed, shortDetail, detail: shortDetail },
  };
}

function espnEvent(overrides: EspnEventOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? '1',
    date: overrides.date === undefined ? '2026-11-08T14:00Z' : overrides.date,
    status: overrides.status ?? espnStatus('STATUS_SECOND_HALF', 'in', "67'", "67'"),
    competitions: [
      {
        competitors: [
          {
            homeAway: 'home',
            score: overrides.homeScore === undefined ? '1' : overrides.homeScore,
            team: { displayName: overrides.homeName ?? 'Alpha' },
          },
          {
            homeAway: 'away',
            score: overrides.awayScore === undefined ? '0' : overrides.awayScore,
            team: { displayName: overrides.awayName ?? 'Beta' },
          },
        ],
      },
    ],
  };
}

const ESPN_LEAGUE = [{ slug: 'eng.1', name: 'English Premier League' }];

describe('LiveScore fixtures', () => {
  for (const entry of LIVESCORE_FIXTURES) {
    it(`parses ${entry.file} with exact league counts`, () => {
      const matches = parseLiveScore(fixture(entry.file), entry.offset);
      expect(matches).toHaveLength(entry.total);
      expect(leagueCounts(matches)).toEqual(entry.counts);
      expect(new Set(matches.map((match) => match.source))).toEqual(new Set(['livescore']));
      expect(new Set(matches.map((match) => match.id)).size).toBe(matches.length);
    });
  }

  it('keeps every field of a known match', () => {
    const matches = parseLiveScore(fixture('livescore-date-20261108-offset0.json'), 0);
    expect(matches.find((match) => match.id === 'livescore:1793599')).toEqual({
      id: 'livescore:1793599',
      source: 'livescore',
      leagueId: 'l_4WFCIZ',
      competition: 'Premier League',
      home: { name: 'Brighton', clubKey: 'brighton' },
      away: { name: 'Brentford', clubKey: 'brentford' },
      kickoffUtc: '2026-11-08T14:00:00.000Z',
      state: 'finished',
      minute: null,
      score: { home: 2, away: 0 },
    });
  });

  it('leaves competitions outside the ten followed ones without a league id', () => {
    const offset0 = parseLiveScore(fixture('livescore-date-20261108-offset0.json'), 0);
    expect(offset0.filter((match) => match.competition === 'FA Cup')).toHaveLength(4);
    expect(
      offset0.filter((match) => match.competition === 'FA Cup').every((m) => !m.leagueId),
    ).toBe(true);
    expect(
      offset0.filter((match) => match.competition === 'Eredivisie').every((m) => !m.leagueId),
    ).toBe(true);

    const offset9 = parseLiveScore(fixture('livescore-date-20261108-offset9.json'), 9);
    expect(
      offset9.filter((match) => match.competition === 'Championship').every((m) => !m.leagueId),
    ).toBe(true);

    const uefa = parseLiveScore(fixture('livescore-date-20261105-uefa-offset9.json'), 9);
    expect(
      uefa.filter((match) => match.competition === 'UEFA Youth League').every((m) => !m.leagueId),
    ).toBe(true);
    expect(
      uefa
        .filter((match) => match.competition === 'AFC Champions League Two')
        .every((m) => !m.leagueId),
    ).toBe(true);

    const live = parseLiveScore(fixture('livescore-live-offset9.json'), 9);
    expect(leagueCounts(live)).toEqual({});
  });
});

describe('LiveScore statuses and minutes', () => {
  it('reads Esd as local wall-clock time at the requested offset, matching ESPN in UTC', () => {
    // The same match is 20261108140000 at offset 0 and 20261108230000 at offset 9.
    // ESPN's UTC date for it is 2026-11-08T14:00Z.
    const at0 = parseLiveScore(fixture('livescore-date-20261108-offset0.json'), 0);
    const at9 = parseLiveScore(fixture('livescore-date-20261108-offset9.json'), 9);
    const espn = parseEspnScoreboard(fixture('espn-eng1-20261108.json'));

    for (const [liveScoreId, espnId] of [
      ['livescore:1793599', 'espn:401879244'],
      ['livescore:1793602', 'espn:401879243'],
    ]) {
      const offset0 = at0.find((match) => match.id === liveScoreId)?.kickoffUtc;
      const offset9 = at9.find((match) => match.id === liveScoreId)?.kickoffUtc;
      expect(offset0).toBe('2026-11-08T14:00:00.000Z');
      expect(offset9).toBe(offset0);
      expect(espn.find((match) => match.id === espnId)?.kickoffUtc).toBe(offset0);
    }
  });

  it('maps FT, AET and AP to finished and leaves their minute empty', () => {
    const matches = parseLiveScore(fixture('livescore-date-20261108-offset0.json'), 0);
    for (const id of ['livescore:1907731', 'livescore:1907737', 'livescore:1907745']) {
      expect(matches.find((match) => match.id === id)).toMatchObject({
        state: 'finished',
        minute: null,
      });
    }
    expect(matches.find((match) => match.id === 'livescore:1907731')?.score).toEqual({
      home: 3,
      away: 3,
    });
    expect(matches.find((match) => match.id === 'livescore:1907737')?.score).toEqual({
      home: 2,
      away: 3,
    });
    for (const entry of LIVESCORE_FIXTURES.filter((item) => item.file.includes('-date-'))) {
      const parsed = parseLiveScore(fixture(entry.file), entry.offset);
      expect(states(parsed)).toEqual(['finished']);
      expect(parsed.every((match) => match.minute === null)).toBe(true);
    }
  });

  it('maps NS to scheduled without inventing a score', () => {
    const live = parseLiveScore(fixture('livescore-live-offset9.json'), 9);
    expect(live.find((match) => match.id === 'livescore:1913914')).toMatchObject({
      state: 'scheduled',
      minute: null,
      score: { home: null, away: null },
    });
  });

  it('keeps every minute label in the live fixture and maps it to live', () => {
    const live = parseLiveScore(fixture('livescore-live-offset9.json'), 9);
    const running = live.filter((match) => match.state === 'live');
    expect(running).toHaveLength(14);
    expect(new Set(running.map((match) => match.minute))).toEqual(
      new Set(["1'", "2'", "3'", "46'"]),
    );
    expect(live.find((match) => match.id === 'livescore:1738278')).toMatchObject({
      state: 'live',
      minute: "46'",
      score: { home: 0, away: 0 },
    });
  });

  it('accepts the minute forms the shape promises: added time and half-time', () => {
    for (const label of ["67'", "45+2'", "90'+6'", 'HT']) {
      const [match] = parseLiveScore(liveScoreJson([liveScoreEvent({ Eps: label })]), 0);
      expect(match).toMatchObject({ state: 'live', minute: label });
    }
  });

  it('turns a status it does not know into unknown, without a minute or a score', () => {
    const [match] = parseLiveScore(
      liveScoreJson([liveScoreEvent({ Eps: 'PST', Tr1: '1', Tr2: '0' })]),
      0,
    );
    expect(match).toMatchObject({
      state: 'unknown',
      minute: null,
      score: { home: null, away: null },
    });
  });
});

describe('ESPN fixtures', () => {
  it('parses espn-eng1-20261108.json with the Premier League mapping', () => {
    const matches = parseEspnScoreboard(fixture('espn-eng1-20261108.json'));
    expect(matches).toHaveLength(5);
    expect(leagueCounts(matches)).toEqual({ l_4WFCIZ: 5 });
    expect(new Set(matches.map((match) => match.competition))).toEqual(
      new Set(['English Premier League']),
    );
    expect(states(matches)).toEqual(['finished']);
    expect(matches.every((match) => match.minute === null)).toBe(true);
    expect(matches.find((match) => match.id === 'espn:401879244')).toEqual({
      id: 'espn:401879244',
      source: 'espn',
      leagueId: 'l_4WFCIZ',
      competition: 'English Premier League',
      home: { name: 'Brighton & Hove Albion', clubKey: 'brighton' },
      away: { name: 'Brentford', clubKey: 'brentford' },
      kickoffUtc: '2026-11-08T14:00:00.000Z',
      state: 'finished',
      minute: null,
      score: { home: 2, away: 0 },
    });
  });

  it('parses every event of espn-all-now.json without inventing a league', () => {
    const matches = parseEspnScoreboard(fixture('espn-all-now.json'));
    expect(matches).toHaveLength(7);
    expect(leagueCounts(matches)).toEqual({});
    expect(new Set(matches.map((match) => match.competition))).toEqual(new Set(['']));
    expect(new Set(matches.map((match) => match.leagueId))).toEqual(new Set([null]));
    expect(new Set(matches.map((match) => match.source))).toEqual(new Set(['espn']));
  });

  it('maps live, scheduled and finished events in espn-all-now.json', () => {
    const matches = parseEspnScoreboard(fixture('espn-all-now.json'));
    expect(matches.find((match) => match.id === 'espn:401861163')).toMatchObject({
      state: 'live',
      minute: 'HT',
      score: { home: 0, away: 0 },
    });
    expect(matches.find((match) => match.id === 'espn:401902865')).toMatchObject({
      state: 'live',
      minute: "71'",
      score: { home: 1, away: 0 },
    });
    expect(matches.find((match) => match.id === 'espn:401902861')).toMatchObject({
      state: 'live',
      minute: "2'",
      score: { home: 0, away: 0 },
    });
    expect(matches.find((match) => match.id === 'espn:401933734')).toMatchObject({
      state: 'scheduled',
      minute: null,
      score: { home: null, away: null },
    });
    expect(matches.find((match) => match.id === 'espn:401933864')).toMatchObject({
      state: 'finished',
      minute: null,
      score: { home: 4, away: 0 },
    });
    expect(
      new Set(matches.filter((match) => match.state === 'live').map((match) => match.minute)),
    ).toEqual(new Set(['HT', "71'", "2'"]));
  });
});

describe('league mapping', () => {
  it('maps every ESPN league slug the task lists', () => {
    const expected: Array<[string, string]> = [
      ['eng.1', 'l_4WFCIZ'],
      ['esp.1', 'l_0ErfuF'],
      ['ita.1', 'l_0ALvwF'],
      ['ger.1', 'l_1Isor4'],
      ['fra.1', 'l_3FJFUl'],
      ['usa.1', 'l_0eg6C9'],
      ['uefa.champions', 'l_0bfbkO'],
      ['uefa.europa', 'l_38d9HA'],
      ['uefa.europa.conf', 'l_2WZ2tt'],
      ['fifa.world', 'l_1XLtP0'],
    ];
    for (const [slug, leagueId] of expected) {
      const [match] = parseEspnScoreboard({
        leagues: [{ slug, name: `League ${slug}` }],
        events: [espnEvent()],
      });
      expect(match).toMatchObject({ leagueId, competition: `League ${slug}` });
    }
    const [other] = parseEspnScoreboard({
      leagues: [{ slug: 'eng.2', name: 'English Championship' }],
      events: [espnEvent()],
    });
    expect(other?.leagueId).toBeNull();
  });

  it('maps the nine LiveScore competitions the responses contain', () => {
    const domestic = parseLiveScore(fixture('livescore-date-20261108-offset0.json'), 0);
    for (const [competition, leagueId] of [
      ['Premier League', 'l_4WFCIZ'],
      ['LaLiga', 'l_0ErfuF'],
      ['Bundesliga', 'l_1Isor4'],
      ['Serie A', 'l_0ALvwF'],
      ['Ligue 1', 'l_3FJFUl'],
      ['MLS', 'l_0eg6C9'],
    ]) {
      expect(domestic.find((match) => match.competition === competition)?.leagueId).toBe(leagueId);
    }

    const uefa = parseLiveScore(fixture('livescore-date-20261105-uefa-offset9.json'), 9);
    expect(uefa.find((match) => match.competition === 'Champions League')?.leagueId).toBe(
      'l_0bfbkO',
    );
    expect(uefa.find((match) => match.competition === 'Europa League')?.leagueId).toBe('l_38d9HA');

    const conference = parseLiveScore(fixture('livescore-date-20261106-uefa-offset9.json'), 9);
    expect(conference.find((match) => match.competition === 'Conference League')?.leagueId).toBe(
      'l_2WZ2tt',
    );
  });

  it('maps LiveScore by country and competition, including the unverified World Cup name', () => {
    const [worldCup] = parseLiveScore(
      liveScoreJson([liveScoreEvent()], { CompN: 'World Cup', CompD: 'World', Cnm: 'World' }),
      0,
    );
    expect(worldCup?.leagueId).toBe('l_1XLtP0');

    const [wrongCountry] = parseLiveScore(
      liveScoreJson([liveScoreEvent()], { CompN: 'Premier League', CompD: 'Scotland' }),
      0,
    );
    expect(wrongCountry?.leagueId).toBeNull();
  });
});

describe('clubKey', () => {
  it('gives LiveScore and ESPN the same key for the same club', () => {
    const liveScore = parseLiveScore(fixture('livescore-date-20261108-offset0.json'), 0).find(
      (match) => match.id === 'livescore:1793599',
    );
    const espn = parseEspnScoreboard(fixture('espn-eng1-20261108.json')).find(
      (match) => match.id === 'espn:401879244',
    );
    expect(liveScore?.home.clubKey).toBe('brighton');
    expect(espn?.home.clubKey).toBe(liveScore?.home.clubKey);
    expect(espn?.away.clubKey).toBe(liveScore?.away.clubKey);
  });
});

describe('null handling', () => {
  it('keeps unknown kickoff, minute and score values null', () => {
    const [liveScore] = parseLiveScore(
      liveScoreJson([liveScoreEvent({ Eps: '', Esd: undefined })]),
      0,
    );
    expect(liveScore).toMatchObject({
      kickoffUtc: null,
      state: 'unknown',
      minute: null,
      score: { home: null, away: null },
    });

    const [espn] = parseEspnScoreboard({
      leagues: ESPN_LEAGUE,
      events: [
        espnEvent({
          date: '2026-11-08T14:00',
          status: espnStatus('STATUS_SCHEDULED', 'pre', 'Scheduled', "0'"),
          homeScore: '0',
          awayScore: '0',
        }),
      ],
    });
    expect(espn).toMatchObject({
      kickoffUtc: null,
      state: 'scheduled',
      minute: null,
      score: { home: null, away: null },
    });
  });

  it('reads numeric scores as well as numeric strings', () => {
    const [stringScore] = parseLiveScore(
      liveScoreJson([liveScoreEvent({ Eps: 'FT', Tr1: '3', Tr2: '1' })]),
      0,
    );
    const [numberScore] = parseLiveScore(
      liveScoreJson([liveScoreEvent({ Eps: 'FT', Tr1: 3, Tr2: 1 })]),
      0,
    );
    expect(stringScore?.score).toEqual({ home: 3, away: 1 });
    expect(numberScore?.score).toEqual({ home: 3, away: 1 });
  });
});

describe('malformed input', () => {
  it('never throws and skips LiveScore events it cannot read', () => {
    for (const value of [null, undefined, 0, 'x', [], {}, { Stages: 'x' }, { Stages: [null] }]) {
      expect(() => parseLiveScore(value, 0)).not.toThrow();
      expect(parseLiveScore(value, 0)).toEqual([]);
    }

    const matches = parseLiveScore(
      {
        Stages: [
          null,
          { CompN: 'Premier League', Cnm: 'England', Events: 'x' },
          {
            CompN: 'Premier League',
            Cnm: 'England',
            Events: [
              null,
              {},
              { Eid: 'no-teams' },
              { Eid: 'one-team', T1: [{ Nm: 'Alpha' }] },
              { T1: [{ Nm: 'Alpha' }], T2: [{ Nm: 'Beta' }] },
              liveScoreEvent({ Eid: 'ok' }),
            ],
          },
        ],
      },
      0,
    );
    expect(matches.map((match) => match.id)).toEqual(['livescore:ok']);
  });

  it('rejects impossible LiveScore dates and a non-finite offset without dropping the event', () => {
    const [badMonth] = parseLiveScore(liveScoreJson([liveScoreEvent({ Esd: 20261308140000 })]), 0);
    expect(badMonth?.kickoffUtc).toBeNull();
    expect(badMonth?.id).toBe('livescore:1');

    const [badOffset] = parseLiveScore(liveScoreJson([liveScoreEvent()]), Number.NaN);
    expect(badOffset?.kickoffUtc).toBeNull();
    expect(badOffset?.id).toBe('livescore:1');
  });

  it('never throws and skips ESPN events it cannot read', () => {
    for (const value of [null, undefined, 0, 'x', [], {}, { events: 'x' }, { events: [null] }]) {
      expect(() => parseEspnScoreboard(value)).not.toThrow();
      expect(parseEspnScoreboard(value)).toEqual([]);
    }

    const matches = parseEspnScoreboard({
      leagues: ESPN_LEAGUE,
      events: [
        null,
        {},
        { id: 'no-competition' },
        { id: 'no-teams', competitions: [{ competitors: [] }] },
        espnEvent({ id: 'ok' }),
      ],
    });
    expect(matches.map((match) => match.id)).toEqual(['espn:ok']);
  });

  it('keeps an ESPN event readable when only its status is unusual', () => {
    const [match] = parseEspnScoreboard({
      leagues: ESPN_LEAGUE,
      events: [espnEvent({ status: espnStatus('STATUS_DELAYED', 'pre') })],
    });
    expect(match).toMatchObject({
      id: 'espn:1',
      state: 'unknown',
      minute: null,
      score: { home: null, away: null },
    });
  });

  it('maps the postponed and cancelled status names literally', () => {
    const [postponed] = parseEspnScoreboard({
      leagues: ESPN_LEAGUE,
      events: [espnEvent({ status: espnStatus('STATUS_POSTPONED', 'post') })],
    });
    const [cancelled] = parseEspnScoreboard({
      leagues: ESPN_LEAGUE,
      events: [espnEvent({ status: espnStatus('STATUS_CANCELED', 'post') })],
    });
    expect(postponed).toMatchObject({
      state: 'postponed',
      minute: null,
      score: { home: null, away: null },
    });
    expect(cancelled).toMatchObject({
      state: 'cancelled',
      minute: null,
      score: { home: null, away: null },
    });
  });

  it('accepts ESPN minute forms and treats a missing clock as null', () => {
    for (const clock of ["67'", "45+2'", "90'+6'", 'HT']) {
      const [match] = parseEspnScoreboard({
        leagues: ESPN_LEAGUE,
        events: [
          espnEvent({
            status: espnStatus(
              clock === 'HT' ? 'STATUS_HALFTIME' : 'STATUS_FIRST_HALF',
              'in',
              clock,
              clock,
            ),
          }),
        ],
      });
      expect(match).toMatchObject({ state: 'live', minute: clock });
    }

    const [noClock] = parseEspnScoreboard({
      leagues: ESPN_LEAGUE,
      events: [
        espnEvent({
          status: { displayClock: '?', type: { name: 'STATUS_FIRST_HALF', state: 'in' } },
        }),
      ],
    });
    expect(noClock).toMatchObject({ state: 'live', minute: null });
  });
});

function matchAt(id: string, kickoffUtc: string | null): LiveMatch {
  return {
    id,
    source: 'espn',
    leagueId: null,
    competition: '',
    home: { name: 'Alpha', clubKey: 'alpha' },
    away: { name: 'Beta', clubKey: 'beta' },
    kickoffUtc,
    state: 'scheduled',
    minute: null,
    score: { home: null, away: null },
  };
}

describe('onLocalDay', () => {
  it('keeps the edges of the local day in Asia/Yakutsk (UTC+9)', () => {
    const matches = [
      matchAt('before', '2026-11-07T14:59:59.999Z'),
      matchAt('start', '2026-11-07T15:00:00.000Z'),
      matchAt('end', '2026-11-08T14:59:59.999Z'),
      matchAt('after', '2026-11-08T15:00:00.000Z'),
      matchAt('unknown', null),
    ];
    expect(onLocalDay(matches, '2026-11-08', 'Asia/Yakutsk').map((match) => match.id)).toEqual([
      'start',
      'end',
    ]);
  });

  it('keeps the edges of the UTC day', () => {
    const matches = [
      matchAt('before', '2026-11-07T23:59:59.999Z'),
      matchAt('start', '2026-11-08T00:00:00.000Z'),
      matchAt('end', '2026-11-08T23:59:59.999Z'),
      matchAt('after', '2026-11-09T00:00:00.000Z'),
      matchAt('unknown', null),
    ];
    expect(onLocalDay(matches, '2026-11-08', 'UTC').map((match) => match.id)).toEqual([
      'start',
      'end',
    ]);
  });

  it('uses the converted LiveScore kickoffs to pick the local day', () => {
    // The /9 response is a UTC+9 local day: all 49 matches fall on 8 November in Yakutsk,
    // but only 19 of them fall on 8 November in UTC. The /0 response behaves the other way.
    const offset9 = parseLiveScore(fixture('livescore-date-20261108-offset9.json'), 9);
    expect(onLocalDay(offset9, '2026-11-08', 'Asia/Yakutsk')).toHaveLength(49);
    expect(onLocalDay(offset9, '2026-11-08', 'UTC')).toHaveLength(19);

    const offset0 = parseLiveScore(fixture('livescore-date-20261108-offset0.json'), 0);
    expect(onLocalDay(offset0, '2026-11-08', 'UTC')).toHaveLength(40);
    expect(onLocalDay(offset0, '2026-11-08', 'Asia/Yakutsk')).toHaveLength(21);
  });

  it('returns an empty list for an impossible date or an unknown time zone', () => {
    const matches = [matchAt('one', '2026-11-08T14:00:00.000Z')];
    expect(onLocalDay(matches, '2026-02-30', 'UTC')).toEqual([]);
    expect(onLocalDay(matches, '2026-11-08', 'Mars/Olympus')).toEqual([]);
  });

  it('keeps the input order', () => {
    const matches = [
      matchAt('second', '2026-11-08T20:00:00.000Z'),
      matchAt('first', '2026-11-08T01:00:00.000Z'),
    ];
    expect(onLocalDay(matches, '2026-11-08', 'UTC').map((match) => match.id)).toEqual([
      'second',
      'first',
    ]);
  });
});
