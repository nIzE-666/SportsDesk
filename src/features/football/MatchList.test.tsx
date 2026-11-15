// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MatchList, groupMatchesByDay, matchDayKey } from './MatchList';

interface Item {
  id: string;
  time: string | null;
}

const items: Item[] = [
  { id: 'today', time: '2026-11-20T08:00:00Z' },
  { id: 'tomorrow', time: '2026-11-21T02:00:00Z' },
  { id: 'future', time: '2026-11-22T02:00:00Z' },
  { id: 'yesterday', time: '2026-11-19T02:00:00Z' },
  { id: 'unknown', time: null },
];

let host: HTMLDivElement, root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('uses the local calendar day of a timestamp and keeps an unknown day last', () => {
  expect(matchDayKey('2026-11-21T18:00:00Z', 'Asia/Yakutsk')).toBe('2026-11-22');
  expect(matchDayKey('2026-11-21', 'Pacific/Kiritimati')).toBe('2026-11-21');
  expect(matchDayKey('not a date', 'Asia/Yakutsk')).toBeNull();

  const groups = groupMatchesByDay(
    items,
    (item) => item.time,
    'Asia/Yakutsk',
    Date.parse('2026-11-20T10:00:00Z'),
  );
  expect(groups.map((group) => group.label)).toEqual([
    'Сегодня',
    'Завтра',
    'Вчера',
    'вс, 22 нояб.',
    'Без даты',
  ]);
  expect(groups.at(-1)?.items.map((item) => item.id)).toEqual(['unknown']);
});

it('renders one heading per day and the rows inside it', async () => {
  await act(async () =>
    root.render(
      <MatchList
        items={items.slice(0, 3)}
        getKey={(item) => item.id}
        getTime={(item) => item.time}
        timezone="Asia/Yakutsk"
        now={Date.parse('2026-11-20T10:00:00Z')}
        renderRow={(item) => <span data-id={item.id}>{item.id}</span>}
      />,
    ),
  );
  expect(
    [...host.querySelectorAll('.match-list__heading')].map((heading) => heading.textContent),
  ).toEqual(['Сегодня', 'Завтра', 'вс, 22 нояб.']);
  expect(host.querySelectorAll('.match-list__rows li')).toHaveLength(3);
  expect(host.querySelectorAll('.match-list__day')).toHaveLength(3);
});

it('can follow calendar order when a screen asks for it', () => {
  const groups = groupMatchesByDay(
    [
      { id: 'later', time: '2026-11-22T02:00:00Z' },
      { id: 'earlier', time: '2026-11-19T02:00:00Z' },
    ],
    (item) => item.time,
    'Asia/Yakutsk',
    Date.parse('2026-11-20T10:00:00Z'),
    'ascending',
  );
  expect(groups.map((group) => group.items[0]?.id)).toEqual(['earlier', 'later']);
});
