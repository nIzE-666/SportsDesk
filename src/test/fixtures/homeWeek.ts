import type { MatchEvent, TeamRef } from '../../features/football/types';
import type { DateMatchSummary } from '../../features/home/weekData';

// Fixed dates and all results below are fixture data.
export const HOME_FIXTURE_TIME = '2026-11-19T14:40:00Z';
export const HOME_FIXTURE_LEAGUE = 'l_4WFCIZ';
const cup = 'l_0bfbkO';
const team = (id: string, name: string): TeamRef => ({ id, name });
const arsenal = team('arsenal', 'Арсенал');
const chelsea = team('chelsea', 'Челси');
const liverpool = team('liverpool', 'Ливерпуль');
const city = team('man-city', 'Манчестер Сити');
const newcastle = team('newcastle', 'Ньюкасл Юнайтед');
const ajax = team('ajax', 'Аякс');
const inter = team('inter', 'Интер');

function fixture(
  id: string,
  home: TeamRef,
  away: TeamRef,
  time: string,
  result?: [number, number],
  leagueId = HOME_FIXTURE_LEAGUE,
): DateMatchSummary {
  return {
    id,
    date: time.slice(0, 10),
    time_utc: time,
    status: result ? 'finished' : 'scheduled',
    round_name: leagueId === cup ? 'Round of 16' : '12',
    league: { id: leagueId, name: leagueId === cup ? 'Лига чемпионов' : 'Премьер-лига' },
    home_team: home,
    away_team: away,
    score_home: result?.[0] ?? null,
    score_away: result?.[1] ?? null,
  };
}

export const homeFixtureMatches = [
  fixture('home-finished', arsenal, chelsea, '2026-11-16T19:00:00Z', [3, 2]),
  fixture('home-draw', liverpool, city, '2026-11-17T18:00:00Z', [2, 2]),
  fixture('home-last', inter, ajax, '2026-11-18T17:00:00Z', [3, 1], cup),
  fixture('home-next', ajax, inter, '2026-11-19T14:55:00Z', undefined, cup),
  fixture('home-late', city, newcastle, '2026-11-19T14:52:00Z'),
  fixture('home-later', liverpool, arsenal, '2026-11-19T14:58:00Z'),
  fixture('home-weekend', chelsea, liverpool, '2026-11-21T18:00:00Z'),
  fixture('home-last-week', inter, ajax, '2026-11-09T18:00:00Z', [0, 0], cup),
  { ...fixture('home-live', newcastle, chelsea, '2026-11-19T13:10:00Z'), status: 'live' },
];

const fullTimeEvents: MatchEvent[] = [
  { event_type: 'goal', minute: 15, team_id: chelsea.id, score_home: 0, score_away: 1 },
  { event_type: 'goal', minute: 24, team_id: chelsea.id, score_home: 0, score_away: 2 },
  { event_type: 'goal', minute: 37, team_id: arsenal.id, score_home: 1, score_away: 2 },
  { event_type: 'goal', minute: 67, team_id: arsenal.id, score_home: 2, score_away: 2 },
  {
    event_type: 'goal',
    minute: 90,
    minute_added: 2,
    team_id: arsenal.id,
    score_home: 3,
    score_away: 2,
  },
];

const circuit = { circuitId: 'test-circuit', circuitName: 'Autódromo José Carlos Pace' };
const previousRace = {
  season: '2026',
  round: '20',
  raceName: 'São Paulo Grand Prix',
  Circuit: circuit,
  date: '2026-11-15',
  time: '17:00:00Z',
};
const nextRace = {
  season: '2026',
  round: '21',
  raceName: 'Las Vegas Grand Prix',
  Circuit: circuit,
  date: '2026-11-22',
  time: '04:00:00Z',
  Qualifying: { date: '2026-11-21', time: '04:00:00Z' },
  FirstPractice: { date: '2026-11-20', time: '00:30:00Z' },
};
const resultRow = (
  driverId: string,
  givenName: string,
  familyName: string,
  position: string,
  grid: string,
  time: string,
) => ({
  Driver: { driverId, givenName, familyName },
  Constructor: { constructorId: 'mclaren', name: 'McLaren' },
  position,
  positionText: position,
  grid,
  status: 'Finished',
  Time: { millis: time },
});

export function homeFixturePayload(source: string, path: string) {
  if (source === 'pitch') {
    if (path.startsWith('date/'))
      return {
        data: { matches: homeFixtureMatches.filter((match) => match.date === path.slice(5, 15)) },
      };
    if (path.startsWith('leagues/')) {
      const id = path.split('/')[1];
      return {
        data: {
          league: { id },
          matches: homeFixtureMatches.filter((match) => match.league?.id === id),
        },
      };
    }
    if (path === 'leagues') return { data: { leagues: [] } };
    if (path.endsWith('/events'))
      return { data: { events: path.includes('home-finished') ? fullTimeEvents : [] } };
    const match = homeFixtureMatches.find((item) => path === `matches/${item.id}`);
    return { data: match ?? {} };
  }
  if (source === 'livescore') {
    return {
      Stages: [
        {
          Snm: 'Premier League',
          CompN: 'Premier League',
          CompD: 'England',
          Cnm: 'England',
          Scd: 'premier-league',
          Ccd: 'england',
          Events: [
            {
              Eid: 'fixture-live',
              Esd: 20261119221000,
              Esid: 3,
              Eps: "85'",
              Tr1: '2',
              Tr2: '2',
              T1: [{ Nm: newcastle.name }],
              T2: [{ Nm: chelsea.name }],
            },
          ],
        },
      ],
    };
  }
  if (source === 'jolpica') {
    const last = {
      ...previousRace,
      Results: [
        resultRow('norris', 'Lando', 'Norris', '1', '4', '5600000'),
        resultRow('piastri', 'Oscar', 'Piastri', '2', '11', '5600600'),
      ],
    };
    return {
      MRData: {
        RaceTable: {
          season: '2026',
          Races: path.startsWith('2026.json')
            ? [previousRace, nextRace]
            : path.includes('2026/last/')
              ? [last]
              : [],
        },
      },
    };
  }
  return {};
}
