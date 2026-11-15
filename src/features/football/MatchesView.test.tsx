// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { viewState } from '../../lib/viewState';
import { FavoritesProvider } from './FavoritesProvider';
import { MatchesView } from './MatchesView';
import type { MatchSummary, TeamRef } from './types';
import type { UseFootballResult } from './useFootballData';

vi.mock('../../lib/bridge', () => ({
  api: vi.fn(),
  rpc: vi.fn(),
  isTauriRuntime: () => false,
  openExternal: vi.fn(),
}));

const arsenal: TeamRef = { id: 'arsenal', name: 'Arsenal' };
const chelsea: TeamRef = { id: 'chelsea', name: 'Chelsea' };
const everton: TeamRef = { id: 'everton', name: 'Everton' };
const brentford: TeamRef = { id: 'brentford', name: 'Brentford' };
const fulham: TeamRef = { id: 'fulham', name: 'Fulham' };
const villa: TeamRef = { id: 'villa', name: 'Aston Villa' };

const matches: MatchSummary[] = [
  {
    id: 'today',
    status: 'finished',
    round_name: '10',
    home_team: arsenal,
    away_team: chelsea,
    time_utc: '2026-11-20T08:00:00Z',
    score_home: 2,
    score_away: 1,
  },
  {
    id: 'tomorrow',
    status: 'scheduled',
    round_name: '11',
    home_team: everton,
    away_team: brentford,
    time_utc: '2026-11-21T02:00:00Z',
    score_home: null,
    score_away: null,
  },
  {
    id: 'later',
    status: 'scheduled',
    round_name: '11',
    home_team: fulham,
    away_team: villa,
    time_utc: '2026-11-22T02:00:00Z',
    score_home: null,
    score_away: null,
  },
];

function dataFor(list: MatchSummary[]): UseFootballResult {
  const teams = new Map<string, TeamRef>();
  for (const match of list) {
    teams.set(match.home_team.id, match.home_team);
    teams.set(match.away_team.id, match.away_team);
  }
  return {
    leagues: [{ id: 'l_4WFCIZ', name: 'Premier League', season: '2026/2027' }],
    leaguesLoading: false,
    leaguesError: null,
    selectedLeagueId: 'l_4WFCIZ',
    setSelectedLeague: vi.fn(),
    season: '2026/2027',
    matches: list,
    matchesLoading: false,
    matchesError: null,
    stale: false,
    fetchedAt: null,
    reload: vi.fn(),
    allMatches: list,
    teams: [...teams.values()].map((team) => ({
      ...team,
      leagueId: 'l_4WFCIZ',
      leagueName: 'Premier League',
    })),
    leagueTeams: [...teams.values()].map((team) => ({
      ...team,
      leagueId: 'l_4WFCIZ',
      leagueName: 'Premier League',
    })),
    matchesForLeague: () => list,
    leagueName: () => 'Premier League',
    seasonsForLeague: () => ['2026/2027', '2025/2026'],
    setSelectedSeason: vi.fn(),
  };
}

let host: HTMLDivElement, root: Root;

async function renderMatches(data: UseFootballResult = dataFor(matches), onOpenMatch = () => {}) {
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <MatchesView data={data} onOpenMatch={onOpenMatch} />
      </FavoritesProvider>,
    ),
  );
}

const rows = () => [...host.querySelectorAll<HTMLElement>('.ui-match-row')];
const rowTexts = () => rows().map((row) => row.textContent ?? '');
const headings = () =>
  [...host.querySelectorAll<HTMLElement>('.match-list__heading')].map(
    (heading) => heading.textContent,
  );

async function choose(label: string, optionText: string) {
  const input = host.querySelector<HTMLInputElement>(`[role="combobox"][aria-label="${label}"]`);
  if (!input) throw new Error(`Combobox missing: ${label}`);
  await act(async () => input.focus());
  const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (entry) => entry.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`Option missing: ${optionText}`);
  await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  vi.mocked(api).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it('hides the league picker and keeps one filter instead of the old tabs', async () => {
  await renderMatches();
  expect(host.querySelector('#league-select')).toBeNull();
  expect(host.querySelector('label[for="league-select"]')).toBeNull();
  const filter = host.querySelector('[role="radiogroup"][aria-label="Фильтр матчей"]');
  expect(
    [...(filter?.querySelectorAll('[role="radio"]') ?? [])].map((item) => item.textContent),
  ).toEqual(['Мои', 'Все', 'Сейчас идут']);
  expect(filter?.querySelector('[aria-checked="true"]')?.textContent).toBe('Все');
  expect(host.textContent).not.toContain('Хозяева');
  expect(host.textContent).not.toContain('Гости');
});

it('groups one list by day with human headings and sorts rows by kick-off', async () => {
  await renderMatches();
  expect(headings()).toEqual(['Сегодня', 'Завтра', 'вс, 22 нояб.']);
  expect(rows()).toHaveLength(3);
  expect(rowTexts()[0]).toContain('Arsenal');
  expect(rowTexts()[0]).toContain('2 : 1');
  expect(rowTexts()[1]).toContain('Everton');
  expect(rowTexts()[1]).toContain('11:00');
  expect(rowTexts()[2]).toContain('Fulham');
});

it('shows only favourite clubs under «Мои» and keeps the favourite badge', async () => {
  localStorage.setItem('sportsdesk.football.favorites.teams', JSON.stringify({ ids: ['arsenal'] }));
  await renderMatches();
  const filter = host.querySelector('[role="radiogroup"][aria-label="Фильтр матчей"]')!;
  const mine = [...filter.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (item) => item.textContent === 'Мои',
  )!;
  await act(async () => mine.click());
  expect(rows()).toHaveLength(1);
  expect(rowTexts()[0]).toContain('Arsenal');
  expect(rows()[0]?.querySelector('.ui-match-row__badge')?.textContent).toBe('Избранное');
  expect(viewState.read('football.matches.filter', 'all')).toBe('mine');

  const all = [...filter.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (item) => item.textContent === 'Все',
  )!;
  await act(async () => all.click());
  expect(rows()).toHaveLength(3);
});

it('offers round and team search when the data has them', async () => {
  await renderMatches();
  expect(host.querySelector('[role="combobox"][aria-label="Тур"]')).not.toBeNull();
  expect(host.querySelector('[role="combobox"][aria-label="Команда"]')).not.toBeNull();
  await choose('Тур', 'Тур 10');
  expect(rows()).toHaveLength(1);
  expect(rowTexts()[0]).toContain('Arsenal');
  await choose('Команда', 'Everton');
  expect(rows()).toHaveLength(0);
  expect(host.textContent).toContain('Нет матчей по фильтрам');
});

it('opens the match page from «Разбор» and toggles a favourite star', async () => {
  const onOpenMatch = vi.fn();
  await renderMatches(dataFor(matches), onOpenMatch);
  const open = host.querySelector<HTMLButtonElement>('[data-match-id="today"] .mt-open');
  expect(open).not.toBeNull();
  await act(async () => open!.click());
  expect(onOpenMatch).toHaveBeenCalledWith('today');
  expect(viewState.read('match.today.tab', 'overview')).toBe('stats');

  const star = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.getAttribute('aria-label')?.includes('Arsenal'),
  );
  expect(star?.getAttribute('aria-pressed')).toBe('false');
  await act(async () => star!.click());
  const pressed = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.getAttribute('aria-label')?.includes('Arsenal'),
  );
  expect(pressed?.getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('sportsdesk.football.favorites.teams')).toContain('arsenal');
});

it('keeps the calendar export in the matches menu', async () => {
  await renderMatches();
  const menu = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Меню',
  );
  expect(menu).toBeTruthy();
  await act(async () => menu!.click());
  const dialog = host.querySelector('[role="dialog"]');
  expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
  expect(dialog?.textContent).toContain('Будущие матчи избранных клубов или выбранной лиги.');
  expect(dialog?.textContent).toContain('Скачать .ics');
});

it('opens the live feed under «Сейчас идут» and remembers the filter', async () => {
  vi.mocked(api).mockResolvedValue({
    payload: {
      Stages: [
        {
          CompN: 'Premier League',
          CompD: 'England',
          Cnm: 'England',
          Events: [
            {
              Eid: 'live',
              T1: [{ Nm: 'Arsenal' }],
              T2: [{ Nm: 'Visitor' }],
              Eps: "67'",
              Esd: 20261120200000,
              Tr1: '1',
              Tr2: '0',
            },
          ],
        },
      ],
    },
    source: 'livescore',
    fetchedAt: '2026-11-20T10:00:00.000Z',
    stale: false,
  });
  await renderMatches();
  const filter = host.querySelector('[role="radiogroup"][aria-label="Фильтр матчей"]')!;
  const live = [...filter.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (item) => item.textContent === 'Сейчас идут',
  )!;
  await act(async () => live.click());
  await act(async () => {});
  expect(host.querySelector('.live-panel')).not.toBeNull();
  expect(host.textContent).toContain("67'");
  expect(host.textContent).toContain('Arsenal');
  expect(host.querySelector('[role="combobox"][aria-label="Тур"]')).toBeNull();
  expect(viewState.read('football.matches.filter', 'all')).toBe('live');
});
