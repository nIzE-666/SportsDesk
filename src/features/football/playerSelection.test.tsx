// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FavoritesProvider } from './FavoritesProvider';
import { ClubPlayers } from './ClubPlayers';
import { PlayersCenter } from './PlayersCenter';
import { PersonAvatar } from '../../components/PersonAvatar';
import { mergeSquad } from './squad';
import { viewState } from '../../lib/viewState';
import { STORAGE_KEYS } from './storage';
import type { UseFootballResult } from './useFootballData';
import type { LineupsPayload, MatchSummary, PlayerMatchEntry } from './types';

const transport = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn() }));
vi.mock('../../lib/bridge', () => transport);
const team = { id: 'barca', name: 'Barcelona' };
const match: MatchSummary = {
  id: 'selection-match',
  status: 'finished',
  date: '2026-10-18',
  home_team: team,
  away_team: { id: 'betis', name: 'Betis' },
  score_home: 2,
  score_away: 1,
};
const matches = [match];
const lineup: LineupsPayload = {
  match_id: match.id,
  home_team: team,
  away_team: match.away_team,
  home: {
    starters: [{ player_id: 'yamal', name: 'Lamine Yamal', shirt_number: '10' }],
    subs: [{ player_id: 'bench', name: 'Запасной' }],
  },
  away: { starters: [], subs: [] },
};
const entry: PlayerMatchEntry = {
  player: { id: 'yamal', name: 'Lamine Yamal', image_url: 'https://images.example/yamal.png' },
  team_id: team.id,
  stats: [
    {
      key: 'summary',
      title: 'Summary',
      stats: { Goals: { key: 'goals', stat: { type: 'number', value: 1 } } },
    },
  ],
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  transport.api.mockReset();
  transport.rpc.mockReset();
  transport.rpc.mockResolvedValue([]);
  transport.api.mockImplementation(async (_source: string, path: string) => ({
    payload: path.endsWith('/lineups')
      ? { data: lineup }
      : path.endsWith('/players')
        ? { data: [entry] }
        : { data: match },
    source: 'pitch',
    stale: false,
    fetchedAt: '2026-10-21',
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(element: React.ReactNode) {
  await act(async () => root.render(element));
}
async function click(label: string) {
  const btn = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  );
  expect(btn, label).toBeDefined();
  await act(async () => btn!.click());
}
const searchField = (label: string) =>
  host.querySelector<HTMLInputElement>(`[role="combobox"][aria-label="${label}"]`)!;
async function pickPlayer(label: string, query: string, option: string) {
  const field = searchField(label);
  await act(async () => field.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, query);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const found = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (element) => element.textContent?.trim() === option,
  );
  expect(found, option).toBeDefined();
  await act(async () => found!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
function pairOfEntries() {
  const other = {
    ...entry,
    player: { id: 'pedri', name: 'Pedri' },
    stats: [
      {
        key: 'summary',
        title: 'Summary',
        stats: { Goals: { key: 'goals', stat: { type: 'number', value: 3 } } },
      },
    ],
  } as PlayerMatchEntry;
  return [entry, other];
}
it('opens a club player, saves one favorite, opens it in the directory and removes it', async () => {
  await render(
    <FavoritesProvider>
      <ClubPlayers team={team} matches={matches} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.querySelectorAll('.players-squad__row')).toHaveLength(2);
  expect(host.querySelector('img')?.src).toBe(entry.player.image_url);
  await click('Статистика: Lamine Yamal');
  expect(host.querySelector('.player-profile')?.textContent).toContain('Голы');
  await click('В избранное');
  const favoriteProfileButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'В избранном',
  );
  expect(favoriteProfileButton?.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.favoritePlayers)!)).toHaveLength(1);
  const data = {
    teams: [{ ...team, leagueId: 'laliga' }],
    leagues: [{ id: 'laliga', name: 'LaLiga' }],
    allMatches: matches,
  } as UseFootballResult;
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.textContent).toContain('Избранные игроки 1');
  expect(host.querySelectorAll('.players-favorites__row')).toHaveLength(1);
  expect(
    host
      .querySelector('.players-favorites')
      ?.compareDocumentPosition(host.querySelector('.players-directory')!),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  await click('Профиль и статистика: Lamine Yamal');
  expect(host.querySelector('.player-profile')?.textContent).toContain('Lamine Yamal');
  await click('К игрокам');
  await click('Убрать из избранного: Lamine Yamal');
  // Nothing saved: one phrase instead of a heading with a zero.
  expect(host.textContent).not.toContain('Избранные игроки');
  expect(host.querySelector('.ui-empty')?.textContent).toContain(
    'Выберите клуб ниже и отметьте игроков звёздочкой.',
  );
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.favoritePlayers)!)).toEqual([]);
});
it('does not paint a late response from the previous club', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => {
    resolve = r;
  });
  transport.api.mockImplementation((_s: string, path: string) =>
    path.includes('slow-match')
      ? pending
      : Promise.resolve({
          payload: path.endsWith('/lineups') ? { data: lineup } : { data: [entry] },
        }),
  );
  const slow = { ...match, id: 'slow-match', home_team: { id: 'slow-team', name: 'Другой клуб' } };
  await render(
    <FavoritesProvider>
      <ClubPlayers team={slow.home_team} matches={[slow]} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  await render(
    <FavoritesProvider>
      <ClubPlayers team={team} matches={matches} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.textContent).toContain('Lamine Yamal');
  await act(async () => resolve({ payload: { data: [] } }));
  expect(host.textContent).toContain('Lamine Yamal');
  expect(host.textContent).not.toContain('Другой клуб');
});
it('keeps substitutes selectable when individual match stats are missing', async () => {
  await render(
    <FavoritesProvider>
      <ClubPlayers team={team} matches={matches} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  await click('Статистика: Запасной');
  expect(host.textContent).toContain('статистики нет');
  await click('В избранное');
  const favoriteFallbackButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'В избранном',
  );
  expect(favoriteFallbackButton?.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.favoritePlayers)!)[0].id).toBe('bench');
});
it('merges by player ID, excludes opponents and keeps bench players', () => {
  const members = mergeSquad(team.id, lineup, [
    entry,
    entry,
    { ...entry, team_id: 'betis', player: { id: 'opponent', name: 'Соперник' } },
  ]);
  expect(members.map((p) => p.id)).toEqual(['yamal', 'bench']);
  expect(members[0]!.imageUrl).toBe(entry.player.image_url);
});
it('replaces a broken portrait with initials and tries a changed URL', async () => {
  await render(<PersonAvatar name="Lamine Yamal" src="https://images.example/old.png" />);
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toBe('LY');
  await render(<PersonAvatar name="Lamine Yamal" src="https://images.example/new.png" />);
  expect(host.querySelector('img')?.src).toContain('/new.png');
});

function seedFavorites(ids = ['yamal']) {
  localStorage.setItem(
    STORAGE_KEYS.favoritePlayers,
    JSON.stringify(
      ids.map((id, index) => ({
        id,
        name: index === 0 ? 'Lamine Yamal' : index === 1 ? 'Pedri' : 'Raphinha',
        teamId: team.id,
        teamName: team.name,
        matchId: match.id,
        matchLabel: 'Barcelona — Betis',
        savedAt: '2026-10-21',
      })),
    ),
  );
  return {
    teams: [{ ...team, leagueId: 'laliga' }],
    leagues: [{ id: 'laliga', name: 'LaLiga' }],
    allMatches: matches,
  } as UseFootballResult;
}

it('keeps favourites compact and shows the aggregate season only on the profile', async () => {
  const data = seedFavorites();
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.querySelectorAll('.players-favorites__row')).toHaveLength(1);
  expect(host.querySelector('.players-favorites__row')?.textContent).toContain('Lamine Yamal');
  expect(host.querySelector('.players-favorites__row')?.textContent).toContain('Barcelona');
  // A single favourite cannot be compared: no picker, no hint.
  expect(host.querySelector('.players-compare-picker')).toBeNull();
  expect(host.textContent).not.toContain('Сравнение игроков');
  // The same season data is available in full on the player's profile.
  await click('Профиль и статистика: Lamine Yamal');
  expect(host.querySelector('.player-profile')?.textContent).toContain('Barcelona — Betis');
  expect(host.textContent).toContain('Статистика по матчам команды');
  expect(host.textContent).toContain('Суммы и средние по завершённым матчам этой команды.');
  expect(host.textContent).toContain('Собрать статистику по матчам');
  expect(transport.rpc).not.toHaveBeenCalled();
});
it('compares two favourites picked with search fields and marks the better value', async () => {
  transport.api.mockImplementation(async (_source: string, path: string) => ({
    payload: path.endsWith('/lineups')
      ? { data: lineup }
      : path.endsWith('/players')
        ? { data: pairOfEntries() }
        : { data: match },
    source: 'pitch',
    stale: false,
    fetchedAt: '2026-10-21',
  }));
  const data = seedFavorites(['yamal', 'pedri']);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.textContent).toContain('Избранные игроки 2');
  expect(host.querySelector('.players-compare-picker')).not.toBeNull();
  await pickPlayer('Первый игрок для сравнения', 'Yamal', 'Lamine Yamal');
  await pickPlayer('Второй игрок для сравнения', 'Pedri', 'Pedri');
  expect(host.querySelector('.players-compare__table')?.textContent).toContain('Показатель');
  expect(host.querySelector('.players-compare__table')?.textContent).toContain(
    'Матчей с данными: 1',
  );
  const best = host.querySelector('.players-compare__best');
  expect(best?.textContent).toContain('3');
  expect(best?.textContent).toContain('лучше');
  await click('Сбросить выбор');
  expect(host.querySelector('.players-compare__table')).toBeNull();
  expect(searchField('Первый игрок для сравнения').value).toBe('');
  expect(searchField('Второй игрок для сравнения').value).toBe('');
});
it('opens with the empty phrase and the club chooser when nothing is saved', async () => {
  const data = seedFavorites([]);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.textContent).not.toContain('Избранные игроки');
  expect(host.querySelector('.players-compare-picker')).toBeNull();
  expect(host.querySelectorAll('.players-favorites__row')).toHaveLength(0);
  expect(host.querySelectorAll('.ui-empty')).toHaveLength(1);
  expect(host.querySelector('.ui-empty')?.textContent).toContain(
    'Выберите клуб ниже и отметьте игроков звёздочкой.',
  );
  expect(host.querySelector('[aria-label="Клуб или игрок"]')).not.toBeNull();
});
it('lists ten favourites with the comparison picker and no zero or idle element', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const data = seedFavorites(ids);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.querySelector('.players-favorites__title')?.textContent).toBe('Избранные игроки 10');
  expect(host.querySelectorAll('.players-favorites__row')).toHaveLength(10);
  expect(host.querySelectorAll('.players-compare-picker [role="combobox"]')).toHaveLength(2);
  expect(host.querySelector('.ui-empty')).toBeNull();
});

it('adds and removes a favourite from the comparison from its own row', async () => {
  const data = seedFavorites(['yamal', 'pedri']);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  await click('Сравнить: Lamine Yamal');
  expect(searchField('Первый игрок для сравнения').value).toBe('Lamine Yamal');
  expect(host.textContent).toContain('В сравнении · убрать');
  await click('В сравнении · убрать: Lamine Yamal');
  expect(searchField('Первый игрок для сравнения').value).toBe('');
  expect(host.textContent).toContain(
    'Выберите двух игроков здесь или нажмите «Сравнить» в их строке.',
  );
});

it('opens the compared player profile from the table header', async () => {
  const data = seedFavorites(['yamal', 'pedri']);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  await pickPlayer('Первый игрок для сравнения', 'Yamal', 'Lamine Yamal');
  await pickPlayer('Второй игрок для сравнения', 'Pedri', 'Pedri');
  await click('Открыть профиль: Lamine Yamal');
  expect(host.querySelector('.player-profile h3')?.textContent).toBe('Статистика матча');
  await click('К игрокам');
  expect(host.querySelector('.players-compare__table')).not.toBeNull();
});

it('requires two different players, keeps the comparison through a profile and clears it', async () => {
  const data = seedFavorites(['yamal', 'pedri', 'raphinha']);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  await pickPlayer('Первый игрок для сравнения', 'Yamal', 'Lamine Yamal');
  const second = searchField('Второй игрок для сравнения');
  await act(async () => second.focus());
  expect([...host.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(
    ['Pedri', 'Raphinha'],
  );
  await pickPlayer('Второй игрок для сравнения', 'Pedri', 'Pedri');
  expect(host.querySelector('.players-compare__table')?.textContent).toContain('Lamine Yamal');
  expect(host.querySelector('.players-compare__table')?.textContent).toContain('Pedri');
  await click('Профиль и статистика: Lamine Yamal');
  expect(host.querySelector('.player-profile h3')?.textContent).toBe('Статистика матча');
  expect(host.textContent).toContain('Собрать статистику по матчам');
  await click('К игрокам');
  expect(host.querySelector('.players-compare__table')).not.toBeNull();
  await click('Сбросить выбор');
  expect(host.querySelector('.players-compare__table')).toBeNull();
});

it('updates comparison from the explicit player pickers and clears a removed favorite', async () => {
  const data = seedFavorites(['yamal', 'pedri']);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  await pickPlayer('Первый игрок для сравнения', 'Pedri', 'Pedri');
  await pickPlayer('Второй игрок для сравнения', 'Yamal', 'Lamine Yamal');
  expect(host.querySelector('.players-compare__table')?.textContent).toContain('Pedri');
  await click('Убрать из избранного: Pedri');
  expect(host.querySelector('.players-compare__table')).toBeNull();
  // One favourite is left: nothing to compare, so the picker goes away.
  expect(host.querySelector('.players-compare-picker')).toBeNull();
  expect(host.textContent).toContain('Избранные игроки 1');
});

const squadOf = (names: string[]): LineupsPayload => ({
  ...lineup,
  home: {
    starters: names.map((name, i) => ({ player_id: `member-${i}`, name })),
    subs: [],
  },
});
function serveSquad(names: string[]) {
  transport.api.mockImplementation(async (_source: string, path: string) => ({
    payload: path.endsWith('/lineups') ? { data: squadOf(names) } : { data: [] },
    source: 'pitch',
    stale: false,
    fetchedAt: '2026-10-21',
  }));
}
// The squad of a match is cached for a quarter of an hour, so each case uses its own match.
async function renderSquad(matchId: string) {
  await render(
    <FavoritesProvider>
      <ClubPlayers team={team} matches={[{ ...match, id: matchId }]} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
}
it('counts the squad in plain Russian and offers a search only for more than one player', async () => {
  serveSquad(['Первый', 'Второй', 'Третий']);
  await renderSquad('squad-three');
  expect(host.querySelector('.players-squad__title .ui-badge')?.textContent).toBe('3 игрока');
  expect(host.querySelector('[aria-label="Найти игрока в составе"]')).not.toBeNull();
  await act(async () => root.unmount());
  root = createRoot(host);
  serveSquad(['Единственный']);
  await renderSquad('squad-one');
  expect(host.querySelector('.players-squad__title .ui-badge')?.textContent).toBe('1 игрок');
  expect(host.querySelector('[aria-label="Найти игрока в составе"]')).toBeNull();
});
it('shows no count and one phrase when the source returned no squad', async () => {
  serveSquad([]);
  await renderSquad('squad-none');
  expect(host.querySelector('.players-squad__title .ui-badge')).toBeNull();
  expect(host.querySelector('.ui-empty')?.textContent).toContain('Состав отсутствует');
  expect(host.querySelector('[aria-label="Найти игрока в составе"]')).toBeNull();
});
it('finds a player through the squad search and opens the profile', async () => {
  serveSquad(['Ламин Ямаль', 'Педри', 'Рафинья']);
  await renderSquad('squad-search');
  await pickPlayer('Найти игрока в составе', 'Рафинья', 'Рафинья');
  expect(host.querySelector('.players-profile h2')?.textContent).toBe('Рафинья');
  expect(host.textContent).toContain('В заявке последнего матча, но статистики нет.');
});

it('says once that the source returned no figures instead of a summary full of zeros', async () => {
  const quiet = { ...match, id: 'no-figures-match' };
  transport.api.mockImplementation(async (_source: string, path: string) => ({
    payload: path.endsWith('/lineups') ? { data: lineup } : { data: [] },
    source: 'pitch',
    stale: false,
    fetchedAt: '2026-10-21',
  }));
  const data = { ...seedFavorites(['yamal']), allMatches: [quiet] } as UseFootballResult;
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.querySelectorAll('.players-favorites__row')).toHaveLength(1);
  await click('Профиль и статистика: Lamine Yamal');
  await click('Собрать статистику по матчам');
  expect(host.textContent).toContain('В этих матчах показателей игрока нет.');
  expect(host.querySelectorAll('.player-season__metrics .ui-stat')).toHaveLength(0);
  expect(host.textContent).not.toContain('по 0 матч');
});
