// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UpdateProvider } from '../features/settings/Updates';
import { DEFAULT_CUP_ID, type ShellRoute } from '../lib/navigation';
import { viewState } from '../lib/viewState';
import { RouteContent } from './RouteContent';

vi.mock('../features/football/FootballView', () => ({
  FootballView: () => <div data-testid="football-view" />,
}));

let host: HTMLDivElement, root: Root;

const props = {
  route: { kind: 'football', competitionId: 'l_4WFCIZ', tab: 'matches' } as ShellRoute,
  sport: 'football' as const,
  leagueId: 'l_4WFCIZ',
  cupId: DEFAULT_CUP_ID,
  onNavigate: () => {},
  onLeagueChange: () => {},
  onOpenMatch: () => {},
  onOpenWeekend: () => {},
};

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

it('opens the football screen without its own competition picker', async () => {
  await act(async () =>
    root.render(
      <UpdateProvider>
        <RouteContent {...props} />
      </UpdateProvider>,
    ),
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(host.querySelector('[data-testid="football-view"]')).not.toBeNull();
});
