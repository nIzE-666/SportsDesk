import { expect, it } from 'vitest';
import { countRu, LAP_PAIRS, LAPS, MATCHES, pluralRu } from './plural';

it('picks the Russian form by the last digits of the number', () => {
  const cases: Array<[number, string]> = [
    [0, 'матчей'],
    [1, 'матч'],
    [2, 'матча'],
    [4, 'матча'],
    [5, 'матчей'],
    [11, 'матчей'],
    [12, 'матчей'],
    [14, 'матчей'],
    [21, 'матч'],
    [22, 'матча'],
    [25, 'матчей'],
    [101, 'матч'],
    [111, 'матчей'],
    [112, 'матчей'],
    [380, 'матчей'],
  ];
  for (const [count, word] of cases) expect(pluralRu(count, MATCHES)).toBe(word);
});

it('writes the number with its word', () => {
  expect(countRu(2, MATCHES)).toBe('2 матча');
  expect(countRu(1, LAPS)).toBe('1 круг');
  expect(countRu(4, LAP_PAIRS)).toBe('4 пары');
  expect(countRu(10, LAP_PAIRS)).toBe('10 пар');
});

it('ignores the sign and the fractional part', () => {
  expect(pluralRu(-2, MATCHES)).toBe('матча');
  expect(pluralRu(2.9, MATCHES)).toBe('матча');
});

it('declines events the same way', () => {
  const forms = (n: number) => pluralRu(n, ['событие', 'события', 'событий']);
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
