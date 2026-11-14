// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viewState } from '../../lib/viewState';
import { MyView, type MyViewProps } from './MyView';

let host: HTMLDivElement, root: Root;

const props: Omit<MyViewProps, 'tab'> = {
  onTabChange: vi.fn(),
  onOpenMatch: vi.fn(),
  onOpenClub: vi.fn(),
  onOpenPlayer: vi.fn(),
  onOpenF1: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenWeekend: vi.fn(),
};

// A separate file: the Formula 1 favourites hook reads localStorage only once
// per module instance, so the genuinely empty list needs a fresh instance.
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  localStorage.setItem('sportsdesk.f1.favTeams', '[]');
  localStorage.setItem('sportsdesk.f1.favDrivers', '[]');
  localStorage.setItem('sportsdesk.football.favorites.teams', '{"ids":[]}');
  localStorage.setItem('sportsdesk.football.favorites.players', '[]');
  localStorage.setItem('sportsdesk.football.catalogue', '[]');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('shows one sentence and the settings link without favorites', async () => {
  await act(async () => root.render(<MyView {...props} tab="favorites" />));
  expect(host.querySelector('.my-empty')?.textContent).toContain(
    'Здесь появятся клубы, игроки и команды Формулы 1',
  );
  expect(host.querySelector('.my-tile')).toBeNull();
  expect(host.querySelector('.my-row')).toBeNull();
  expect(host.querySelector('.my-chip')).toBeNull();

  const edit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === 'Изменить',
  );
  await act(async () => edit!.click());
  expect(props.onOpenSettings).toHaveBeenCalledWith('favorites');
});
