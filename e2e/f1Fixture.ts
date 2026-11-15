import type { Page } from '@playwright/test';
import { setupVisualFixture } from './uiFixture';

/**
 * Formula 1 data for the U4.6 screen checks.
 *
 * The base UI fixture only has a short calendar and no results or standings.
 * These answers add a next weekend, a finished race, the top of both
 * standings, favourites and one analysed OpenF1 session without changing the
 * shared fixture or reference screenshots of other screens.
 */

const TEAMS: Record<string, { name: string; nationality: string }> = {
  red_bull: { name: 'Red Bull', nationality: 'Austrian' },
  ferrari: { name: 'Ferrari', nationality: 'Italian' },
  mclaren: { name: 'McLaren', nationality: 'British' },
  mercedes: { name: 'Mercedes', nationality: 'German' },
  williams: { name: 'Williams', nationality: 'British' },
  aston_martin: { name: 'Aston Martin', nationality: 'British' },
  alpine: { name: 'Alpine', nationality: 'French' },
  haas: { name: 'Haas', nationality: 'American' },
  rb: { name: 'Racing Bulls', nationality: 'Italian' },
  sauber: { name: 'Sauber', nationality: 'Swiss' },
};

const DRIVERS = [
  ['max_verstappen', 'Max', 'Verstappen', 'VER', 'red_bull', 320, 7],
  ['norris', 'Lando', 'Norris', 'NOR', 'mclaren', 300, 6],
  ['leclerc', 'Charles', 'Leclerc', 'LEC', 'ferrari', 275, 5],
  ['piastri', 'Oscar', 'Piastri', 'PIA', 'mclaren', 250, 4],
  ['russell', 'George', 'Russell', 'RUS', 'mercedes', 230, 3],
  ['hamilton', 'Lewis', 'Hamilton', 'HAM', 'ferrari', 205, 2],
  ['antonelli', 'Andrea Kimi', 'Antonelli', 'ANT', 'mercedes', 120, 0],
  ['alonso', 'Fernando', 'Alonso', 'ALO', 'aston_martin', 90, 0],
  ['sainz', 'Carlos', 'Sainz', 'SAI', 'williams', 60, 0],
  ['albon', 'Alexander', 'Albon', 'ALB', 'williams', 45, 0],
] as const;

const team = (id: string) => ({ constructorId: id, name: TEAMS[id]!.name });
const driver = (row: (typeof DRIVERS)[number]) => ({
  driverId: row[0],
  permanentNumber: '1',
  code: row[3],
  givenName: row[1],
  familyName: row[2],
  nationality: 'Dutch',
  dateOfBirth: '1997-09-30',
});

const circuit = (round: number, country: string, locality: string) => ({
  circuitId: `circuit-${round}`,
  circuitName: `Circuit ${round}`,
  Location: { locality, country },
});

export const F1_RACES = [
  {
    season: '2026',
    round: '1',
    raceName: 'Australian Grand Prix',
    date: '2026-03-08',
    time: '05:00:00Z',
    Circuit: circuit(1, 'Australia', 'Melbourne'),
    FirstPractice: { date: '2026-03-06', time: '01:30:00Z' },
    SecondPractice: { date: '2026-03-06', time: '05:00:00Z' },
    ThirdPractice: { date: '2026-03-07', time: '01:30:00Z' },
    Qualifying: { date: '2026-03-07', time: '05:00:00Z' },
  },
  {
    season: '2026',
    round: '2',
    raceName: 'Chinese Grand Prix',
    date: '2026-04-19',
    time: '07:00:00Z',
    Circuit: circuit(2, 'China', 'Shanghai'),
    FirstPractice: { date: '2026-04-17', time: '03:30:00Z' },
    SecondPractice: { date: '2026-04-17', time: '07:00:00Z' },
    ThirdPractice: { date: '2026-04-18', time: '03:30:00Z' },
    Qualifying: { date: '2026-04-18', time: '07:00:00Z' },
  },
  {
    season: '2026',
    round: '3',
    raceName: 'Japanese Grand Prix',
    date: '2026-10-05',
    time: '05:00:00Z',
    Circuit: circuit(3, 'Japan', 'Suzuka'),
    FirstPractice: { date: '2026-10-03', time: '02:30:00Z' },
    SecondPractice: { date: '2026-10-03', time: '06:00:00Z' },
    ThirdPractice: { date: '2026-10-04', time: '02:30:00Z' },
    Qualifying: { date: '2026-10-04', time: '06:00:00Z' },
  },
  {
    season: '2026',
    round: '4',
    raceName: 'Las Vegas Grand Prix',
    date: '2026-11-22',
    time: '06:00:00Z',
    Circuit: circuit(4, 'United States', 'Las Vegas'),
    FirstPractice: { date: '2026-11-20', time: '02:30:00Z' },
    SecondPractice: { date: '2026-11-20', time: '06:00:00Z' },
    ThirdPractice: { date: '2026-11-21', time: '02:30:00Z' },
    Qualifying: { date: '2026-11-21', time: '06:00:00Z' },
  },
  {
    season: '2026',
    round: '5',
    raceName: 'Qatar Grand Prix',
    date: '2026-11-29',
    time: '16:00:00Z',
    Circuit: circuit(5, 'Qatar', 'Lusail'),
    FirstPractice: { date: '2026-11-27', time: '13:30:00Z' },
    Qualifying: { date: '2026-11-28', time: '14:00:00Z' },
  },
];

function resultRows() {
  return DRIVERS.map((row, index) => ({
    number: String(index + 1),
    position: String(index + 1),
    positionText: String(index + 1),
    points: String(Math.max(0, 26 - (index + 1) * 2)),
    Driver: driver(row),
    Constructor: team(row[4]),
    grid: String(index + 1),
    laps: '53',
    status: 'Finished',
    ...(index === 0 ? {} : { Time: { time: `+${(index * 3.2).toFixed(1)}s` } }),
    ...(index === 1 ? { FastestLap: { rank: '1', lap: '48', Time: { time: '1:31.245' } } } : {}),
  }));
}

function resultsRace(round: number, name: string, date: string, country: string) {
  return {
    season: '2026',
    round: String(round),
    raceName: name,
    date,
    time: '05:00:00Z',
    Circuit: circuit(round, country, 'City'),
    Results: resultRows(),
  };
}

const RESULTS_PAGES = [
  resultsRace(1, 'Australian Grand Prix', '2026-03-08', 'Australia'),
  resultsRace(2, 'Chinese Grand Prix', '2026-04-19', 'China'),
  resultsRace(3, 'Japanese Grand Prix', '2026-10-05', 'Japan'),
];

const QUALIFYING_PAGES = [1, 2, 3].map((round) => ({
  season: '2026',
  round: String(round),
  raceName: ['Australian Grand Prix', 'Chinese Grand Prix', 'Japanese Grand Prix'][round - 1]!,
  QualifyingResults: DRIVERS.map((row, index) => ({
    number: String(index + 1),
    position: String(index + 1),
    Driver: driver(row),
    Constructor: team(row[4]),
    Q1: `1:2${index}.100`,
    Q2: `1:2${index}.200`,
    Q3: `1:2${index}.300`,
  })),
}));

const MEETING = {
  meeting_key: 1,
  meeting_name: 'Japanese Grand Prix',
  meeting_official_name: 'FORMULA 1 JAPANESE GRAND PRIX 2026',
  location: 'Suzuka',
  country_name: 'Japan',
  country_code: 'JP',
  circuit_short_name: 'Suzuka',
  date_start: '2026-10-03T00:00:00+00:00',
  date_end: '2026-10-05T12:00:00+00:00',
  year: 2026,
};

const SESSIONS = [
  ['Practice 1', 'practice', '2026-10-03T02:30:00+00:00', '2026-10-03T03:30:00+00:00', 101],
  ['Practice 2', 'practice', '2026-10-03T06:00:00+00:00', '2026-10-03T07:00:00+00:00', 102],
  ['Practice 3', 'practice', '2026-10-04T02:30:00+00:00', '2026-10-04T03:30:00+00:00', 103],
  ['Qualifying', 'qualifying', '2026-10-04T06:00:00+00:00', '2026-10-04T07:00:00+00:00', 104],
  ['Race', 'race', '2026-10-05T05:00:00+00:00', '2026-10-05T07:00:00+00:00', 105],
].map(([name, type, start, end, key]) => ({
  session_key: key,
  meeting_key: 1,
  session_name: name,
  session_type: type,
  date_start: start,
  date_end: end,
  status: 'Finalised',
  year: 2026,
  circuit_short_name: 'Suzuka',
  location: 'Suzuka',
  country_name: 'Japan',
}));

const OPENF1_DRIVERS = DRIVERS.slice(0, 4).map((row, index) => ({
  driver_number: [1, 4, 16, 81][index],
  full_name: `${row[1]} ${row[2]}`,
  first_name: row[1],
  last_name: row[2],
  name_acronym: row[3],
  team_name: TEAMS[row[4]]!.name,
  team_colour: ['3671C6', 'FF8000', 'E8002D', '27F4D2'][index],
  headshot_url: null,
  session_key: 105,
  meeting_key: 1,
}));

const LAPS = OPENF1_DRIVERS.flatMap((entry, index) =>
  Array.from({ length: 20 }, (_, lap) => ({
    driver_number: entry.driver_number,
    lap_number: lap + 1,
    lap_duration: 91.2 + index * 0.3 + (lap % 5) * 0.15,
    duration_sector_1: 30.1,
    duration_sector_2: 31.2,
    duration_sector_3: 29.9,
    st_speed: 320 + index,
    session_key: 105,
  })),
);

const STINTS = OPENF1_DRIVERS.flatMap((entry) => [
  {
    driver_number: entry.driver_number,
    stint_number: 1,
    lap_start: 1,
    lap_end: 10,
    compound: 'medium',
    session_key: 105,
  },
  {
    driver_number: entry.driver_number,
    stint_number: 2,
    lap_start: 11,
    lap_end: 20,
    compound: 'hard',
    session_key: 105,
  },
]);

const PITS = OPENF1_DRIVERS.map((entry) => ({
  driver_number: entry.driver_number,
  lap_number: 10,
  pit_duration: 21.4,
  session_key: 105,
}));

function reply(payload: unknown, source = 'jolpica') {
  return {
    json: {
      payload,
      source,
      stale: false,
      fetchedAt: '2026-10-25T00:00:00Z',
    },
  };
}

/**
 * Adds rich Formula 1 answers on top of the shared fixture and marks Max
 * Verstappen, Lando Norris, Red Bull and Ferrari as favourites.
 */
export async function setupF1Fixture(page: Page, scheme: 'dark' | 'light') {
  await setupVisualFixture(page, scheme, true);
  await page.route('**/bridge/api**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/bridge/api') return route.fallback();
    const source = url.searchParams.get('source');
    const path = url.searchParams.get('path') ?? '';
    if (source === 'jolpica') {
      if (path === '2026.json?limit=100')
        return route.fulfill(reply({ MRData: { RaceTable: { season: '2026', Races: F1_RACES } } }));
      if (path.includes('driverStandings'))
        return route.fulfill(
          reply({
            MRData: {
              StandingsTable: {
                StandingsLists: [
                  {
                    season: '2026',
                    round: '3',
                    DriverStandings: DRIVERS.map((row, index) => ({
                      position: String(index + 1),
                      positionText: String(index + 1),
                      points: String(row[5]),
                      wins: String(row[6]),
                      Driver: driver(row),
                      Constructors: [team(row[4])],
                    })),
                  },
                ],
              },
            },
          }),
        );
      if (path.includes('constructorStandings'))
        return route.fulfill(
          reply({
            MRData: {
              StandingsTable: {
                StandingsLists: [
                  {
                    season: '2026',
                    round: '3',
                    ConstructorStandings: Object.keys(TEAMS)
                      .slice(0, 6)
                      .map((id, index) => ({
                        position: String(index + 1),
                        points: String(520 - index * 70),
                        wins: String(6 - index),
                        Constructor: team(id),
                      })),
                  },
                ],
              },
            },
          }),
        );
      if (path.includes('last/results'))
        return route.fulfill(
          reply({
            MRData: { RaceTable: { season: '2026', Races: [RESULTS_PAGES[2]] } },
          }),
        );
      if (/results\.json/.test(path))
        return route.fulfill(
          reply({
            MRData: {
              total: String(resultRows().length * 3),
              limit: '100',
              offset: '0',
              RaceTable: { season: '2026', Races: RESULTS_PAGES },
            },
          }),
        );
      if (/qualifying\.json/.test(path))
        return route.fulfill(
          reply({
            MRData: {
              total: String(DRIVERS.length * 3),
              limit: '100',
              offset: '0',
              RaceTable: { season: '2026', Races: QUALIFYING_PAGES },
            },
          }),
        );
      if (/sprint\.json/.test(path))
        return route.fulfill(
          reply({
            MRData: {
              total: '0',
              limit: '100',
              offset: '0',
              RaceTable: { season: '2026', Races: [] },
            },
          }),
        );
    }
    if (source === 'openf1') {
      if (path.startsWith('meetings?')) return route.fulfill(reply([MEETING], 'openf1'));
      if (path.startsWith('sessions?')) return route.fulfill(reply(SESSIONS, 'openf1'));
      if (path.startsWith('drivers?')) return route.fulfill(reply(OPENF1_DRIVERS, 'openf1'));
      if (path.startsWith('laps?')) return route.fulfill(reply(LAPS, 'openf1'));
      if (path.startsWith('stints?')) return route.fulfill(reply(STINTS, 'openf1'));
      if (path.startsWith('pit?')) return route.fulfill(reply(PITS, 'openf1'));
    }
    return route.fallback();
  });
  await page.addInitScript(() => {
    localStorage.setItem('sportsdesk.f1.favDrivers', JSON.stringify(['max_verstappen', 'norris']));
    localStorage.setItem('sportsdesk.f1.favTeams', JSON.stringify(['red_bull', 'ferrari']));
  });
}
