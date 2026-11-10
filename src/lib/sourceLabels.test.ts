import { expect, it } from 'vitest';
import { sourceLabel, sourceLabels } from './sourceLabels';

it('turns provider keys into readable names and keeps unknown values', () => {
  expect(sourceLabel('pitch')).toBe('PitchAPI');
  expect(sourceLabel('jolpica')).toBe('Jolpica');
  expect(sourceLabel('OpenF1')).toBe('OpenF1');
  expect(sourceLabel(' sportscore ')).toBe('SportScore');
  expect(sourceLabel('Другой источник')).toBe('Другой источник');
});

it('lists every source once in order of appearance', () => {
  expect(sourceLabels(['jolpica', 'openf1', 'Jolpica'])).toEqual(['Jolpica', 'OpenF1']);
  expect(sourceLabels(['jolpica / openf1', 'pitch'])).toEqual(['Jolpica', 'OpenF1', 'PitchAPI']);
  expect(sourceLabels(['', '  '])).toEqual([]);
});
