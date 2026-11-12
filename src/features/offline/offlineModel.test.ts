import { buildOfflineSeason } from './offlineSource';
import { expect, it } from 'vitest';
import {
  offlineMatches,
  readerFilterUseful,
  seasonCoverage,
  validOfflineSeason,
  expectedTeams,
  summarizeSeason,
} from './offlineModel';
import { offlinePayload, offlineSeason, completeOfflineSeason } from '../../test/fixtures/offline';
const build = (v: unknown) =>
  buildOfflineSeason(
    v,
    offlineSeason.leagueId,
    offlineSeason.leagueName,
    offlineSeason.season,
    offlineSeason.fetchedAt,
  );
it('preserves exact UTC times, unknown scores and future fixtures without images', () => {
  const p = build(offlinePayload());
  expect(p).toEqual(offlineSeason);
  expect(offlineMatches(p)[1]?.score_home).toBeNull();
  expect(offlineMatches(p)[0]?.time_utc).toBe('2026-11-08T16:30:00Z');
  expect(summarizeSeason(p).bytes).toBe(new TextEncoder().encode(JSON.stringify(p)).length);
});
it('verifies every directed pairing, not only the record count', () => {
  const p = completeOfflineSeason();
  expect(seasonCoverage(p)).toMatchObject({ state: 'complete', expected: 380, finished: 380 });
  expect(seasonCoverage({ ...p, matches: p.matches.slice(1) }).state).toBe('partial');
  p.matches[0] = { ...p.matches[1]!, id: 'different-id' };
  expect(seasonCoverage(p).state).toBe('partial');
});
it('separates calendar coverage from results and exact kickoff coverage', () => {
  const p = completeOfflineSeason();
  p.matches[0] = { ...p.matches[0]!, homeScore: null, timeUtc: null };
  expect(seasonCoverage(p)).toMatchObject({ state: 'complete', missingScores: 1, missingTimes: 1 });
  p.matches[0].date = '';
  expect(seasonCoverage(p).state).toBe('partial');
});
it('bounds audited formats and treats MLS and future formats as unverified', () => {
  expect(expectedTeams('l_3FJFUl', '2022/2023')).toBe(20);
  expect(expectedTeams('l_3FJFUl', '2023/2024')).toBe(18);
  expect(expectedTeams('l_1Isor4', '2025/2026')).toBe(18);
  for (const [league, season] of [
    ['l_0eg6C9', '2025'],
    ['l_4WFCIZ', '2027/2028'],
    ['l_4WFCIZ', '2021/2027'],
  ])
    expect(seasonCoverage({ ...offlineSeason, leagueId: league!, season: season! }).state).toBe(
      'unverified',
    );
});
it('deduplicates identical stable IDs but rejects conflicting duplicates', () => {
  const v = offlinePayload();
  v.data.matches.push({ ...v.data.matches[0]! });
  expect(build(v)).toMatchObject({ duplicates: 1, matches: offlineSeason.matches });
  v.data.matches[2]!.score_home = 9;
  expect(() => build(v)).toThrow('одинаковым ID');
});
it('refuses wrong-season, malformed and empty responses as a whole', () => {
  for (const v of [
    null,
    [],
    { data: { matches: [] } },
    { data: { league: { id: 'other', season: offlineSeason.season }, matches: [] } },
    offlinePayload({ ...offlineSeason, matches: [] }),
  ])
    expect(() => build(v)).toThrow();
  const v = offlinePayload();
  v.data.matches[1]!.home_team.id = '';
  expect(() => build(v)).toThrow();
});
it('validates unknown versions, duplicate IDs, dates, scores and payload size safely', () => {
  expect(validOfflineSeason(offlineSeason)).toBe(true);
  for (const p of [
    { ...offlineSeason, version: 2 },
    { ...offlineSeason, matches: [offlineSeason.matches[0], offlineSeason.matches[0]] },
    ...['2026-99-99', '2026-02-30'].map((date) => ({
      ...offlineSeason,
      matches: [{ ...offlineSeason.matches[0], date }],
    })),
    { ...offlineSeason, matches: [{ ...offlineSeason.matches[0], homeScore: -1 }] },
    {
      ...offlineSeason,
      matches: Array.from({ length: 2001 }, (_, i) => ({
        ...offlineSeason.matches[0],
        id: String(i),
      })),
    },
  ])
    expect(validOfflineSeason(p)).toBe(false);
});
it('offers the finished/remaining filter only for a package that has both', () => {
  expect(readerFilterUseful([])).toBe(false);
  expect(readerFilterUseful(offlineSeason.matches)).toBe(true);
  expect(readerFilterUseful([offlineSeason.matches[0]!])).toBe(false);
  expect(readerFilterUseful([offlineSeason.matches[1]!])).toBe(false);
  expect(readerFilterUseful(completeOfflineSeason().matches)).toBe(false);
});
