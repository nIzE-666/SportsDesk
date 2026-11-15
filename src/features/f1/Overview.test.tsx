// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { Overview } from './Overview';

vi.mock('../../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/bridge')>()),
  api: vi.fn(),
}));
vi.mock('./SeasonContext', () => ({ useSeason: () => ({ year: 2026 }) }));
const favorites = vi.hoisted(() => ({ drivers: [] as string[] }));
vi.mock('./useFavorites', () => ({
  useFavoriteDrivers: () => [favorites.drivers, vi.fn()],
  useFavoriteTeams: () => [[], vi.fn()],
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T14:59:45Z'));
  localStorage.clear();
  favorites.drivers = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (_source, path) => {
    const race = (round: number, date: string) => ({
      season: '2026',
      round: String(round),
      raceName: `Race ${round}`,
      date,
      time: '12:00:00Z',
      Circuit: { circuitId: `circuit-${round}`, circuitName: `Circuit ${round}` },
    });
    const payload =
      path === '2026.json?limit=100'
        ? { MRData: { RaceTable: { Races: [race(1, '2026-10-25'), race(2, '2026-10-26')] } } }
        : path.includes('driverStandings') || path.includes('constructorStandings')
          ? { MRData: { StandingsTable: { StandingsLists: [] } } }
          : { MRData: { RaceTable: { Races: [] } } };
    return { source: 'jolpica', payload, fetchedAt: '2026-10-25T14:00:00Z', stale: false };
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it('advances the next and latest races on the clock and focus without refetching', async () => {
  await act(async () => root.render(<Overview />));
  expect(host.querySelector('[aria-label="Расписание уикенда"]')?.textContent).toContain('Race 1');
  expect(host.textContent).toContain('Нет завершённых гонок');
  expect(host.querySelector('.f1-constructor-leader')).toBeNull();
  expect(api).toHaveBeenCalledTimes(4);

  await act(async () => vi.advanceTimersByTime(30_000));
  expect(host.querySelector('[aria-label="Расписание уикенда"]')?.textContent).toContain('Race 2');
  expect(host.textContent).toContain('Нет результатов раунда 1');
  expect(api).toHaveBeenCalledTimes(4);

  await act(async () => {
    vi.setSystemTime(new Date('2026-10-26T15:00:01Z'));
    window.dispatchEvent(new Event('focus'));
  });
  expect(host.textContent).toContain('Сезон 2026 завершён');
  expect(host.textContent).toContain('Нет результатов раунда 2');
  expect(api).toHaveBeenCalledTimes(4);
});

it('names every Grand Prix in Russian and builds one table of favourite drivers', async () => {
  favorites.drivers = ['max_verstappen'];
  const circuit = (id: string, circuitName: string) => ({ circuitId: id, circuitName });
  const driver = { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen' };
  const team = { constructorId: 'red_bull', name: 'Red Bull' };
  vi.mocked(api).mockImplementation(async (_source, path) => {
    const payload = path.includes('last/results')
      ? {
          MRData: {
            RaceTable: {
              Races: [
                {
                  season: '2026',
                  round: '19',
                  raceName: 'Brazilian Grand Prix',
                  date: '2026-10-24',
                  time: '17:00:00Z',
                  Circuit: circuit('interlagos', 'Autódromo José Carlos Pace'),
                  Results: [
                    {
                      position: '1',
                      positionText: '1',
                      points: '25',
                      Driver: driver,
                      Constructor: team,
                    },
                  ],
                },
              ],
            },
          },
        }
      : path === '2026.json?limit=100'
        ? {
            MRData: {
              RaceTable: {
                Races: [
                  {
                    season: '2026',
                    round: '22',
                    raceName: 'Las Vegas Grand Prix',
                    date: '2026-11-21',
                    time: '06:00:00Z',
                    Circuit: circuit('vegas', 'Las Vegas Strip Street Circuit'),
                  },
                ],
              },
            },
          }
        : path.includes('driverStandings')
          ? {
              MRData: {
                StandingsTable: {
                  StandingsLists: [
                    {
                      DriverStandings: [
                        {
                          position: '1',
                          points: '300',
                          wins: '8',
                          Driver: driver,
                          Constructors: [team],
                        },
                      ],
                    },
                  ],
                },
              },
            }
          : path.includes('constructorStandings')
            ? {
                MRData: {
                  StandingsTable: {
                    StandingsLists: [
                      {
                        ConstructorStandings: [
                          {
                            position: '1',
                            points: '520',
                            wins: '8',
                            Constructor: team,
                          },
                        ],
                      },
                    ],
                  },
                },
              }
            : { MRData: { StandingsTable: { StandingsLists: [] } } };
    return { source: 'jolpica', payload, fetchedAt: '2026-10-25T14:00:00Z', stale: false };
  });
  await act(async () => root.render(<Overview />));

  expect(host.textContent).toContain('Гран-при Лас-Вегаса');
  const constructors = host.querySelector('.f1-constructor-leader');
  expect(constructors?.textContent).toContain('Кубок конструкторов:');
  expect(constructors?.textContent).toContain('Red Bull');
  expect(constructors?.textContent).toContain('520 очков');
  expect(host.querySelector('[aria-label="Последняя гонка"]')?.textContent).toContain(
    'Гран-при Бразилии',
  );
  const favourites = host.querySelector('[aria-label="Избранные пилоты"]');
  expect(favourites?.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(favourites?.textContent).toContain('Max Verstappen');
  expect(favourites?.textContent).toContain('300');
  expect(favourites?.textContent).toContain('Отставание');

  const expand = favourites?.querySelector<HTMLButtonElement>(
    'button[aria-label="Показать последний результат: Max Verstappen"]',
  );
  await act(async () => expand?.click());
  expect(favourites?.querySelector('.f1-expand')?.textContent).toContain(
    'Гран-при Бразилии · Раунд 19',
  );
  expect(host.textContent).not.toContain('Grand Prix');
});

it('shows a dash instead of an invented constructors points value', async () => {
  const team = { constructorId: 'red_bull', name: 'Red Bull' };
  vi.mocked(api).mockImplementation(async (_source, path) => {
    const payload =
      path === '2026.json?limit=100'
        ? {
            MRData: {
              RaceTable: {
                Races: [
                  {
                    season: '2026',
                    round: '22',
                    raceName: 'Las Vegas Grand Prix',
                    date: '2026-11-21',
                    time: '06:00:00Z',
                    Circuit: { circuitId: 'vegas', circuitName: 'Las Vegas Strip Street Circuit' },
                  },
                ],
              },
            },
          }
        : path.includes('constructorStandings')
          ? {
              MRData: {
                StandingsTable: {
                  StandingsLists: [
                    {
                      ConstructorStandings: [{ position: '1', Constructor: team }],
                    },
                  ],
                },
              },
            }
          : { MRData: { StandingsTable: { StandingsLists: [] } } };
    return { source: 'jolpica', payload, fetchedAt: '2026-10-25T14:00:00Z', stale: false };
  });
  await act(async () => root.render(<Overview />));

  const constructors = host.querySelector('.f1-constructor-leader');
  expect(constructors?.textContent).toContain('Кубок конструкторов:');
  expect(constructors?.textContent).toContain('Red Bull');
  expect(constructors?.textContent).toContain('— очков');
  expect(constructors?.textContent).not.toContain('0 очков');
});
