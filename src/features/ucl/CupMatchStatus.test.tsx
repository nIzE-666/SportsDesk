// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { viewState } from '../../lib/viewState';
import { ChampionsView } from './ChampionsView';
import { CupsView } from './CupsView';
import type { MatchSummary } from '../football/types';

vi.mock('../../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/bridge')>()),
  api: vi.fn(),
}));

const makeMatch = (id: string, status: string, status_text?: string): MatchSummary => ({
  id,
  status,
  status_text,
  time_utc: '2026-10-25T13:00:00Z',
  home_team: { id: `${id}-home`, name: `${id} Home` },
  away_team: { id: `${id}-away`, name: `${id} Away` },
  score_home: 2,
  score_away: 1,
});
const matches = [
  makeMatch('Scheduled', 'NS'),
  makeMatch('Live', 'unknown', '1H'),
  makeMatch('Finished', 'FIN'),
  makeMatch('ExtraTime', 'unknown', 'AET'),
  makeMatch('Cancelled', 'cancelled'),
  makeMatch('Postponed', 'postponed'),
  makeMatch('Unknown', 'mystery'),
];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('sportsdesk.design', 'broadcast');
  viewState.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (source, path) => {
    const payload =
      source === 'sportscore'
        ? { tables: [{ rows: [] }], scorers: [] }
        : path === 'leagues'
          ? {
              data: {
                leagues: [
                  { id: 'l_0bfbkO', seasons: ['2026/2027'] },
                  { id: 'l_38d9HA', seasons: ['2026/2027'] },
                ],
              },
            }
          : { data: { matches } };
    return { source, payload, fetchedAt: '2026-10-25T12:00:00Z', stale: false };
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function rowNames() {
  return [...host.querySelectorAll('.game-row')].map((row) => row.textContent ?? '');
}

async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

it.each(['champions', 'cup'] as const)(
  '%s overview, featured game and filters consistently classify provider statuses',
  async (view) => {
    const onTabChange = vi.fn();
    const render = (tab: 'overview' | 'matches') =>
      view === 'champions' ? (
        <ChampionsView tab={tab} onTabChange={onTabChange} />
      ) : (
        <CupsView competitionId="l_38d9HA" tab={tab} onTabChange={onTabChange} />
      );
    await act(async () => root.render(render('overview')));

    expect(rowNames()).toHaveLength(2);
    expect(rowNames().join(' ')).toContain('Scheduled Home');
    expect(rowNames().join(' ')).toContain('Live Home');
    expect(rowNames().join(' ')).not.toMatch(/Finished|ExtraTime|Cancelled|Postponed|Unknown/);
    expect(host.querySelector('.event-cover-teams')?.textContent).toContain('Live Home');
    expect(host.querySelector('.event-cover-status')?.textContent).toContain('В игре');
    const played = [...host.querySelectorAll('.insights-row small')].find((element) =>
      element.textContent?.includes('сыгранных матча'),
    );
    expect(played?.parentElement?.querySelector('strong')?.textContent).toBe('2');

    await act(async () => root.render(render('matches')));
    expect(rowNames()).toHaveLength(7);
    await click('Предстоящие');
    expect(rowNames()).toHaveLength(2);
    expect(rowNames().join(' ')).toContain('Scheduled Home');
    expect(rowNames().join(' ')).toContain('Live Home');
    expect(rowNames().find((row) => row.includes('Live Home'))).toContain('В игре');
    await click('Результаты');
    expect(rowNames()).toHaveLength(2);
    expect(rowNames().join(' ')).toContain('Finished Home');
    expect(rowNames().join(' ')).toContain('ExtraTime Home');
    expect(rowNames().find((row) => row.includes('ExtraTime Home'))).toContain('Завершён');
  },
);
