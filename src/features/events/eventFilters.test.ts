import { expect, it } from 'vitest';
import { eventFilterChoices, filterEvents } from './eventFilters';
import type { SportsEvent } from './EventCenter';

const event = (id: string, patch: Partial<SportsEvent> = {}): SportsEvent => ({
  id,
  sport: 'football',
  kind: 'goal',
  title: 'Изменение счёта',
  body: 'Arsenal — Chelsea',
  occurredAt: Date.UTC(2026, 10, 8, 15),
  read: false,
  matchId: id,
  ...patch,
});
const race = (id: string, patch: Partial<SportsEvent> = {}) =>
  event(id, { sport: 'f1', title: 'Скоро гонка', season: '2026', round: '7', ...patch });

it('offers no filters for events of one sport that are all unread, or all read', () => {
  expect(eventFilterChoices([], 'all')).toEqual([]);
  expect(eventFilterChoices([event('a')], 'all')).toEqual([]);
  expect(eventFilterChoices([event('a'), event('b')], 'all')).toEqual([]);
  expect(
    eventFilterChoices([event('a', { read: true }), event('b', { read: true })], 'all'),
  ).toEqual([]);
});
it('offers the sports only while both are present', () => {
  expect(eventFilterChoices([event('a'), race('b')], 'all')).toEqual(['all', 'football', 'f1']);
  expect(eventFilterChoices([race('a'), race('b')], 'all')).toEqual([]);
});
it('offers the unread filter only while some, not all, events are unread', () => {
  expect(eventFilterChoices([event('a'), event('b', { read: true })], 'all')).toEqual([
    'all',
    'unread',
  ]);
  expect(eventFilterChoices([event('a', { read: true }), race('b')], 'all')).toEqual([
    'all',
    'unread',
    'football',
    'f1',
  ]);
});
it('keeps a selected filter so it can be undone', () => {
  const read = [event('a', { read: true }), event('b', { read: true })];
  expect(eventFilterChoices(read, 'unread')).toEqual(['all', 'unread']);
  expect(eventFilterChoices([event('a')], 'f1')).toEqual(['all', 'football', 'f1']);
  expect(eventFilterChoices([event('a')], 'football')).toEqual(['all', 'football', 'f1']);
});
it('lists the events of the selected filter', () => {
  const events = [event('a'), event('b', { read: true }), race('c'), race('d', { read: true })];
  const ids = (filter: Parameters<typeof filterEvents>[1]) =>
    filterEvents(events, filter).map((e) => e.id);
  expect(ids('all')).toEqual(['a', 'b', 'c', 'd']);
  expect(ids('unread')).toEqual(['a', 'c']);
  expect(ids('football')).toEqual(['a', 'b']);
  expect(ids('f1')).toEqual(['c', 'd']);
});
