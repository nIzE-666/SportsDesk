// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  DEFAULT_HOME_ORDER,
  HOME_LAYOUT_KEY,
  isValidHomeLayoutValue,
  moveHomeWidget,
  parseHomeLayout,
  readHomeLayout,
  resetHomeLayout,
  resolveHomeLayout,
  setHomeWidgetHidden,
} from './homeLayout';
import { HomeLayoutEditor } from './HomeLayoutEditor';
import { allowedProfileKey, replaceProfile } from '../settings/profileBackup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  localStorage.clear();
});

it('uses the design default when nothing is saved or the value is broken', () => {
  expect(readHomeLayout('classic').order).toEqual(DEFAULT_HOME_ORDER.classic);
  expect(readHomeLayout('broadcast').order).toEqual(DEFAULT_HOME_ORDER.broadcast);
  for (const raw of ['{bad', '[]', 'null', '{"order":["clubs"]}', '{"version":0}']) {
    localStorage.setItem(HOME_LAYOUT_KEY, raw);
    expect(parseHomeLayout(raw)).toBeNull();
    expect(readHomeLayout('classic')).toEqual({
      custom: false,
      order: [...DEFAULT_HOME_ORDER.classic],
      hidden: [],
    });
  }
});

it('drops unknown and duplicate ids and appends widgets missing from an old config', () => {
  const config = parseHomeLayout(
    JSON.stringify({
      version: 1,
      order: ['clubs', 'future-widget', 'clubs', 'insights'],
      hidden: ['x', 'calendar'],
    }),
  );
  expect(config).toEqual({ version: 1, order: ['clubs', 'insights'], hidden: ['calendar'] });
  const resolved = resolveHomeLayout(config, 'classic');
  expect(resolved.order).toEqual(['clubs', 'insights', 'calendar', 'editorial']);
  expect(resolved.hidden).toEqual(['calendar']);
  // Более новая версия читается по известным полям.
  expect(
    parseHomeLayout(JSON.stringify({ version: 2, order: ['editorial'], extra: 1 }))?.order,
  ).toEqual(['editorial']);
});

it('moves, hides and resets, and the result survives a reload', () => {
  moveHomeWidget('classic', 'clubs', -1);
  expect(readHomeLayout('classic').order).toEqual(['insights', 'clubs', 'calendar', 'editorial']);
  moveHomeWidget('classic', 'insights', -1); // уже первый — без изменений
  expect(readHomeLayout('classic').order[0]).toBe('insights');
  setHomeWidgetHidden('classic', 'calendar', true);
  const stored = localStorage.getItem(HOME_LAYOUT_KEY);
  expect(stored && JSON.parse(stored)).toEqual({
    version: 1,
    order: ['insights', 'clubs', 'calendar', 'editorial'],
    hidden: ['calendar'],
  });
  resetHomeLayout();
  expect(readHomeLayout('broadcast')).toEqual({
    custom: false,
    order: [...DEFAULT_HOME_ORDER.broadcast],
    hidden: [],
  });
});

it('hiding without reordering keeps following the design default order', () => {
  setHomeWidgetHidden('classic', 'insights', true);
  expect(readHomeLayout('broadcast').order).toEqual(DEFAULT_HOME_ORDER.broadcast);
  expect(readHomeLayout('broadcast').hidden).toEqual(['insights']);
});

it('keeps separate block orders for the dashboard and «Сегодня» in one key', () => {
  const today = readHomeLayout('classic', 'today');
  expect(today.order).toEqual(['catchup', 'live', 'upcoming', 'teams']);
  expect(today.custom).toBe(false);
  moveHomeWidget('classic', 'live', -1, 'today');
  setHomeWidgetHidden('classic', 'teams', true, 'today');
  expect(readHomeLayout('classic', 'today').order).toEqual([
    'live',
    'catchup',
    'upcoming',
    'teams',
  ]);
  expect(readHomeLayout('classic', 'today').hidden).toEqual(['teams']);
  // The old dashboard keeps its own defaults and hidden list.
  expect(readHomeLayout('classic').order).toEqual(DEFAULT_HOME_ORDER.classic);
  expect(readHomeLayout('classic').hidden).toEqual([]);
  resetHomeLayout('today');
  expect(readHomeLayout('classic', 'today').order).toEqual([
    'catchup',
    'live',
    'upcoming',
    'teams',
  ]);
  expect(readHomeLayout('classic', 'today').hidden).toEqual([]);
});

it('is part of the profile backup and a broken value is rejected on restore', () => {
  expect(allowedProfileKey(HOME_LAYOUT_KEY)).toBe(true);
  expect(isValidHomeLayoutValue('{"version":1,"order":null,"hidden":[]}')).toBe(true);
  expect(() => replaceProfile({ [HOME_LAYOUT_KEY]: '{broken' })).toThrow();
});

it('editor buttons reorder and toggle visibility with live updates', () => {
  root = createRoot(container);
  act(() => root?.render(<HomeLayoutEditor design="classic" onClose={() => undefined} />));
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button('Выше: Сводка')?.disabled).toBe(true);
  expect(button('Ниже: Расписание и ваши матчи')?.disabled).toBe(true);
  const reset = () =>
    Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Восстановить'),
    ) as HTMLButtonElement;
  expect(reset().disabled).toBe(true);
  act(() => button('Ниже: Сводка')?.click());
  const names = () =>
    Array.from(container.querySelectorAll('.home-layout-name strong')).map((n) => n.textContent);
  expect(names()[1]).toBe('Сводка');
  act(() => button('Скрыть: Ваши клубы')?.click());
  expect(button('Показать: Ваши клубы')).not.toBeNull();
  expect(reset().disabled).toBe(false);
  act(() => reset().click());
  expect(names()[0]).toBe('Сводка');
  expect(button('Скрыть: Ваши клубы')).not.toBeNull();
});
