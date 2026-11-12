import type { Page } from '@playwright/test';

// Подробности матча поверх базовых ответов uiFixture: оценки, события, удары с xG и давление
// для завершённого матча и сам матч, который ещё не начался. Нужны проверкам текстов и снимкам.

export const home = { id: 'arsenal', name: 'Arsenal' };
export const away = { id: 'chelsea', name: 'Chelsea' };
export const finished = { id: 'test-match' };
export const upcoming = {
  id: 'next-match',
  status: 'scheduled',
  home_team: home,
  away_team: away,
  time_utc: '2026-10-23T18:00:00Z',
  date: '2026-10-23',
  score_home: null,
  score_away: null,
};

const stat = (key: string, type: string, value: number, total?: number) => ({
  key,
  stat: { type, value, ...(total === undefined ? {} : { total }) },
});
const playerEntry = (
  id: string,
  name: string,
  team: string,
  rating: number,
  minutes: number,
  goals: number,
) => ({
  team_id: team,
  player: { id, name },
  stats: [
    {
      key: 'top_stats',
      title: 'Top stats',
      stats: {
        Rating: stat('rating_title', 'double', rating),
        'Minutes played': stat('minutes_played', 'integer', minutes),
        Goals: stat('goals', 'integer', goals),
        Assists: stat('assists', 'integer', 0),
        'Total shots': stat('total_shots', 'integer', 3),
        'Accurate passes': stat('accurate_passes', 'fractionWithPercentage', 31, 38),
      },
    },
    {
      key: 'defending',
      title: 'Defending',
      stats: {
        Tackles: stat('tackles', 'integer', 2),
        'Duels won': stat('duels_won', 'integer', 5),
      },
    },
  ],
});
const shot = (id: string, minute: number, team: string, extra: Record<string, unknown> = {}) => ({
  id,
  team_id: team,
  player: { name: team === home.id ? 'Alex Morgan' : 'Jamie Wilson' },
  minute,
  x: 91,
  y: 30,
  expected_goals: 0.18,
  event_type: 'AttemptSaved',
  ...extra,
});
/** Подробности завершённого матча: оценки, события, удары с xG и давление. */
const finishedDetails: Record<string, unknown> = {
  'matches/test-match/players': [
    playerEntry('a', 'Alex Morgan', home.id, 7.8, 90, 1),
    playerEntry('b', 'Sam Taylor', home.id, 6.4, 25, 0),
    playerEntry('c', 'Jamie Wilson', away.id, 6.9, 90, 1),
  ],
  'matches/test-match/events': {
    events: [
      {
        event_type: 'goal',
        minute: 11,
        team_id: home.id,
        player: { name: 'Alex Morgan' },
        score_home: 1,
        score_away: 0,
      },
      { event_type: 'yellowcard', minute: 38, team_id: away.id, player: { name: 'Jamie Wilson' } },
      {
        event_type: 'goal',
        minute: 54,
        team_id: away.id,
        player: { name: 'Jamie Wilson' },
        score_home: 1,
        score_away: 1,
      },
    ],
  },
  'matches/test-match/shots': {
    match_id: finished.id,
    periods: [
      {
        period: 'FirstHalf',
        shots: [
          shot('a', 11, home.id, { event_type: 'Goal', expected_goals: 0.46, x: 98, y: 32 }),
          shot('b', 23, away.id, { x: 78, y: 43, expected_goals: 0.04 }),
        ],
      },
      {
        period: 'SecondHalf',
        shots: [
          shot('d', 54, away.id, { x: 96, y: 28, expected_goals: 0.52, event_type: 'Goal' }),
          shot('e', 67, home.id, { x: null, y: null, expected_goals: null, event_type: 'Miss' }),
        ],
      },
    ],
  },
  'matches/test-match/momentum': {
    points: Array.from({ length: 91 }, (_, minute) => ({
      minute,
      value: Math.round(Math.sin(minute * 0.18) * 54),
    })),
  },
};

/** Какие подробности матча сейчас отдаёт тестовый сервер; включаются по ходу проверки. */
export const enabled = { finished: false, upcoming: false };

/** Подробности матча поверх базовых тестовых ответов: позднее добавленный маршрут срабатывает первым. */
export async function addMatchDetails(page: Page) {
  await page.route(
    (url) => url.pathname === '/bridge/api',
    async (route) => {
      const url = new URL(route.request().url());
      const path = url.searchParams.get('path') ?? '';
      if (url.searchParams.get('source') !== 'pitch') return route.fallback();
      let data: unknown;
      if (enabled.finished && path in finishedDetails) data = finishedDetails[path];
      else if (enabled.upcoming && path === `matches/${upcoming.id}`) data = upcoming;
      else return route.fallback();
      return route.fulfill({
        json: {
          payload: { data },
          source: 'pitch',
          stale: false,
          fetchedAt: '2026-10-22T00:00:00Z',
        },
      });
    },
  );
}
