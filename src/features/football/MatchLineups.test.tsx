// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MatchLineups } from './MatchLineups';
import { FavoritesProvider } from './FavoritesProvider';
import { viewState } from '../../lib/viewState';
import type { LineupsPayload, MatchDetail, PlayerMatchEntry } from './types';

const home = { id: 'home', name: 'Домашний клуб' },
  away = { id: 'away', name: 'Гостевой клуб' };
const detail: MatchDetail = {
  id: 'fixture',
  home_team: home,
  away_team: away,
  status: 'finished',
  score_home: 1,
  score_away: 0,
  time_utc: '2026-10-24T19:00:00Z',
};
const lineup: LineupsPayload = {
  match_id: 'fixture',
  home_team: home,
  away_team: away,
  home: {
    formation: '4-2-3-1',
    confirmed: true,
    starters: [
      { player_id: 'shared', name: 'Хозяин', pitch_x: 0.1, pitch_y: 0.5 },
      { player_id: 'unknown', name: 'Без координат' },
    ],
    subs: [{ player_id: 'bench', name: 'Запасной', pitch_x: 0, pitch_y: 0 }],
  },
  away: {
    formation: '5-3-2',
    starters: [{ player_id: 'shared', name: 'Гость', pitch_x: 0.1, pitch_y: 0.5 }],
    subs: [],
  },
};
const entry = (team: string, name: string, rating: number): PlayerMatchEntry => ({
  team_id: team,
  player: { id: 'shared', name, image_url: 'https://example.com/portrait.webp' },
  stats: [
    {
      key: 'top_stats',
      title: 'Top stats',
      stats: { Rating: { key: 'rating_title', stat: { type: 'double', value: rating } } },
    },
  ],
});
const entries = [entry('home', 'Хозяин', 8.25), entry('away', 'Гость', 6.4)];
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(payload: LineupsPayload | null = lineup, players = entries) {
  await act(async () =>
    root.render(
      <FavoritesProvider>
        <MatchLineups detail={detail} payload={payload} entries={players} />
      </FavoritesProvider>,
    ),
  );
}
async function click(label: string) {
  const b = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
  );
  expect(b).toBeDefined();
  await act(async () => b!.click());
}

it('shows actual ratings and portraits on the pitch; substitutes and missing positions stay in the lists', async () => {
  await render();
  expect(host.querySelectorAll('.pitch-player')).toHaveLength(2);
  expect(host.querySelector('.pitch-player.home')?.textContent).toContain('8,25');
  expect(host.querySelector('.pitch-player.away')?.textContent).toContain('6,40');
  expect(host.querySelectorAll('.pitch-player img')).toHaveLength(2);
  expect(host.textContent).toContain('У части игроков нет позиции на поле');
  expect(host.querySelector('.lineup-team-lists')?.textContent).toContain('Запасной');
  expect(host.querySelector('.lineup-team-lists')?.textContent).toContain('Без координат');
});

it('opens the exact player and team match profile and returns to the formation', async () => {
  await render();
  await click('Гость, Гостевой клуб, оценка 6,40, открыть статистику');
  expect(host.querySelector('.player-profile h2')?.textContent).toBe('Гость');
  expect(host.querySelector('.player-profile')?.textContent).toContain('Гостевой клуб');
  expect(host.querySelector('.player-profile')?.textContent).toContain('6,4');
  await click('В избранное');
  expect(host.textContent).toContain('В избранном');
  await click('К расстановке');
  expect(host.querySelectorAll('.pitch-player')).toHaveLength(2);
});

it('keeps unknown ratings as dashes and disables unavailable player details', async () => {
  await render(lineup, []);
  for (const p of host.querySelectorAll<HTMLButtonElement>('.pitch-player')) {
    expect(p.disabled).toBe(true);
    expect(p.querySelector('.lineup-rating')?.textContent).toBe('—');
  }
  expect(host.textContent).toContain('(0 из 2)');
  expect(host.textContent).not.toContain('0,00');
});

it('does not display another match or reversed teams and handles unpublished lineups', async () => {
  for (const payload of [null, { ...lineup, match_id: 'wrong' }, { ...lineup, home_team: away }]) {
    await render(payload);
    expect(host.querySelector('.lineup-pitch')).toBeNull();
    expect(host.textContent).toContain('Составы пока не опубликованы');
  }
});
