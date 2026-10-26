import { expect, it } from 'vitest';
import cases from '../shared/pitchDateCacheCases.json';
import { pitchDateCacheTtl } from './pitchDateCache';

it.each(cases)('uses $ttl ms for $path at $now ($statuses)', (test) => {
  const payload = { data: { matches: test.statuses.map((status) => ({ status })) } };
  expect(pitchDateCacheTtl(test.path, payload, Date.parse(test.now))).toBe(test.ttl);
});
it('keeps unrecognized payloads and paths on the short TTL', () => {
  expect(pitchDateCacheTtl('date/invalid', {})).toBe(60_000);
  expect(pitchDateCacheTtl('date/2020-01-01', { data: {} })).toBe(60_000);
  expect(pitchDateCacheTtl('date/2020-01-01', { matches: [{ status: null }] })).toBe(60_000);
});
