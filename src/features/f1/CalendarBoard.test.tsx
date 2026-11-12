// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalendarBoard } from './CalendarBoard';
import { calendarMonth, calendarPhase, orderedCalendar, racePresentation } from './calendarModel';
import type { JolpicaRace } from './types';
import { viewState } from '../../lib/viewState';

vi.mock('../../lib/bridge', () => ({
  api: vi.fn(async () => ({
    payload: { MRData: { RaceTable: { Races: [] } } },
    source: 'test',
    stale: false,
    fetchedAt: '2026-10-25T00:00:00Z',
  })),
}));
const makeRace = (round: string, date: string, name = 'Australian Grand Prix'): JolpicaRace => ({
  season: '2026',
  round,
  raceName: name,
  date,
  time: '12:00:00Z',
  Circuit: { circuitId: `test-${round}`, circuitName: `Circuit ${round}` },
  Qualifying: { date, time: '08:00:00Z' },
});
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
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
  vi.useRealTimers();
});
async function click(text: string) {
  const b = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.getAttribute('aria-label') === text || el.textContent?.trim().startsWith(text),
  );
  expect(b, text).toBeDefined();
  await act(async () => b!.click());
}
it('starts near the upcoming stage and opens the chosen weekend alongside its list', async () => {
  const races = [
    makeRace('1', '2026-10-01'),
    makeRace('2', '2026-11-01', 'Chinese Grand Prix'),
    makeRace('3', '2026-11-08', 'Japanese Grand Prix'),
  ];
  await act(async () => root.render(<CalendarBoard year={2026} races={races} />));
  expect(host.querySelectorAll('.calendar-stage')).toHaveLength(2);
  expect(
    host.querySelector('.calendar-detail .race-weekend')?.getAttribute('aria-label'),
  ).toContain('Гран-при Китая');
  await click('Открыть Гран-при Японии, этап 3');
  expect(
    host
      .querySelector('.calendar-layout>.calendar-detail .race-weekend')
      ?.getAttribute('aria-label'),
  ).toContain('Гран-при Японии');
  await click('Прошедшие');
  expect(host.querySelectorAll('.calendar-stage')).toHaveLength(1);
  expect(host.querySelector('.calendar-stage.selected')?.textContent).toContain(
    'Гран-при Австралии',
  );
  await click('Все этапы');
  await click('Открыть Гран-при Японии, этап 3');
  await act(async () => root.render(<CalendarBoard year={2026} races={races.slice()} />));
  expect(host.querySelector('.calendar-stage.selected')?.textContent).toContain('Гран-при Японии');
});
it('handles an empty season and deduplicates repeated provider rounds', async () => {
  await act(async () => root.render(<CalendarBoard year={2026} races={[]} />));
  expect(host.textContent).toContain('Этапов по этому фильтру нет');
  expect(
    orderedCalendar([
      makeRace('2', '2026-11-01'),
      makeRace('1', '2026-10-01'),
      makeRace('2', '2026-11-01'),
    ]).map((r) => r.round),
  ).toEqual(['1', '2']);
});
it('keeps unknown-time dates in their source month and converts only real instants', () => {
  const unknown = { ...makeRace('1', '2026-01-31'), time: undefined };
  expect(calendarMonth(unknown, 'Pacific/Kiritimati')).toContain('январь');
  expect(calendarMonth(makeRace('1', '2026-01-31'), 'Pacific/Kiritimati')).toContain('февраль');
  expect(calendarPhase(unknown, Date.parse('2026-01-31T18:00:00Z'))).toBe('upcoming');
  expect(racePresentation(unknown)).toMatchObject({ title: 'Гран-при Австралии', country: 'AU' });
});
