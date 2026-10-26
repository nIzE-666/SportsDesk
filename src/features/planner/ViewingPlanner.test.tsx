// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewingPlanner } from './ViewingPlanner';
import { useFootballData, type UseFootballResult } from '../football/useFootballData';
import { useApiResource } from '../f1/api';
import { STORAGE_KEYS } from '../football/storage';
import { viewState } from '../../lib/viewState';
import type { MatchSummary } from '../football/types';
import type { JolpicaRace } from '../f1/types';

vi.mock('../football/useFootballData', () => ({ useFootballData: vi.fn() }));
vi.mock('../f1/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../f1/api')>()),
  useApiResource: vi.fn(),
}));

const firstMatch: MatchSummary = {
  id: 'barca-match',
  status: 'scheduled',
  date: '2026-10-25',
  time_utc: '2026-10-25T12:00:00Z',
  home_team: { id: 'barcelona', name: 'Barcelona' },
  away_team: { id: 'betis', name: 'Real Betis' },
  score_home: null,
  score_away: null,
};
const nextMatch: MatchSummary = {
  ...firstMatch,
  id: 'barca-next-match',
  date: '2026-10-26',
  time_utc: '2026-10-26T13:00:00Z',
  away_team: { id: 'other-team', name: 'Villarreal' },
};
const ignoredMatch: MatchSummary = {
  ...firstMatch,
  id: 'not-followed',
  home_team: { id: 'wolves', name: 'Wolves' },
  away_team: { id: 'fulham', name: 'Fulham' },
};
const race: JolpicaRace = {
  season: '2026',
  round: '20',
  raceName: 'Mexico City Grand Prix',
  date: '2026-10-25',
  time: '12:30:00Z',
  Circuit: { circuitId: 'mexico', circuitName: 'Autódromo Hermanos Rodríguez' },
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let openMatch: ReturnType<typeof vi.fn>;
let openWeekend: ReturnType<typeof vi.fn>;

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
function button(text: string) {
  const result = buttons().find((element) => element.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
function labelledButton(label: string) {
  const result = buttons().find((element) => element.getAttribute('aria-label') === label);
  if (!result) throw new Error(`Missing labelled button: ${label}`);
  return result;
}
function onlyMyPlan() {
  const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error('Missing personal-plan filter');
  return input;
}
const articles = () => [...host.querySelectorAll<HTMLElement>('.planner-event')];
function titleText(element: Element | null | undefined) {
  if (!element) return '';
  const title = element.cloneNode(true) as HTMLElement;
  title.querySelectorAll('.planner-crests').forEach((crest) => crest.remove());
  return title.textContent?.trim() ?? '';
}
const articleNames = () =>
  articles().map((element) => titleText(element.querySelector('.planner-title')));
function eventButton(text: string) {
  const result = buttons().find(
    (element) => element.classList.contains('planner-title') && titleText(element) === text,
  );
  if (!result) throw new Error(`Missing event button: ${text}`);
  return result;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function render() {
  await act(async () =>
    root.render(<ViewingPlanner onOpenMatch={openMatch} onOpenWeekend={openWeekend} />),
  );
}
async function selectDate(date: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="День спортивного плана"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, date);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  localStorage.setItem(STORAGE_KEYS.timezone, 'Asia/Yakutsk');
  localStorage.setItem(
    STORAGE_KEYS.favoritesTeams,
    JSON.stringify({ ids: ['barcelona'], seeded: ['barcelona'], seededDefault: true }),
  );
  const matches = [firstMatch, nextMatch, ignoredMatch];
  const data: UseFootballResult = {
    leagues: [{ id: 'laliga', name: 'LaLiga' }],
    leaguesLoading: false,
    leaguesError: null,
    selectedLeagueId: 'laliga',
    setSelectedLeague: vi.fn(),
    season: '2026/2027',
    matches,
    matchesLoading: false,
    matchesError: null,
    stale: false,
    fetchedAt: '2026-10-25T00:00:00Z',
    reload: vi.fn(),
    allMatches: matches,
    teams: [
      { ...firstMatch.home_team, leagueId: 'laliga', leagueName: 'LaLiga' },
      { ...firstMatch.away_team, leagueId: 'laliga', leagueName: 'LaLiga' },
    ],
    leagueTeams: [],
    matchesForLeague: (league) => (league === 'laliga' ? matches : []),
    leagueName: () => 'LaLiga',
    seasonsForLeague: () => ['2026/2027'],
    setSelectedSeason: vi.fn(),
  };
  vi.mocked(useFootballData).mockReturnValue(data);
  vi.mocked(useApiResource).mockImplementation(
    (_key, path) =>
      ({
        data: path ? { races: [race] } : null,
        loading: false,
        error: null,
        source: 'test',
        fetchedAt: path ? '2026-10-25T00:00:00Z' : null,
        stale: false,
        reload: vi.fn(),
      }) as ReturnType<typeof useApiResource>,
  );
  openMatch = vi.fn();
  openWeekend = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('personal sports viewing planner', () => {
  it('shows favorite football and F1 in one local-time schedule with explicit estimated endings', async () => {
    await render();
    expect(articleNames()).toEqual([
      'Barcelona — Real Betis',
      'Гран-при Мехико · Гонка',
      'Barcelona — Villarreal',
    ]);
    expect(host.textContent).not.toContain('Wolves');
    expect(host.textContent).toContain('Asia/Yakutsk');
    expect(articles()[0]?.querySelector('.planner-time')?.textContent).toContain('21:00до ≈ 23:00');
    expect(articles()[1]?.querySelector('.planner-time')?.textContent).toContain('21:30до ≈ 23:30');
    expect(host.textContent).toContain('Окончание приблизительное');
    expect(articles()[0]?.textContent).toContain('Пересекается: Гран-при Мехико · Гонка');
    expect(articles()[1]?.textContent).toContain('Пересекается: Barcelona — Real Betis');
    expect(host.querySelector('.planner-conflict-banner')).toBeNull();
  });

  it('filters selected events, warns when both overlapping broadcasts are chosen, and removes the warning after deselection', async () => {
    await render();
    await click(labelledButton('Буду смотреть: Barcelona — Real Betis'));
    await click(onlyMyPlan());
    expect(onlyMyPlan().checked).toBe(true);
    expect(articleNames()).toEqual(['Barcelona — Real Betis']);
    expect(host.querySelector('.planner-conflict-banner')).toBeNull();
    await click(onlyMyPlan());
    await click(labelledButton('Буду смотреть: Гран-при Мехико · Гонка'));
    expect(host.querySelector('.planner-conflict-banner')?.textContent).toContain(
      'В вашем плане есть пересечения',
    );
    await click(onlyMyPlan());
    expect(articleNames()).toEqual(['Barcelona — Real Betis', 'Гран-при Мехико · Гонка']);
    await click(labelledButton('Убрать из плана: Barcelona — Real Betis'));
    expect(articleNames()).toEqual(['Гран-при Мехико · Гонка']);
    expect(host.querySelector('.planner-conflict-banner')).toBeNull();
  });

  it('persists watching choices and the personal filter through unmount and remount', async () => {
    await render();
    await click(labelledButton('Буду смотреть: Barcelona — Real Betis'));
    await click(onlyMyPlan());
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(onlyMyPlan().checked).toBe(true);
    expect(articleNames()).toEqual(['Barcelona — Real Betis']);
    expect(
      labelledButton('Убрать из плана: Barcelona — Real Betis').getAttribute('aria-pressed'),
    ).toBe('true');
    await click(onlyMyPlan());
    expect(
      labelledButton('Буду смотреть: Гран-при Мехико · Гонка').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('opens the exact selected match and race without changing watching choices', async () => {
    await render();
    await click(eventButton('Barcelona — Real Betis'));
    await click(eventButton('Гран-при Мехико · Гонка'));
    expect(openMatch).toHaveBeenCalledTimes(1);
    expect(openMatch).toHaveBeenCalledWith('barca-match', 'laliga');
    expect(openWeekend).toHaveBeenCalledTimes(1);
    expect(openWeekend).toHaveBeenCalledWith(race);
    expect(
      labelledButton('Буду смотреть: Barcelona — Real Betis').getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      labelledButton('Буду смотреть: Гран-при Мехико · Гонка').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('filters by the chosen local day and restores the nearest-week timeline', async () => {
    await render();
    await click(button('Сегодня'));
    expect(articleNames()).toEqual(['Barcelona — Real Betis', 'Гран-при Мехико · Гонка']);
    await selectDate('2026-10-26');
    expect(articleNames()).toEqual(['Barcelona — Villarreal']);
    await selectDate('2026-10-27');
    expect(articles()).toHaveLength(0);
    expect(host.textContent).toContain('В этом периоде нет событий');
    await click(button('Ближайшие 7 дней'));
    expect(articles()).toHaveLength(3);
  });
});
