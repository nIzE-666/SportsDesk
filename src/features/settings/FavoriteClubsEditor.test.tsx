// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FAVORITE_TEAM_NAMES } from '../../lib/sportsIdentity';
import { STORAGE_KEYS } from '../football/storage';
import { useFavorites } from '../football/FavoritesProvider';
import {
  addFavoriteTeam,
  getFavoritesSnapshot,
  readStoredFav,
  removeFavoriteTeam,
  restoreDefaultTeam,
  seedFavoritesFromCatalogue,
} from '../football/favoritesStore';
import { FavoriteClubsEditor } from './FavoriteClubsEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEF: string = DEFAULT_FAVORITE_TEAM_NAMES[0] ?? 'Arsenal';
const catalogue = [
  { id: 'def-1', name: DEF, leagueName: 'Premier League', leagueId: 'l_pl' },
  { id: 'club-2', name: 'Brighton Unique FC', leagueName: 'Premier League', leagueId: 'l_pl' },
  { id: 'club-3', name: 'Brighton Unique FC Women', leagueName: 'WSL', leagueId: 'l_wsl' },
];

let container: HTMLDivElement;
let roots: Root[] = [];

function mount(node: React.ReactNode): HTMLDivElement {
  const el = document.createElement('div');
  container.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(node));
  return el;
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  act(() => (el as HTMLElement).click());
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  roots = [];
  container.remove();
});

describe('favoritesStore', () => {
  it('добавляет клуб по id источника и сообщает фоновому опросу', () => {
    let events = 0;
    const onChange = () => events++;
    window.addEventListener('sportsdesk-favorites-changed', onChange);
    seedFavoritesFromCatalogue(catalogue);
    addFavoriteTeam('club-2');
    window.removeEventListener('sportsdesk-favorites-changed', onChange);
    expect(readStoredFav().ids).toEqual(['def-1', 'club-2']);
    expect(getFavoritesSnapshot().favoriteTeamNames).toContain('Brighton Unique FC');
    // Женская команда с похожим названием не подтягивается.
    expect(readStoredFav().ids).not.toContain('club-3');
    expect(events).toBeGreaterThan(0);
  });

  it('убранный клуб по умолчанию не возвращается сам, только по явному действию', () => {
    seedFavoritesFromCatalogue(catalogue);
    removeFavoriteTeam('def-1');
    seedFavoritesFromCatalogue(catalogue);
    expect(readStoredFav().ids).not.toContain('def-1');
    expect(getFavoritesSnapshot().favoriteTeamNames).not.toContain(DEF);
    restoreDefaultTeam(DEF);
    expect(readStoredFav().ids).toContain('def-1');
  });

  it('несколько экранов видят одно состояние и не затирают друг друга', () => {
    seedFavoritesFromCatalogue(catalogue);
    const seen: string[][] = [];
    function Probe({ slot }: { slot: number }) {
      const { teamIds } = useFavorites();
      seen[slot] = teamIds;
      return null;
    }
    mount(<Probe slot={0} />);
    mount(<Probe slot={1} />);
    act(() => addFavoriteTeam('club-2'));
    expect(seen[0]).toEqual(['def-1', 'club-2']);
    expect(seen[1]).toEqual(['def-1', 'club-2']);
  });

  it('снимок перечитывается при смене сохранённых данных', () => {
    seedFavoritesFromCatalogue(catalogue);
    const before = getFavoritesSnapshot();
    expect(getFavoritesSnapshot()).toBe(before);
    localStorage.setItem(STORAGE_KEYS.favoritesTeams, JSON.stringify({ ids: ['club-2'] }));
    expect(getFavoritesSnapshot().teamIds).toEqual(['club-2']);
  });
});

describe('FavoriteClubsEditor', () => {
  it('ищет по каталогу, показывает лигу и добавляет клуб', () => {
    seedFavoritesFromCatalogue(catalogue);
    const el = mount(<FavoriteClubsEditor />);
    const input = el.querySelector('input[type="search"]') as HTMLInputElement;
    setInput(input, 'brighton unique');
    expect(el.textContent).toContain('WSL');
    click(el.querySelector('button[aria-label="Добавить Brighton Unique FC"]'));
    expect(readStoredFav().ids).toContain('club-2');
    expect(readStoredFav().ids).not.toContain('club-3');
    expect(el.querySelector('button[aria-label="Убрать Brighton Unique FC"]')).toBeTruthy();
  });

  it('убирает клуб и предлагает вернуть клуб по умолчанию', () => {
    seedFavoritesFromCatalogue(catalogue);
    const el = mount(<FavoriteClubsEditor />);
    click(el.querySelector(`button[aria-label="Убрать ${DEF}"]`));
    expect(readStoredFav().ids).not.toContain('def-1');
    click(el.querySelector(`button[aria-label="Вернуть ${DEF}"]`));
    expect(readStoredFav().ids).toContain('def-1');
  });

  it('без каталога подсказывает, где он пополняется', () => {
    const el = mount(<FavoriteClubsEditor compact />);
    expect(el.textContent).toContain('Каталог клубов пополняется');
    expect(el.textContent).not.toContain('Избранные игроки');
  });
});
