import { classifyMatchStatus } from './sportsIdentity';

/** Today's fixtures stay fresh; adjacent quiet days do not need minute polling. */
export function pitchDateCacheTtl(path: string, payload: unknown, now = Date.now()): number {
  const match = /^date\/(\d{4}-\d{2}-\d{2})(?:\?|$)/.exec(path);
  if (!match?.[1]) return 60_000;
  const today = new Date(now).toISOString().slice(0, 10);
  if (match[1] === today) return 60_000;
  const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
  const fixtures = data && typeof data === 'object' && 'matches' in data ? data.matches : null;
  if (!Array.isArray(fixtures)) return 60_000;
  const statuses = fixtures.map((fixture: unknown) =>
    classifyMatchStatus(
      fixture &&
        typeof fixture === 'object' &&
        'status' in fixture &&
        typeof fixture.status === 'string'
        ? fixture.status
        : undefined,
    ),
  );
  if (statuses.includes('live')) return 60_000;
  if (match[1] > today) return 15 * 60_000;
  // Keep following delayed/unclassified games after midnight as well.
  return statuses.every((s) => ['finished', 'cancelled', 'postponed'].includes(s))
    ? 10 * 60_000
    : 60_000;
}
