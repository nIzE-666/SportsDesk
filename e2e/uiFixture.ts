import type { Page } from '@playwright/test';

const home = { id: 'arsenal', name: 'Arsenal' };
const away = { id: 'chelsea', name: 'Chelsea' };
const match = {
  id: 'test-match',
  status: 'finished',
  home_team: home,
  away_team: away,
  time_utc: '2026-10-20T18:00:00Z',
  date: '2026-10-20',
  score_home: 2,
  score_away: 1,
};
const stats = {
  periods: [
    {
      period: 'All',
      groups: [
        {
          group_name: 'Top stats',
          items: [
            {
              key: 'ballpossesion',
              title: 'Ball possession',
              home: '62',
              away: '38',
              format_type: 'integer',
            },
            { key: 'shots', title: 'Shots', home: '12', away: '8', format_type: 'integer' },
          ],
        },
      ],
    },
  ],
};
const lineups = {
  match_id: match.id,
  home_team: home,
  away_team: away,
  home: {
    formation: '4-2-3-1',
    confirmed: true,
    starters: [{ player_id: 'a', name: 'Alex Morgan', pitch_x: 0.1, pitch_y: 0.5 }],
    subs: [{ player_id: 'b', name: 'Sam Taylor' }],
  },
  away: {
    formation: '4-3-3',
    confirmed: true,
    starters: [{ player_id: 'c', name: 'Jamie Wilson', pitch_x: 0.1, pitch_y: 0.5 }],
    subs: [],
  },
};
const races = ['2026-10-01', '2026-11-01', '2026-11-08'].map((date, i) => ({
  season: '2026',
  round: String(i + 1),
  raceName: ['Australian Grand Prix', 'Chinese Grand Prix', 'Japanese Grand Prix'][i],
  date,
  time: '12:00:00Z',
  Qualifying: { date, time: '08:00:00Z' },
  Circuit: {
    circuitId: `test-${i}`,
    circuitName: `Circuit ${i + 1}`,
    Location: { country: ['Australia', 'China', 'Japan'][i], locality: 'Test City' },
  },
}));

export async function setupVisualFixture(
  page: Page,
  design: string,
  scheme: string,
  scenarioData = false,
) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge/api') {
      const source = url.searchParams.get('source');
      const path = url.searchParams.get('path') ?? '';
      let payload: unknown;
      if (source === 'pitch') {
        if (path === 'leagues')
          payload = {
            data: { leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', seasons: ['2026/2027'] }] },
          };
        else if (path.startsWith('leagues/'))
          payload = {
            data: {
              league: { id: 'l_4WFCIZ', name: 'Premier League' },
              matches: scenarioData
                ? [
                    match,
                    {
                      ...match,
                      id: 'next-match',
                      status: 'scheduled',
                      time_utc: '2026-10-23T18:00:00Z',
                      date: '2026-10-23',
                      score_home: null,
                      score_away: null,
                    },
                  ]
                : [match],
            },
          };
        else if (path === `matches/${match.id}`) payload = { data: match };
        else if (path.endsWith('/stats')) payload = { data: stats };
        else if (path.endsWith('/lineups')) payload = { data: lineups };
        else if (path.endsWith('/players')) payload = { data: [] };
        else if (path.endsWith('/events')) payload = { data: { events: [] } };
        else payload = { data: {} };
      } else if (source === 'jolpica')
        payload =
          scenarioData && path.includes('driverStandings')
            ? {
                MRData: {
                  StandingsTable: {
                    StandingsLists: [
                      {
                        season: '2026',
                        round: '1',
                        DriverStandings: [
                          {
                            position: '1',
                            points: '25',
                            wins: '1',
                            Driver: {
                              driverId: 'norris',
                              givenName: 'Lando',
                              familyName: 'Norris',
                            },
                            Constructors: [{ constructorId: 'mclaren', name: 'McLaren' }],
                          },
                        ],
                      },
                    ],
                  },
                },
              }
            : {
                MRData: {
                  total: '3',
                  RaceTable: { season: '2026', Races: path.startsWith('2026.json') ? races : [] },
                },
              };
      else if (source === 'sportscore' && scenarioData)
        payload = {
          competition: 'Premier League',
          tables: [{ rows: [{ pos: 1, team: 'Arsenal', p: 1, w: 1, d: 0, l: 0, gd: 1, pts: 3 }] }],
        };
      else payload = [];
      return route.fulfill({
        json: { payload, source: 'fixture', stale: false, fetchedAt: '2026-10-25T00:00:00Z' },
      });
    }
    if (url.pathname === '/bridge/command') {
      const body = route.request().postDataJSON();
      if (body.command === 'event_center_list')
        return route.fulfill({
          json: [
            {
              id: 'football|score|test-match',
              sport: 'football',
              kind: 'goal',
              title: 'Изменение счёта',
              body: 'Arsenal — Chelsea · 2 : 1',
              occurredAt: 1792886400000,
              read: false,
              matchId: 'test-match',
              leagueId: 'l_4WFCIZ',
            },
          ],
        });
      return route.fulfill({ json: {} });
    }
    if (url.pathname.startsWith('/bridge/')) return route.fulfill({ json: {} });
    if (url.origin !== 'http://127.0.0.1:1421')
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="13" fill="#76849a"/></svg>',
      });
    return route.continue();
  });
  await page.addInitScript(
    ({ design, scheme }) => {
      localStorage.setItem('sportsdesk.design', design);
      localStorage.setItem('sportsdesk.scheme', scheme);
      localStorage.setItem('sportsdesk.sport', 'football');
      localStorage.setItem('sportsdesk.league', 'l_4WFCIZ');
      sessionStorage.setItem(
        'sportsdesk.view.navigation.football',
        JSON.stringify({ kind: 'football', section: 'dashboard' }),
      );
      sessionStorage.setItem('sportsdesk.view.navigation.f1.tab', JSON.stringify('calendar'));
      sessionStorage.setItem('sportsdesk.view.f1.year', JSON.stringify(2026));
    },
    { design, scheme },
  );
  await page.clock.setFixedTime(
    new Date(scenarioData ? '2026-10-22T00:00:00Z' : '2026-10-25T00:00:00Z'),
  );
  return errors;
}
