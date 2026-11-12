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
it('opens a club player, saves one favorite, opens it in the directory and removes it', async () => {
  await render(
    <FavoritesProvider>
      <ClubPlayers team={team} matches={matches} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.querySelectorAll('.squad-player')).toHaveLength(2);
  expect(host.querySelector('img')?.src).toBe(entry.player.image_url);
  await click('Статистика: Lamine Yamal');
  expect(host.querySelector('.player-profile')?.textContent).toContain('Голы');
  await click('В избранное');
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
  expect(host.textContent).toContain('Избранные игроки · 1');
  expect(
    host
      .querySelector('.pc-grid')
      ?.compareDocumentPosition(host.querySelector('.player-directory')!),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  await click('Статистика: Lamine Yamal');
  expect(host.querySelector('.player-profile')?.textContent).toContain('Lamine Yamal');
  await click('К игрокам');
  await click('Убрать из избранного: Lamine Yamal');
  // Nothing saved: one phrase instead of a heading with a zero.
  expect(host.textContent).not.toContain('Избранные игроки');
  expect(host.querySelector('.state-block')?.textContent).toContain('Избранных игроков пока нет');
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

it('distinguishes aggregate statistics from the saved match and explains a single selection', async () => {
  const data = seedFavorites();
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.querySelector('.pc-scope')?.textContent).toContain('Сводка по 1 матчу с данными');
  expect(host.querySelector('.pc-origin')?.textContent).toContain(
    'Сохранён из матча: Barcelona — Betis',
  );
  // A single favourite cannot be compared: no picker, no hint, no compare button.
  expect(host.querySelector('.pc-picker')).toBeNull();
  expect(host.querySelector('[aria-label="Сравнить: Lamine Yamal"]')).toBeNull();
  expect(host.textContent).not.toContain('Сравнение игроков');
  expect(host.textContent).not.toContain('добавьте ещё одного футболиста');
});
it('shows the comparison picker and compare buttons from two favourites on', async () => {
  const data = seedFavorites(['yamal', 'pedri']);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.textContent).toContain('Избранные игроки · 2');
  expect(host.querySelector('.pc-picker')).not.toBeNull();
  await click('Сравнить: Lamine Yamal');
  expect(
    host.querySelector<HTMLSelectElement>('[aria-label="Первый игрок для сравнения"]')?.value,
  ).toBe('yamal');
  expect(
    host.querySelector<HTMLButtonElement>('.pc-actions [aria-pressed="true"]')?.textContent,
  ).toContain('В сравнении · убрать');
  expect(host.querySelector('.pc-compare')).toBeNull();
  await click('Убрать из сравнения: Lamine Yamal');
  expect(
    host.querySelector<HTMLSelectElement>('[aria-label="Первый игрок для сравнения"]')?.value,
  ).toBe('');
});
it('opens with the empty phrase and the club chooser when nothing is saved', async () => {
  const data = seedFavorites([]);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.textContent).not.toContain('Избранные игроки');
  expect(host.querySelector('.pc-picker')).toBeNull();
  expect(host.querySelectorAll('.pc-card')).toHaveLength(0);
  expect(host.querySelectorAll('.state-block')).toHaveLength(1);
  expect(host.querySelector('.state-block')?.textContent).toContain('Избранных игроков пока нет');
  expect(host.querySelector('[aria-label="Клуб для выбора игроков"]')).not.toBeNull();
});
it('lists ten favourites with the comparison picker and no zero or idle element', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const data = seedFavorites(ids);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  expect(host.querySelector('h2')?.textContent).toBe('Избранные игроки · 10');
  expect(host.querySelectorAll('.pc-card')).toHaveLength(10);
  expect(host.querySelectorAll('.pc-picker select')).toHaveLength(2);
  expect(host.querySelector('.state-block.empty')).toBeNull();
});

it('requires two different players, shows comparison, retains the choice through profile and clears it', async () => {
  const data = seedFavorites(['yamal', 'pedri', 'raphinha']);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  await click('Сравнить: Lamine Yamal');
  expect(host.textContent).toContain('Один игрок выбран');
  await click('Сравнить: Pedri');
  expect(host.querySelector('.pc-compare')?.textContent).toContain('Lamine Yamal и Pedri');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Сравнить: Raphinha"]')?.disabled).toBe(
    true,
  );
  expect(
    [
      ...host.querySelectorAll<HTMLOptionElement>(
        '[aria-label="Второй игрок для сравнения"] option',
      ),
    ].map((o) => o.value),
  ).not.toContain('yamal');
  await click('Статистика: Lamine Yamal');
  expect(host.querySelector('.player-profile h3')?.textContent).toBe('Статистика матча');
  expect(host.textContent).toContain('Собрать статистику по матчам');
  await click('К игрокам');
  expect(host.querySelector('.pc-compare')).not.toBeNull();
  await click('Сбросить выбор');
  expect(host.querySelector('.pc-compare')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Сравнить: Raphinha"]')?.disabled).toBe(
    false,
  );
});

it('updates comparison from the explicit player pickers and clears a removed favorite', async () => {
  const data = seedFavorites(['yamal', 'pedri']);
  await render(
    <FavoritesProvider>
      <PlayersCenter data={data} onOpenMatch={() => {}} />
    </FavoritesProvider>,
  );
  const pick = async (label: string, value: string) => {
    const select = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  await pick('Первый игрок для сравнения', 'pedri');
  await pick('Второй игрок для сравнения', 'yamal');
  expect(host.querySelector('.pc-compare')?.textContent).toContain('Pedri и Lamine Yamal');
  await click('Убрать из избранного: Pedri');
  expect(host.querySelector('.pc-compare')).toBeNull();
  // One favourite is left: nothing to compare, so the picker goes away.
  expect(host.querySelector('.pc-picker')).toBeNull();
  expect(host.textContent).toContain('Избранные игроки · 1');
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
async function typeSearch(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Поиск игрока в составе"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('counts the squad in plain Russian and offers a search only for more than one player', async () => {
  serveSquad(['Первый', 'Второй', 'Третий']);
  await renderSquad('squad-three');
  expect(host.querySelector('.club-players .section-title .muted')?.textContent).toBe('3 игрока');
  expect(host.querySelector('[aria-label="Поиск игрока в составе"]')).not.toBeNull();
  await act(async () => root.unmount());
  root = createRoot(host);
  serveSquad(['Единственный']);
  await renderSquad('squad-one');
  expect(host.querySelector('.club-players .section-title .muted')?.textContent).toBe('1 игрок');
  expect(host.querySelector('[aria-label="Поиск игрока в составе"]')).toBeNull();
});
it('shows no count and one phrase when the source returned no squad', async () => {
  serveSquad([]);
  await renderSquad('squad-none');
  expect(host.querySelector('.club-players .section-title .muted')).toBeNull();
  expect(host.querySelector('.state-block')?.textContent).toContain('Состав отсутствует');
  expect(host.querySelector('[aria-label="Поиск игрока в составе"]')).toBeNull();
});
it('says no such player is in the squad and clears the search with one action', async () => {
  serveSquad(['Ламин Ямаль', 'Педри', 'Рафинья']);
  await renderSquad('squad-search');
  await typeSearch('нет такого');
  expect(host.querySelectorAll('.squad-player')).toHaveLength(0);
  expect(host.querySelectorAll('.state-block')).toHaveLength(1);
  expect(host.querySelector('.state-block')?.textContent).toContain('Таких игроков в составе нет');
  // The field stays so the query can be corrected.
  expect(host.querySelector('[aria-label="Поиск игрока в составе"]')).not.toBeNull();
  await click('Очистить поиск');
  expect(host.querySelectorAll('.squad-player')).toHaveLength(3);
  expect(host.querySelector('.state-block')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[aria-label="Поиск игрока в составе"]')?.value).toBe(
    '',
  );
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
  expect(host.querySelector('.pc-card')?.textContent).toContain('Источник не вернул показатели');
  expect(host.querySelector('.pc-scope')).toBeNull();
  expect(host.querySelector('.pc-metrics')).toBeNull();
  expect(host.querySelector('.pc-foot')?.textContent).toBe('проверено 1 из 1 матчей');
  expect(host.textContent).not.toContain('0 известных минут');
  expect(host.textContent).not.toContain('по 0 матч');
});
