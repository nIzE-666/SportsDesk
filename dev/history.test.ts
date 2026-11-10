import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { handleCommand } from './bridge';
import { HistoryStore } from './history';
import { EventStore } from './events';

let dir: string, server: Server, url: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sportsdesk-history-'));
  const stores = {
    history: new HistoryStore(join(dir, 'history.json')),
    events: new EventStore(join(dir, 'events.json')),
  };
  server = createServer((req, res) => {
    void handleCommand(req, res, stores);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  rmSync(dir, { recursive: true, force: true });
});
async function rpc(command: string, args: unknown = {}) {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ command, args }) });
  return { status: res.status, body: await res.json() };
}
const match = {
  id: '1',
  homeId: 'a',
  homeName: 'A',
  awayId: 'b',
  awayName: 'B',
  homeScore: null,
  awayScore: null,
  status: 'scheduled',
  date: '2026-01-01',
  round: '1',
};
const batch = { leagueId: 'l', leagueName: 'League', season: '2026', matches: [match] };
describe('history command bridge', () => {
  it('stores offline fixtures and pins durably while deletion preserves history', async () => {
    const p = {
      version: 1,
      leagueId: batch.leagueId,
      leagueName: batch.leagueName,
      season: batch.season,
      fetchedAt: '2026-11-09T00:00:00Z',
      pinned: true,
      duplicates: 0,
      matches: [{ ...match, timeUtc: '2026-01-01T20:00:00Z' }],
    };
    expect((await rpc('offline_put', { package: p })).status).toBe(200);
    expect((await rpc('offline_put', { package: p })).status).toBe(200);
    expect((await rpc('offline_get', { leagueId: p.leagueId, season: p.season })).body).toEqual(p);
    expect((await rpc('offline_list')).body).toHaveLength(1);
    expect((await rpc('offline_remove', { leagueId: p.leagueId, season: p.season })).status).toBe(
      400,
    );
    expect(
      (await rpc('offline_pin', { leagueId: p.leagueId, season: p.season, pinned: false })).status,
    ).toBe(200);
    expect((await rpc('offline_remove', { leagueId: p.leagueId, season: p.season })).status).toBe(
      200,
    );
    expect((await rpc('offline_list')).body).toEqual([]);
    expect(
      (await rpc('history_season_matches', { leagueId: p.leagueId, season: p.season })).body,
    ).toHaveLength(1);
    expect(
      new HistoryStore(join(dir, 'history.json')).dispatch('history_seasons', {}),
    ).toHaveLength(1);
  });
  it('rejects malformed offline updates without replacing the existing snapshot', async () => {
    const p = {
      version: 1,
      leagueId: batch.leagueId,
      leagueName: batch.leagueName,
      season: batch.season,
      fetchedAt: '2026-11-09T00:00:00Z',
      pinned: true,
      duplicates: 0,
      matches: [{ ...match, timeUtc: null }],
    };
    await rpc('offline_put', { package: p });
    for (const invalid of [
      { ...p, version: 2 },
      { ...p, matches: [p.matches[0], p.matches[0]] },
      { ...p, matches: [] },
    ])
      expect((await rpc('offline_put', { package: invalid })).status).toBe(400);
    expect((await rpc('offline_get', { leagueId: p.leagueId, season: p.season })).body).toEqual(p);
  });
  it('serves an empty event center and validates mark-read requests', async () => {
    expect(await rpc('event_center_list')).toEqual({ status: 200, body: [] });
    expect(await rpc('event_center_mark_read', { ids: [] })).toEqual({ status: 200, body: null });
    expect((await rpc('event_center_mark_read', { ids: [1] })).status).toBe(400);
  });
  it('persists idempotent updates with native response shapes and isolated seasons', async () => {
    expect((await rpc('history_upsert', { batch })).body).toEqual({
      leagueId: 'l',
      leagueName: 'League',
      season: '2026',
      matches: 1,
    });
    expect((await rpc('history_season_matches', { leagueId: 'l', season: '2026' })).body).toEqual([
      { ...match, homeScore: -1, awayScore: -1, leagueId: 'l', season: '2026' },
    ]);
    await rpc('history_upsert', {
      batch: {
        ...batch,
        matches: [
          { ...match, homeScore: 2, awayScore: 1, status: 'finished', homeName: 'Changed' },
        ],
      },
    });
    await rpc('history_upsert', {
      batch: { ...batch, season: '2025', matches: [{ ...match, homeId: 'c', awayId: 'd' }] },
    });
    expect((await rpc('history_seasons')).body).toEqual([
      { leagueId: 'l', leagueName: 'League', season: '2026', matches: 1 },
      { leagueId: 'l', leagueName: 'League', season: '2025', matches: 1 },
    ]);
    expect((await rpc('history_team_matches', { teamId: 'a', finishedOnly: true })).body).toEqual([
      { ...match, leagueId: 'l', season: '2026', homeScore: 2, awayScore: 1, status: 'finished' },
    ]);
    expect((await rpc('history_head_to_head', { teamA: 'b', teamB: 'a' })).body).toHaveLength(1);
    expect(
      new HistoryStore(join(dir, 'history.json')).dispatch('history_seasons', {}),
    ).toHaveLength(2);
  });
  it('rejects invalid command arguments as HTTP 400', async () => {
    for (const [command, args] of [
      ['history_upsert', { batch: { ...batch, matches: [] } }],
      ['history_upsert', { batch: { ...batch, matches: [{ ...match, homeScore: '2' }] } }],
      ['history_team_matches', { teamId: 'a' }],
      ['history_head_to_head', { teamA: ' ', teamB: 'b' }],
      ['history_season_matches', { leagueId: 'l' }],
    ] as const)
      expect((await rpc(command, args)).status).toBe(400);
  });
});
