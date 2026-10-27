import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore } from './events';
import { InvalidArgs } from './history';

describe('development event center', () => {
  it('starts empty and persists read state for recorded events within retention', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sportsdesk-events-'));
    try {
      const path = join(dir, 'events.json');
      const store = new EventStore(path);
      expect(store.dispatch('event_center_list', {})).toEqual([]);
      const event = {
        id: '1',
        sport: 'football',
        kind: 'goal',
        title: 'Goal',
        body: '',
        occurredAt: Date.now(),
        read: false,
      };
      writeFileSync(path, JSON.stringify([event, { ...event, id: 'old', occurredAt: 0 }]));
      expect(store.dispatch('event_center_mark_read', { ids: ['1'] })).toBeNull();
      expect(new EventStore(path).dispatch('event_center_list', {})).toEqual([
        { ...event, read: true },
      ]);
      expect(() => store.dispatch('event_center_mark_read', { ids: [1] })).toThrow(InvalidArgs);
      for (const ids of [Array(501).fill('1'), [''], ['x'.repeat(1025)], ['я'.repeat(513)]])
        expect(() => store.dispatch('event_center_mark_read', { ids })).toThrow(InvalidArgs);
      writeFileSync(path, JSON.stringify([{ ...event, occurredAt: 'invalid' }]));
      expect(() => store.dispatch('event_center_list', {})).toThrow('Список событий не читается.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
