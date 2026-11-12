// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MiniWindow } from './MiniWindow';
import { loadLiveFeed } from './liveFeed';

vi.mock('../../lib/bridge', () => ({ rpc: vi.fn(), isTauriRuntime: () => false }));
vi.mock('./liveFeed', () => ({ loadLiveFeed: vi.fn() }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('is called Live-мини like the button that opens it and says plainly when nothing is on', async () => {
  vi.mocked(loadLiveFeed).mockResolvedValue({
    matches: [],
    fetchedAt: '2026-11-12T10:00:00Z',
    stale: false,
  });
  await act(async () => root.render(<MiniWindow />));
  expect(host.querySelector('.mini-title')?.textContent).toContain('Live-мини');
  expect(host.querySelector('.mini-empty')?.textContent).toBe(
    'Сейчас нет матчей избранных клубов.',
  );
  expect(host.textContent).not.toMatch(/SportsDesk Live|отслеживаем/);
});

it('keeps showing the matches of favourite clubs and marks saved data', async () => {
  vi.mocked(loadLiveFeed).mockResolvedValue({
    matches: [
      {
        id: 'm1',
        home_id: 'a',
        away_id: 'b',
        home: 'Arsenal',
        away: 'Chelsea',
        home_score: 2,
        away_score: 1,
        status: 'live',
        competition: 'Premier League',
      },
    ],
    fetchedAt: '2026-11-12T10:00:00Z',
    stale: true,
  });
  await act(async () => root.render(<MiniWindow />));
  expect(host.querySelector('.mini-row')?.textContent).toContain('Arsenal2 : 1Chelsea');
  expect(host.querySelector('.mini-error')?.textContent).toContain('Показаны сохранённые данные');
  expect(host.querySelector('.mini-empty')).toBeNull();
});
