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
  await click('Статистика: Lamine Yamal');
  expect(host.querySelector('.player-profile')?.textContent).toContain('Lamine Yamal');
  await click('К игрокам');
  await click('Убрать из избранного: Lamine Yamal');
  expect(host.textContent).toContain('Избранные игроки · 0');
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
  expect(host.textContent).toContain('индивидуальная статистика этого матча отсутствует');
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
  expect(host.textContent).toContain('добавьте ещё одного футболиста в избранное');
  await click('Сравнить: Lamine Yamal');
  expect(host.textContent).not.toContain('Слот');
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
  expect(host.querySelector('.player-profile h3')?.textContent).toBe('Статистика выбранного матча');
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
  expect(
    host.querySelector<HTMLSelectElement>('[aria-label="Первый игрок для сравнения"]')?.value,
  ).toBe('');
});
