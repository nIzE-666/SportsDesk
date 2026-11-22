// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiReply } from '../../lib/bridge';
import { LEAGUES } from '../../lib/navigationMetadata';
import { getHealthSnapshot, recordFailure } from '../../lib/resourceHealth';
import { CUP_COMPETITIONS } from '../ucl/cupMetadata';
import { useHomeWeek, type HomeWeekData } from './useHomeWeek';
import { archiveEvents, readArchivedEvents } from './weekArchive';
import { FOLLOWED_COMPETITION_IDS } from './weekData';

vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));

const NOW = Date.parse('2026-11-16T12:00:00Z');
const EPL = LEAGUES[0].id;
const SERIE_A = LEAGUES[2].id;
const UCL = CUP_COMPETITIONS[0]!.id;

let host: HTMLDivElement;
let root: Root;
let current: HomeWeekData;

function Probe({ now }: { now: number }) {
  current = useHomeWeek(now);
  return null;
}

function reply(payload: unknown, extra: Partial<ApiReply> = {}): ApiReply {
  return {
    source: 'pitch',
    payload,
    fetchedAt: '2026-11-16T12:00:00Z',
    stale: false,
    ...extra,
  };
}

function fixture(
  id: string,
  leagueId: string,
  timeUtc: string,
  status = 'finished',
  leagueName = 'League',
) {
  return {
    id,
    league: { id: leagueId, name: leagueName },
    home_team: { id: `home-${id}`, name: `Home ${id}` },
    away_team: { id: `away-${id}`, name: `Away ${id}` },
    status,
    time_utc: timeUtc,
    score_home: status === 'finished' ? 1 : null,
    score_away: status === 'finished' ? 0 : null,
    round_name: '1',
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(turns = 100) {
  await act(async () => {
    for (let index = 0; index < turns; index += 1) await Promise.resolve();
  });
}

async function drainDates(
  pending: Map<string, Deferred<ApiReply>>,
  matchesFor: (path: string) => unknown[] = () => [],
) {
  for (let wave = 0; wave < 40; wave += 1) {
    const entries = [...pending.entries()];
    if (entries.length === 0) break;
    await act(async () => {
      for (const [path, request] of entries) {
        pending.delete(path);
        request.resolve(reply({ data: { matches: matchesFor(path) } }));
      }
      await Promise.resolve();
    });
  }
}

async function drainEvents(
  pending: Map<string, Deferred<ApiReply>>,
  responseFor: (path: string) => ApiReply | Error,
) {
  for (let wave = 0; wave < 20; wave += 1) {
    const entries = [...pending.entries()];
    if (entries.length === 0) break;
    await act(async () => {
      for (const [path, request] of entries) {
        pending.delete(path);
        const response = responseFor(path);
        if (response instanceof Error) request.reject(response);
        else request.resolve(response);
      }
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  localStorage.setItem('sportsdesk.timezone', 'UTC');
  vi.mocked(api).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('useHomeWeek', () => {
  it('refreshes a loaded season and retains its original timestamp when the refresh fails', async () => {
    const seasonPath = `leagues/${EPL}/matches?status=all`;
    let version = 0;
    vi.mocked(api).mockImplementation(async (_source, path) => {
      if (path !== seasonPath) return reply({ data: { matches: [] } });
      version += 1;
      if (version === 2) throw new Error('Нет связи.');
      return reply(
        { data: { matches: [fixture(`season-${version}`, EPL, '2026-10-01T12:00:00Z')] } },
        {
          fetchedAt: version === 1 ? '2026-11-15T20:00:00Z' : '2026-11-16T12:00:00Z',
          stale: version === 1,
        },
      );
    });
    await act(async () => root.render(<Probe now={NOW} />));
    await flush();
    await act(async () => current.reload());
    await flush();
    expect(version).toBe(2);
    expect(current.stale).toBe(true);
    expect(current.fetchedAt).toBe('2026-11-15T20:00:00Z');
    expect(current.seasonMatches[EPL]?.[0]?.id).toBe('season-1');

    await act(async () => current.reload());
    await flush();
    expect(current.seasonMatches[EPL]?.[0]?.id).toBe('season-3');
    expect(current.stale).toBe(false);
    expect(current.fetchedAt).toBe('2026-11-16T12:00:00Z');
  });

  it('releases failed day resources and skips queued requests after leaving Home', async () => {
    const requests = new Map<string, Deferred<ApiReply>>();
    vi.mocked(api).mockImplementation((source, path) => {
      if (path.startsWith('date/')) {
        const request = deferred<ApiReply>();
        requests.set(path, request);
        return request.promise.catch((error) => {
          recordFailure(source, path, error);
          throw error;
        });
      }
      return Promise.resolve(reply({ data: { matches: [] } }));
    });
    await act(async () => root.render(<Probe now={NOW} />));
    const [failedPath, request] = [...requests.entries()][0]!;
    requests.delete(failedPath);
    await act(async () => request.reject(new Error('Нет связи.')));
    expect(getHealthSnapshot().failures.map(({ key }) => key)).toContain(`pitch:${failedPath}`);
    const requestCount = vi.mocked(api).mock.calls.length;

    await act(async () => root.render(null));
    await drainDates(requests);
    await flush();
    expect(getHealthSnapshot().failures.map(({ key }) => key)).not.toContain(`pitch:${failedPath}`);
    expect(vi.mocked(api)).toHaveBeenCalledTimes(requestCount);
  });

  it('discards legacy archives without a usable scoring sequence', () => {
    const match = fixture('incomplete', EPL, new Date().toISOString());
    const date = new Date().toISOString().slice(0, 10);
    const key = `sportsdesk.home.archive.events.${date}.${match.id}`;
    const missingTeam = { event_type: 'goal', minute: 8 };
    localStorage.setItem(key, JSON.stringify({ result: '1:0', events: [missingTeam] }));
    expect(readArchivedEvents(match)).toBeNull();

    const goal = { ...missingTeam, team_id: match.home_team.id };
    archiveEvents(match, [goal]);
    expect(readArchivedEvents(match)).toEqual([goal]);
  });

  it('shows a day as soon as its reply arrives and fills the rest progressively', async () => {
    const pendingDates = new Map<string, Deferred<ApiReply>>();
    vi.mocked(api).mockImplementation((_source, path) => {
      if (path.startsWith('date/')) {
        const request = deferred<ApiReply>();
        pendingDates.set(path, request);
        return request.promise;
      }
      if (path.startsWith('leagues/')) return Promise.resolve(reply({ data: { matches: [] } }));
      return Promise.resolve(reply({ data: { events: [{ event_type: 'goal', minute: 11 }] } }));
    });

    await act(async () => root.render(<Probe now={NOW} />));
    expect(pendingDates.size).toBe(4);

    const firstPath = [...pendingDates.keys()][0]!;
    const target = fixture('progressive', EPL, '2026-11-16T18:00:00Z');
    const firstRequest = pendingDates.get(firstPath)!;
    pendingDates.delete(firstPath);
    await act(async () => {
      firstRequest.resolve(reply({ data: { matches: [target] } }));
      await Promise.resolve();
    });
    expect(
      current.days.find((day) => day.date === '2026-11-16')?.matches.map((item) => item.summary.id),
    ).toContain('progressive');
    expect(current.events.progressive?.status).toBe('pending');
    expect(current.loading).toBe(true);

    await drainDates(pendingDates);
    await flush();
    expect(current.events.progressive?.status).toBe('loaded');
    expect(current.events.progressive?.events).toHaveLength(1);
    expect(current.progress).toEqual({ loaded: 1, total: 1, label: 'загружено 1 из 1' });
    expect(current.loading).toBe(false);
  });

  it('leaves out same-name leagues from other countries', async () => {
    const matches = [
      fixture('followed-serie-a', SERIE_A, '2026-11-15T18:00:00Z', 'finished', 'Serie A'),
      fixture('brazil-serie-a', 'foreign-brazil', '2026-11-15T18:00:00Z', 'finished', 'Serie A'),
      fixture('ecuador-serie-a', 'foreign-ecuador', '2026-11-15T19:00:00Z', 'finished', 'Serie A'),
      fixture(
        'canada-premier',
        'foreign-canada',
        '2026-11-15T20:00:00Z',
        'finished',
        'Premier League',
      ),
      fixture(
        'austria-bundesliga',
        'foreign-austria',
        '2026-11-15T20:00:00Z',
        'finished',
        'Bundesliga',
      ),
      fixture('followed-premier', EPL, '2026-11-16T20:00:00Z', 'finished', 'Premier League'),
    ];
    vi.mocked(api).mockImplementation((_source, path) => {
      if (path.startsWith('date/')) return Promise.resolve(reply({ data: { matches } }));
      if (path.startsWith('leagues/')) return Promise.resolve(reply({ data: { matches: [] } }));
      return Promise.resolve(reply({ data: { events: [{ event_type: 'goal', minute: 1 }] } }));
    });

    await act(async () => root.render(<Probe now={NOW} />));
    await flush();

    const visible = current.days.flatMap((day) => day.matches.map((item) => item.summary.id));
    expect(visible.sort()).toEqual(['followed-premier', 'followed-serie-a']);
    expect(visible).not.toContain('brazil-serie-a');
    expect(visible).not.toContain('ecuador-serie-a');
    expect(visible).not.toContain('canada-premier');
    expect(visible).not.toContain('austria-bundesliga');
    const eventPaths = vi
      .mocked(api)
      .mock.calls.map(([, path]) => path)
      .filter((path) => path.startsWith('matches/'));
    expect(eventPaths.some((path) => path.includes('brazil-serie-a'))).toBe(false);
    expect(eventPaths).toHaveLength(2);
  });

  it('runs no more than four event requests at a time', async () => {
    const matches = Array.from({ length: 8 }, (_, index) =>
      fixture(`event-${index}`, EPL, `2026-11-1${(index % 6) + 1}T${10 + index}:00:00Z`),
    );
    const pendingEvents = new Map<string, Deferred<ApiReply>>();
    let active = 0;
    let maxActive = 0;
    vi.mocked(api).mockImplementation((_source, path) => {
      if (path.startsWith('date/')) return Promise.resolve(reply({ data: { matches } }));
      if (path.startsWith('leagues/')) return Promise.resolve(reply({ data: { matches: [] } }));
      active += 1;
      maxActive = Math.max(maxActive, active);
      const request = deferred<ApiReply>();
      request.promise.then(
        () => {
          active -= 1;
        },
        () => {
          active -= 1;
        },
      );
      pendingEvents.set(path, request);
      return request.promise;
    });

    await act(async () => root.render(<Probe now={NOW} />));
    await flush();
    expect(maxActive).toBe(4);
    expect(pendingEvents.size).toBeGreaterThan(0);

    await drainEvents(pendingEvents, () =>
      reply({ data: { events: [{ event_type: 'goal', minute: 1 }] } }),
    );
    await flush();
    expect(maxActive).toBe(4);
    expect(current.progress).toEqual({ loaded: 8, total: 8, label: 'загружено 8 из 8' });
  });

  it('marks a failed events request as unknown and keeps the other matches going', async () => {
    const matches = [
      fixture('good', EPL, '2026-11-15T18:00:00Z'),
      fixture('missing', SERIE_A, '2026-11-15T19:00:00Z'),
      fixture('bad', UCL, '2026-11-15T20:00:00Z'),
    ];
    vi.mocked(api).mockImplementation((_source, path) => {
      if (path.startsWith('date/')) return Promise.resolve(reply({ data: { matches } }));
      if (path.startsWith('leagues/')) return Promise.resolve(reply({ data: { matches: [] } }));
      if (path.includes('/good/events'))
        return Promise.resolve(reply({ data: { events: [{ event_type: 'goal', minute: 9 }] } }));
      if (path.includes('/missing/events')) return Promise.resolve(reply({ data: { events: [] } }));
      return Promise.reject(new Error('Нет связи с источником.'));
    });

    await act(async () => root.render(<Probe now={NOW} />));
    await flush();

    expect(current.events.good?.status).toBe('loaded');
    expect(current.events.missing?.status).toBe('missing');
    expect(current.events.bad?.status).toBe('failed');
    expect(current.events.bad?.events).toEqual([]);
    expect(current.events.bad?.error).toBe('Нет связи с источником.');
    expect(current.errors).toContainEqual({
      scope: 'events',
      key: 'bad',
      message: 'Нет связи с источником.',
    });
    expect(current.progress).toEqual({ loaded: 1, total: 3, label: 'загружено 1 из 3' });
  });

  it('keeps postponed and cancelled matches out of the events queue', async () => {
    const matches = [
      fixture('finished', EPL, '2026-11-15T18:00:00Z'),
      fixture('postponed', EPL, '2026-11-15T19:00:00Z', 'postponed'),
      fixture('cancelled', EPL, '2026-11-15T20:00:00Z', 'cancelled'),
    ];
    vi.mocked(api).mockImplementation((_source, path) => {
      if (path.startsWith('date/')) return Promise.resolve(reply({ data: { matches } }));
      if (path.startsWith('leagues/')) return Promise.resolve(reply({ data: { matches: [] } }));
      return Promise.resolve(reply({ data: { events: [{ event_type: 'goal', minute: 1 }] } }));
    });

    await act(async () => root.render(<Probe now={NOW} />));
    await flush();

    const day = current.days.find((item) => item.date === '2026-11-15');
    expect(day?.matches.map((item) => [item.summary.id, item.state])).toEqual([
      ['finished', 'finished'],
      ['postponed', 'postponed'],
      ['cancelled', 'cancelled'],
    ]);
    expect(Object.keys(current.events)).toEqual(['finished']);
    const eventPaths = vi
      .mocked(api)
      .mock.calls.map(([, path]) => path)
      .filter((path) => path.startsWith('matches/'));
    expect(eventPaths.some((path) => path.includes('postponed'))).toBe(false);
    expect(eventPaths.some((path) => path.includes('cancelled'))).toBe(false);
  });

  it('loads season matches once per followed competition', async () => {
    vi.mocked(api).mockImplementation((_source, path) => {
      if (path.startsWith('date/')) return Promise.resolve(reply({ data: { matches: [] } }));
      if (path.startsWith('leagues/'))
        return Promise.resolve(
          reply({ data: { matches: [fixture('season-match', EPL, '2026-10-01T12:00:00Z')] } }),
        );
      return Promise.resolve(reply({ data: { events: [] } }));
    });

    await act(async () => root.render(<Probe now={NOW} />));
    await flush();
    const seasonCalls = () =>
      vi
        .mocked(api)
        .mock.calls.map(([, path]) => path)
        .filter((path) => path.startsWith('leagues/'));
    expect(seasonCalls()).toHaveLength(FOLLOWED_COMPETITION_IDS.length);
    for (const leagueId of FOLLOWED_COMPETITION_IDS)
      expect(seasonCalls().filter((path) => path.startsWith(`leagues/${leagueId}/`))).toHaveLength(
        1,
      );
    expect(current.seasonMatches[EPL]?.map((item) => item.id)).toEqual(['season-match']);

    await act(async () => root.render(<Probe now={NOW + 60_000} />));
    await flush();
    expect(seasonCalls()).toHaveLength(FOLLOWED_COMPETITION_IDS.length);
  });

  it('uses cached replies when the source is offline and keeps their timestamp', async () => {
    let dateCalls = 0;
    const cached = fixture('cached-match', EPL, '2026-11-15T18:00:00Z');
    vi.mocked(api).mockImplementation((_source, path) => {
      if (path.startsWith('date/')) {
        dateCalls += 1;
        if (dateCalls === 1) return Promise.reject(new Error('Нет связи с источником.'));
        return Promise.resolve(
          reply(
            { data: { matches: [cached] } },
            { stale: true, fetchedAt: '2026-11-15T20:00:00Z' },
          ),
        );
      }
      if (path.startsWith('leagues/'))
        return Promise.resolve(
          reply(
            { data: { matches: [fixture('cached-season', EPL, '2026-10-01T12:00:00Z')] } },
            { stale: true, fetchedAt: '2026-11-15T20:00:00Z' },
          ),
        );
      return Promise.resolve(
        reply(
          { data: { events: [{ event_type: 'goal', minute: 1 }] } },
          { stale: true, fetchedAt: '2026-11-15T20:00:00Z' },
        ),
      );
    });

    await act(async () => root.render(<Probe now={NOW} />));
    await flush();

    expect(current.stale).toBe(true);
    expect(current.fetchedAt).toBe('2026-11-15T20:00:00Z');
    expect(current.days.flatMap((day) => day.matches.map((item) => item.summary.id))).toContain(
      'cached-match',
    );
    expect(current.seasonMatches[EPL]?.map((item) => item.id)).toEqual(['cached-season']);
    expect(current.events['cached-match']?.status).toBe('loaded');
    expect(current.errors).toContainEqual({
      scope: 'day',
      key: expect.any(String),
      message: 'Нет связи с источником.',
    });
    expect(current.loading).toBe(false);
  });

  it('asks for the UTC dates of the local window on both sides of midnight in UTC+9', async () => {
    localStorage.setItem('sportsdesk.timezone', 'Asia/Tokyo');
    vi.mocked(api).mockImplementation((_source, path) => {
      if (path.startsWith('date/')) return Promise.resolve(reply({ data: { matches: [] } }));
      if (path.startsWith('leagues/')) return Promise.resolve(reply({ data: { matches: [] } }));
      return Promise.resolve(reply({ data: { events: [] } }));
    });

    await act(async () => root.render(<Probe now={Date.parse('2026-11-16T14:59:00Z')} />));
    await flush();
    const before = vi
      .mocked(api)
      .mock.calls.map(([, path]) => path)
      .filter((path) => path.startsWith('date/'));
    expect(before[0]).toBe('date/2026-11-08?status=all');
    expect(before.at(-1)).toBe('date/2026-11-23?status=all');
    expect(before).toHaveLength(16);

    vi.mocked(api).mockClear();
    await act(async () => root.render(<Probe now={Date.parse('2026-11-16T15:00:00Z')} />));
    await flush();
    const after = vi
      .mocked(api)
      .mock.calls.map(([, path]) => path)
      .filter((path) => path.startsWith('date/'));
    expect(after[0]).toBe('date/2026-11-09?status=all');
    expect(after.at(-1)).toBe('date/2026-11-24?status=all');
    expect(after).toHaveLength(16);
  });
});
