// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hiddenCompetitionRoute, useHiddenCompetitionRedirect } from './competitionRouting';
import {
  CHAMPIONS_LEAGUE_ID,
  DEFAULT_CUP_ID,
  type FootballTab,
  type ShellRoute,
} from '../lib/navigation';
import { leagueModuleId, writeModules } from '../lib/modules';

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

function visible(isVisible: (id: string) => boolean) {
  return (route: ShellRoute) => {
    if (route.kind !== 'football' && route.kind !== 'football-match') return null;
    return hiddenCompetitionRoute(
      route.competitionId,
      route.kind === 'football' ? route.tab : undefined,
      isVisible,
    );
  };
}

function Probe({ route, navigate }: { route: ShellRoute; navigate: (route: ShellRoute) => void }) {
  useHiddenCompetitionRedirect(route, navigate);
  return null;
}

async function renderProbe(route: ShellRoute, navigate: (route: ShellRoute) => void) {
  await act(async () => root.render(<Probe route={route} navigate={navigate} />));
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('keeps a visible competition and its tab', () => {
  const fallback = visible(() => true);
  expect(fallback({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'bracket' })).toBe(
    null,
  );
  expect(fallback({ kind: 'football-match', matchId: 'm1', competitionId: 'l_4WFCIZ' })).toBe(null);
});

it('moves a hidden league to the first visible league and keeps its tab', () => {
  const isVisible = (id: string) => id !== 'l_4WFCIZ';
  expect(
    visible(isVisible)({ kind: 'football', competitionId: 'l_4WFCIZ', tab: 'standings' }),
  ).toEqual({ kind: 'football', competitionId: 'l_0ErfuF', tab: 'standings' });
});

it('uses the default tab when the first league does not have the current one', () => {
  const tab = 'bracket' as FootballTab;
  const isVisible = (id: string) => id !== CHAMPIONS_LEAGUE_ID;
  expect(visible(isVisible)({ kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab })).toEqual(
    {
      kind: 'football',
      competitionId: 'l_4WFCIZ',
      tab: 'matches',
    },
  );
});

it('goes to «Сегодня» when no league is visible', () => {
  expect(hiddenCompetitionRoute(DEFAULT_CUP_ID, 'matches', () => false)).toEqual({
    kind: 'today',
    mode: 'today',
  });
});

it('redirects a hidden competition when its module is turned off', async () => {
  const navigate = vi.fn();
  await act(async () => {
    writeModules({ [leagueModuleId('l_0ErfuF')]: false });
  });
  await renderProbe({ kind: 'football', competitionId: 'l_0ErfuF', tab: 'standings' }, navigate);
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: 'l_4WFCIZ',
    tab: 'standings',
  });
});

it('redirects a direct link to a hidden competition and leaves a visible one alone', async () => {
  writeModules({ europe: false });
  const navigate = vi.fn();
  await renderProbe(
    { kind: 'football', competitionId: CHAMPIONS_LEAGUE_ID, tab: 'matches' },
    navigate,
  );
  expect(navigate).toHaveBeenCalledWith({
    kind: 'football',
    competitionId: 'l_4WFCIZ',
    tab: 'matches',
  });

  navigate.mockClear();
  await renderProbe({ kind: 'football', competitionId: 'l_4WFCIZ', tab: 'matches' }, navigate);
  expect(navigate).not.toHaveBeenCalled();
});
