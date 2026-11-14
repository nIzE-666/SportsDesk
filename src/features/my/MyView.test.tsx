// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeModules } from '../../lib/modules';
import { viewState } from '../../lib/viewState';
import { diaryFixture, diaryFootballEntry, diaryRaceEntry } from '../../test/fixtures/diary';
import { tacticLineups, tacticMatch } from '../../test/fixtures/tactics';
import { DIARY_KEY } from '../diary/diaryModel';
import { PREDICTIONS_KEY } from '../games/predictions';
import { schemeFromLineups, TACTICS_KEY } from '../tactics/tacticsModel';
import { MyView, type MyViewProps } from './MyView';

let host: HTMLDivElement, root: Root;

const calls = {
  tab: vi.fn(),
  match: vi.fn(),
  club: vi.fn(),
  player: vi.fn(),
  f1: vi.fn(),
  settings: vi.fn(),
  weekend: vi.fn(),
};

const baseProps: Omit<MyViewProps, 'tab'> = {
  onTabChange: calls.tab,
  onOpenMatch: calls.match,
  onOpenClub: calls.club,
  onOpenPlayer: calls.player,
  onOpenF1: calls.f1,
  onOpenSettings: calls.settings,
  onOpenWeekend: calls.weekend,
};

const player = {
  id: 'a',
  name: 'Alex Morgan',
  teamId: 'arsenal',
  teamName: 'Arsenal',
  savedAt: '2026-11-09T00:00:00Z',
};

const prediction = {
  matchId: 'next-match',
  leagueId: 'l_4WFCIZ',
  home: 2,
  away: 1,
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  kickoff: '2099-01-01T12:00:00Z',
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  rules: 1,
};

const scheme = {
  ...schemeFromLineups(tacticMatch, tacticLineups, 'scheme'),
  title: 'Прессинг на фланге',
  updatedAt: '2026-11-09T00:00:00Z',
};

function seedFavorites() {
  localStorage.setItem(
    'sportsdesk.football.favorites.teams',
    JSON.stringify({ ids: ['arsenal'], seededDefault: true }),
  );
  localStorage.setItem(
    'sportsdesk.football.catalogue',
    JSON.stringify([
      { id: 'arsenal', name: 'Arsenal', leagueId: 'l_4WFCIZ', leagueName: 'Premier League' },
    ]),
  );
  localStorage.setItem('sportsdesk.football.favorites.players', JSON.stringify([player]));
}

function button(text: string, within: ParentNode = host) {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.trim().includes(text),
  );
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

async function render(tab: MyViewProps['tab'], showTabs = false) {
  await act(async () => root.render(<MyView {...baseProps} tab={tab} showTabs={showTabs} />));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  for (const call of Object.values(calls)) call.mockReset();
  // The F1 favourites hook caches its first read for the whole file.
  localStorage.setItem('sportsdesk.f1.favTeams', JSON.stringify(['mercedes']));
  localStorage.setItem('sportsdesk.f1.favDrivers', JSON.stringify(['max_verstappen']));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('favorites tab', () => {
  it('shows favourite clubs, players and Formula 1 favourites and opens them', async () => {
    seedFavorites();
    await render('favorites');
    expect(host.querySelector('.my-tile')?.textContent).toContain('Arsenal');
    expect(host.querySelector('.my-row')?.textContent).toContain('Alex Morgan');
    expect(host.textContent).toContain('Mercedes');
    expect(host.textContent).toContain('Макс Ферстаппен');

    await click(button('Arsenal'));
    expect(calls.club).toHaveBeenCalledWith('arsenal', 'l_4WFCIZ');
    await click(button('Alex Morgan'));
    expect(calls.player).toHaveBeenCalledWith(player);
    await click(button('Mercedes'));
    expect(calls.f1).toHaveBeenCalled();
    await click(button('Изменить'));
    expect(calls.settings).toHaveBeenCalledWith('favorites');
  });
});

describe('diary tab', () => {
  it('shows the existing diary and forwards football and Formula 1 references', async () => {
    localStorage.setItem(DIARY_KEY, JSON.stringify(diaryFixture));
    await render('diary');
    expect(host.querySelectorAll('.diary-entry')).toHaveLength(2);
    expect(host.textContent).toContain(diaryFootballEntry.note);

    const card = (title: string) =>
      [...host.querySelectorAll<HTMLElement>('.diary-entry')].find(
        (item) => item.querySelector('h3')?.textContent === title,
      )!;
    await click(button('Открыть событие', card(diaryFootballEntry.event.title)));
    expect(calls.match).toHaveBeenCalledWith(
      diaryFootballEntry.event.reference?.kind === 'football'
        ? diaryFootballEntry.event.reference.matchId
        : '',
      'l_4WFCIZ',
    );
    await click(button('Открыть событие', card(diaryRaceEntry.event.title)));
    expect(calls.weekend).toHaveBeenCalledWith(
      diaryRaceEntry.event.reference?.kind === 'f1' ? diaryRaceEntry.event.reference.season : '',
      diaryRaceEntry.event.reference?.kind === 'f1' ? diaryRaceEntry.event.reference.round : '',
    );
  });

  it('shows the diary empty state without records', async () => {
    await render('diary');
    expect(host.textContent).toContain('Сохраните первый просмотр');
    expect(host.querySelector('.diary-entry')).toBeNull();
  });
});

describe('games tab', () => {
  it('shows the existing games and the saved predictions', async () => {
    localStorage.setItem(PREDICTIONS_KEY, JSON.stringify({ version: 1, items: [prediction] }));
    await render('games');
    await click(button('Угадай счёт'));
    expect(host.querySelector('.predictions-game')).not.toBeNull();
    expect(host.textContent).toContain('Arsenal — Chelsea');
    expect(host.textContent).toContain('Мой прогноз 2 : 1');
    await click(button('Открыть матч'));
    expect(calls.match).toHaveBeenCalledWith('next-match', 'l_4WFCIZ');
  });

  it('shows the predictions empty state', async () => {
    await render('games');
    await click(button('Угадай счёт'));
    expect(host.textContent).toContain('Прогнозов пока нет.');
  });
});

describe('schemes tab', () => {
  beforeEach(() => {
    localStorage.setItem(TACTICS_KEY, JSON.stringify({ version: 1, schemes: [scheme] }));
  });

  it('lists the saved schemes with the match and opens the board', async () => {
    await render('schemes');
    expect(host.querySelector('.my-scheme')?.textContent).toContain('Прессинг на фланге');
    expect(host.querySelector('.my-scheme')?.textContent).toContain('Матч · Arsenal — Chelsea');

    await click(button('Открыть'));
    expect(calls.match).toHaveBeenCalledWith(tacticMatch.id);
    expect(viewState.read(`match.${tacticMatch.id}.tab`, '')).toBe('tactics');
    expect(viewState.read(`tactics.${tacticMatch.id}.draft`, null)).toEqual(scheme);
  });

  it('asks for confirmation before deleting a scheme', async () => {
    await render('schemes');
    await click(button('Удалить'));
    expect(host.textContent).toContain('Удалить схему «Прессинг на фланге»?');
    expect(JSON.parse(localStorage.getItem(TACTICS_KEY)!).schemes).toHaveLength(1);

    await click(button('Оставить'));
    expect(host.textContent).not.toContain('Удалить схему «Прессинг на фланге»?');
    expect(JSON.parse(localStorage.getItem(TACTICS_KEY)!).schemes).toHaveLength(1);

    await click(button('Удалить'));
    await click(button('Подтвердить удаление'));
    expect(JSON.parse(localStorage.getItem(TACTICS_KEY)!).schemes).toHaveLength(0);
    expect(host.textContent).toContain('Сохранённых схем пока нет.');
  });

  it('shows the schemes empty state', async () => {
    localStorage.removeItem(TACTICS_KEY);
    await render('schemes');
    expect(host.textContent).toContain('Сохранённых схем пока нет.');
    expect(host.querySelector('.my-scheme')).toBeNull();
  });
});

describe('tabs and modules', () => {
  it('draws its own tab strip in the old frame and switches tabs', async () => {
    await render('favorites', true);
    expect(host.querySelectorAll('.my-tabs [role="tab"]')).toHaveLength(4);
    await click(button('Дневник'));
    expect(calls.tab).toHaveBeenCalledWith('diary');
  });

  it('draws no tab strip in the new frame', async () => {
    await render('favorites');
    expect(host.querySelector('.my-tabs')).toBeNull();
  });

  it('hides tabs by modules but always keeps favorites', async () => {
    await render('favorites', true);
    expect(host.querySelectorAll('.my-tabs [role="tab"]')).toHaveLength(4);

    await act(async () => writeModules({ diary: false }));
    expect(host.textContent).not.toContain('Дневник');
    expect(host.textContent).toContain('Избранное');

    await act(async () => writeModules({ games: false, predictions: false }));
    expect(host.textContent).not.toContain('Игры и прогнозы');

    await act(async () => writeModules({ tactics: false }));
    expect(host.textContent).not.toContain('Схемы');
  });

  it('opens the first visible tab when the current one is hidden', async () => {
    await act(async () => writeModules({ diary: false }));
    await render('diary', true);
    expect(calls.tab).toHaveBeenCalledWith('favorites');
    expect(host.textContent).toContain('Избранное');

    calls.tab.mockReset();
    await act(async () => writeModules({ games: false, predictions: false }));
    await render('games', true);
    expect(calls.tab).toHaveBeenCalledWith('favorites');

    calls.tab.mockReset();
    await act(async () => writeModules({ tactics: false }));
    await render('schemes', true);
    expect(calls.tab).toHaveBeenCalledWith('favorites');
  });
});
