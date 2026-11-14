// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UpdateProvider } from '../features/settings/Updates';
import { DEFAULT_CUP_ID, type ShellRoute } from '../lib/navigation';
import { viewState } from '../lib/viewState';
import { RouteContent } from './RouteContent';

vi.mock('../features/football/FootballView', () => ({
  FootballView: ({ showLeaguePicker }: { showLeaguePicker?: boolean }) => (
    <div data-testid="football-view" data-picker={String(showLeaguePicker)} />
  ),
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
  onBack: () => {},
};

async function renderContent(newFrame: boolean) {
  const content: ReactNode = <RouteContent {...props} newFrame={newFrame} />;
  await act(async () => root.render(<UpdateProvider>{content}</UpdateProvider>));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

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

it('lets the old frame keep the football screen pickers', async () => {
  await renderContent(false);
  expect(host.querySelector('[data-testid="football-view"]')?.getAttribute('data-picker')).toBe(
    'true',
  );
});

it('hides the football screen pickers in the new frame', async () => {
  await renderContent(true);
  expect(host.querySelector('[data-testid="football-view"]')?.getAttribute('data-picker')).toBe(
    'false',
  );
});
