// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { writeModules } from '../lib/modules';
import { headerTabs } from './shellModel';

beforeEach(() => localStorage.clear());

it('labels the four «Моё» tabs and opens favorites by default', () => {
  const tabs = headerTabs({ kind: 'my' });
  expect(tabs.map((tab) => tab.label)).toEqual([
    'Избранное',
    'Дневник',
    'Игры и прогнозы',
    'Схемы',
  ]);
  expect(tabs.find((tab) => tab.active)?.key).toBe('favorites');
});

it('filters the «Моё» tabs by modules and falls back to favorites', () => {
  writeModules({ diary: false, games: false, predictions: false, tactics: false });
  const tabs = headerTabs({ kind: 'my', tab: 'schemes' });
  expect(tabs.map((tab) => tab.label)).toEqual(['Избранное']);
  expect(tabs[0]?.active).toBe(true);
  expect(tabs[0]?.route).toEqual({ kind: 'my', tab: 'favorites' });
});

it('keeps games visible while either games or predictions are on', () => {
  writeModules({ games: false });
  expect(headerTabs({ kind: 'my' }).map((tab) => tab.key)).toContain('games');
  writeModules({ predictions: false });
  expect(headerTabs({ kind: 'my' }).map((tab) => tab.key)).not.toContain('games');
});
