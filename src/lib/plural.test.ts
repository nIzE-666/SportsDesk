import { expect, it } from 'vitest';
import { pluralRu } from './plural';

it('declines counts the Russian way', () => {
  const forms = (n: number) => pluralRu(n, 'событие', 'события', 'событий');
  expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, -1].map(forms)).toEqual([
    'событий',
    'событие',
    'события',
    'события',
    'событий',
    'событий',
    'событий',
    'событий',
    'событие',
    'события',
    'событий',
    'событие',
    'событий',
    'событие',
  ]);
});
