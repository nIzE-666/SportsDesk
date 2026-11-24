import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import {
  fetchLiveMatchSnapshot,
  isMatchPotentiallyLive,
  matchLiveFixture,
  parseEspnMatchSummary,
  parseLiveScoreIncidents,
  parseLiveScoreLineups,
  parseLiveScoreScoreboard,
  parseLiveScoreStats,
} from './liveMatchDetail';
import type { LiveMatch } from './liveSources';
import type { MatchDetail } from './types';

vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));

const DETAIL: MatchDetail = {
  id: 'm_100',
  league: { id: 'l_4WFCIZ', name: 'АПЛ' },
  home_team: { id: 't_home', name: 'Arsenal' },
  away_team: { id: 't_away', name: 'Chelsea' },
  time_utc: '2026-11-24T12:15:00.000Z',
  status: 'not_started',
  score_home: null,
  score_away: null,
};

describe('isMatchPotentiallyLive', () => {
  it('treats PitchAPI not_started matches within the kickoff window as potentially live', () => {
    const kickoff = Date.parse('2026-11-24T12:15:00.000Z');
    expect(isMatchPotentiallyLive(DETAIL, kickoff - 30 * 60_000)).toBe(false);
    expect(isMatchPotentiallyLive(DETAIL, kickoff - 10 * 60_000)).toBe(true);
    expect(isMatchPotentiallyLive(DETAIL, kickoff + 65 * 60_000)).toBe(true);
    expect(isMatchPotentiallyLive(DETAIL, kickoff + 4 * 3600_000)).toBe(false);
    expect(isMatchPotentiallyLive({ ...DETAIL, status: 'finished' }, kickoff + 65 * 60_000)).toBe(
      false,
    );
    expect(isMatchPotentiallyLive({ ...DETAIL, status: 'live' }, kickoff + 10 * 3600_000)).toBe(
      true,
    );
  });
});

describe('matchLiveFixture', () => {
  it('matches live candidates by normalized clubKey and kick-off proximity', () => {
    const candidate: LiveMatch = {
      id: 'livescore:1873661',
      source: 'livescore',
      leagueId: 'l_4WFCIZ',
      competition: 'Premier League',
      home: { name: 'Arsenal FC', clubKey: 'arsenal' },
      away: { name: 'Chelsea', clubKey: 'chelsea' },
      kickoffUtc: '2026-11-24T12:15:00.000Z',
      state: 'live',
      minute: "71'",
      score: { home: 3, away: 1 },
    };
    expect(matchLiveFixture(DETAIL, [candidate])).toEqual(candidate);
    expect(
      matchLiveFixture(DETAIL, [{ ...candidate, kickoffUtc: '2026-11-25T12:15:00.000Z' }]),
    ).toBeNull();
  });
});

describe('LiveScore detail parsers', () => {
  it('parses scoreboard, nested incidents, statistics and formation lineups from real LiveScore shapes', () => {
    const sb = parseLiveScoreScoreboard({
      Eid: '1873661',
      Eps: "71'",
      Tr1: '3',
      Tr2: '1',
    });
    expect(sb).toEqual({ status: 'live', minute: "71'", scoreHome: 3, scoreAway: 1 });

    const incidents = parseLiveScoreIncidents(
      {
        Incs: {
          '1': [
            { Min: 9, Nm: 2, ID: 'p1', Pn: 'K. Watanabe', IT: 43 },
            {
              Min: 45,
              MinEx: 2,
              Nm: 1,
              Sc: [1, 0],
              Incs: [
                { Min: 45, MinEx: 2, Nm: 1, ID: 'p2', Pn: 'S. Mauk', IT: 36, Sc: [1, 0] },
                { Min: 45, MinEx: 2, Nm: 1, ID: 'p3', Pn: 'Alan Grafite', IT: 63, Sc: [1, 0] },
              ],
            },
          ],
          '2': [
            { Min: 53, Nm: 2, ID: 'p4', Pn: 'Erik', IT: 37, Sc: [1, 1] },
            { Min: 68, Nm: 1, ID: 'p5', Pn: 'B. Perea', IT: 45 },
          ],
        },
      },
      DETAIL,
    );
    expect(incidents?.events).toHaveLength(4);
    expect(incidents?.events[0]).toMatchObject({
      event_type: 'yellowcard',
      minute: 9,
      team_id: 't_away',
    });
    expect(incidents?.events[1]).toMatchObject({
      event_type: 'goal',
      minute: 45,
      minute_added: 2,
      team_id: 't_home',
      score_home: 1,
      score_away: 0,
    });
    expect(incidents?.events[2]).toMatchObject({
      event_type: 'goal',
      is_penalty: true,
      team_id: 't_away',
    });
    expect(incidents?.events[3]).toMatchObject({ event_type: 'redcard', team_id: 't_home' });

    const stats = parseLiveScoreStats(
      {
        Stat: [
          {
            Tnb: 1,
            Pss: 54,
            Shon: 5,
            Shof: 6,
            Shbl: 5,
            Cos: 1,
            Fls: 7,
            Gks: 1,
            Ofs: 3,
            Ycs: 1,
            Rcs: 0,
          },
          {
            Tnb: 2,
            Pss: 46,
            Shon: 2,
            Shof: 2,
            Shbl: 3,
            Cos: 2,
            Fls: 7,
            Gks: 2,
            Ofs: 3,
            Ycs: 2,
            Rcs: 0,
          },
        ],
      },
      DETAIL,
    );
    const items = stats?.periods[0]?.groups.flatMap((g) => g.items) ?? [];
    expect(items.find((i) => i.key === 'ball_possession')).toMatchObject({
      home: '54%',
      away: '46%',
    });
    expect(items.find((i) => i.key === 'total_shots')).toMatchObject({ home: '16', away: '7' });

    const lineups = parseLiveScoreLineups(
      {
        Lu: [
          {
            Tnb: 1,
            Fo: [4, 3, 3],
            Ps: [
              { Pid: 'gk1', Fn: 'David', Ln: 'Raya', Pos: 1, Snu: 22, Fp: '1:1' },
              { Pid: 'df1', Fn: 'William', Ln: 'Saliba', Pos: 2, Snu: 2, Fp: '2:2' },
              { Pid: 'sub1', Fn: 'Neto', Pos: 5, Snu: 32 },
              { Pid: 'c1', Fn: 'Mikel', Ln: 'Arteta', Pos: 10, Pon: 'COACH' },
            ],
          },
          {
            Tnb: 2,
            Fo: [4, 2, 3, 1],
            Ps: [{ Pid: 'gk2', Fn: 'Robert', Ln: 'Sanchez', Pos: 1, Snu: 1, Fp: '1:1' }],
          },
        ],
      },
      DETAIL,
    );
    expect(lineups?.home.formation).toBe('4-3-3');
    expect(lineups?.home.coach?.name).toBe('Mikel Arteta');
    expect(lineups?.home.starters[0]?.pitch_x).toBe(0.05);
    expect(lineups?.home.subs).toHaveLength(1);
    expect(lineups?.away.formation).toBe('4-2-3-1');
  });
});

describe('ESPN summary parser & snapshot fetcher', () => {
  it('parses ESPN summary keyEvents, boxscore, rosters and commentary', () => {
    const snap = parseEspnMatchSummary(
      {
        header: {
          competitions: [
            {
              status: { displayClock: "62'", type: { state: 'in', name: 'STATUS_SECOND_HALF' } },
              competitors: [
                { homeAway: 'home', score: '2' },
                { homeAway: 'away', score: '1' },
              ],
            },
          ],
        },
        keyEvents: [
          {
            clock: { displayValue: "16'" },
            type: { type: 'goal', text: 'Goal' },
            scoringPlay: true,
            team: { displayName: 'Arsenal' },
            participants: [{ athlete: { id: '7', displayName: 'Bukayo Saka' } }],
          },
          {
            clock: { displayValue: "45'+2'" },
            type: { type: 'yellow-card', text: 'Yellow Card' },
            scoringPlay: false,
            team: { displayName: 'Chelsea' },
            participants: [{ athlete: { id: '8', displayName: 'Enzo Fernandez' } }],
          },
        ],
        boxscore: {
          teams: [
            {
              team: { displayName: 'Arsenal' },
              statistics: [
                { name: 'possessionPct', displayValue: '58.5' },
                { name: 'totalShots', displayValue: '15' },
                { name: 'shotsOnTarget', displayValue: '6' },
              ],
            },
            {
              team: { displayName: 'Chelsea' },
              statistics: [
                { name: 'possessionPct', displayValue: '41.5' },
                { name: 'totalShots', displayValue: '8' },
                { name: 'shotsOnTarget', displayValue: '3' },
              ],
            },
          ],
        },
        rosters: [
          {
            homeAway: 'home',
            formation: '4-3-3',
            team: { displayName: 'Arsenal' },
            roster: [
              { starter: true, jersey: '7', athlete: { id: '7', displayName: 'Bukayo Saka' } },
              {
                starter: false,
                jersey: '19',
                athlete: { id: '19', displayName: 'Leandro Trossard' },
              },
            ],
          },
          {
            homeAway: 'away',
            formation: '4-2-3-1',
            team: { displayName: 'Chelsea' },
            roster: [
              { starter: true, jersey: '20', athlete: { id: '20', displayName: 'Cole Palmer' } },
            ],
          },
        ],
        commentary: [{ time: { displayValue: "61'" }, text: 'Corner kick won by Arsenal.' }],
      },
      DETAIL,
      '2026-11-24T13:17:00.000Z',
      false,
    );

    expect(snap).not.toBeNull();
    expect(snap).toMatchObject({
      source: 'espn',
      status: 'live',
      minute: "62'",
      scoreHome: 2,
      scoreAway: 1,
    });
    expect(snap?.events?.events).toHaveLength(2);
    expect(snap?.events?.events[1]).toMatchObject({
      event_type: 'yellowcard',
      minute: 45,
      minute_added: 2,
      team_id: 't_away',
    });
    expect(snap?.stats?.periods[0]?.groups[0]?.items[0]).toMatchObject({
      key: 'ball_possession',
      home: '58.5%',
      away: '41.5%',
    });
    expect(snap?.lineups?.home.formation).toBe('4-3-3');
    expect(snap?.commentary).toEqual([{ minute: "61'", text: 'Corner kick won by Arsenal.' }]);
  });

  it('fetches LiveScore detail endpoints in parallel', async () => {
    vi.mocked(api).mockImplementation(async (_source, path) => {
      if (path.startsWith('scoreboard/')) {
        return {
          payload: { Eps: "55'", Tr1: '1', Tr2: '0' },
          source: 'livescore',
          fetchedAt: '2026-11-24T13:10:00.000Z',
          stale: false,
        };
      }
      if (path.startsWith('incidents/')) {
        return {
          payload: { Incs: { '1': [{ Min: 12, Nm: 1, Pn: 'Saka', IT: 36, Sc: [1, 0] }] } },
          source: 'livescore',
          fetchedAt: '2026-11-24T13:10:00.000Z',
          stale: false,
        };
      }
      return {
        payload: {},
        source: 'livescore',
        fetchedAt: '2026-11-24T13:10:00.000Z',
        stale: false,
      };
    });

    const snap = await fetchLiveMatchSnapshot(DETAIL, {
      source: 'livescore',
      eventId: '1873661',
      leagueSlug: 'eng.1',
      liveMatch: {
        id: 'livescore:1873661',
        source: 'livescore',
        leagueId: 'l_4WFCIZ',
        competition: 'Premier League',
        home: { name: 'Arsenal', clubKey: 'arsenal' },
        away: { name: 'Chelsea', clubKey: 'chelsea' },
        kickoffUtc: '2026-11-24T12:15:00.000Z',
        state: 'live',
        minute: "55'",
        score: { home: 1, away: 0 },
      },
    });
    expect(snap).toMatchObject({
      source: 'livescore',
      status: 'live',
      minute: "55'",
      scoreHome: 1,
      scoreAway: 0,
    });
    expect(snap?.events?.events).toHaveLength(1);
  });
});
