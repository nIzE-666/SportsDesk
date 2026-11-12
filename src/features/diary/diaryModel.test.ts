import { expect, it } from 'vitest';
import {
  diaryFixture,
  diaryFootballEntry,
  diaryMatch,
  diaryRaceEntry,
} from '../../test/fixtures/diary';
import {
  diaryEventKey,
  diaryFilterActive,
  diaryFilterControls,
  diaryReadError,
  diarySeasons,
  diaryTiles,
  EMPTY_DIARY_FILTER,
  filterDiary,
  footballDiaryEvent,
  isDiaryEntry,
  MAX_DIARY_BYTES,
  MAX_DIARY_ENTRIES,
  mergeDiary,
  newDiaryEntry,
  parseDiary,
  parseDiaryText,
  parseTags,
  summarizeDiary,
  todayInTimezone,
  validDay,
  withDiaryEntry,
  type DiaryEntry,
  type DiaryFilter,
} from './diaryModel';
const filter: DiaryFilter = { sport: 'All', from: '', to: '', season: 'All', tag: '', query: '' };
const manual = (i: number): DiaryEntry => ({
  ...diaryFootballEntry,
  id: `manual:${i}`,
  event: { ...diaryFootballEntry.event, reference: null },
});
it('uses provider identity independently of names and result corrections', () => {
  const a = footballDiaryEvent(diaryMatch),
    b = footballDiaryEvent({
      ...diaryMatch,
      home_team: { ...diaryMatch.home_team, name: 'New name' },
      score_home: 9,
    });
  expect(diaryEventKey(a)).toBe(diaryEventKey(b));
  expect(a.title).toBe('Arsenal — Chelsea');
  expect(JSON.stringify(a)).not.toContain('score');
});
it('distinguishes seasons, F1 rounds and manual records without inventing provider links', () => {
  expect(diaryEventKey(diaryFootballEntry.event)).not.toBe(diaryEventKey(diaryRaceEntry.event));
  expect(
    diaryEventKey({
      ...diaryRaceEntry.event,
      reference: { kind: 'f1', season: '2025', round: '3' },
    }),
  ).not.toBe(diaryEventKey(diaryRaceEntry.event));
  expect(diaryEventKey(manual(1).event)).toBeNull();
  expect(isDiaryEntry(manual(1))).toBe(true);
});
it('keeps a real missing rating separate from the minimum rating', () => {
  expect(isDiaryEntry({ ...diaryFootballEntry, rating: null })).toBe(true);
  expect(isDiaryEntry({ ...diaryFootballEntry, rating: 1 })).toBe(true);
  expect(isDiaryEntry({ ...diaryFootballEntry, rating: 0 })).toBe(false);
  expect(isDiaryEntry({ ...diaryFootballEntry, rating: 11 })).toBe(false);
});
it('deduplicates edited events without changing the old snapshot in place', () => {
  const old = JSON.stringify(diaryFixture),
    next = withDiaryEntry(diaryFixture, { ...diaryFootballEntry, note: 'Исправленная заметка' });
  expect(next.entries).toHaveLength(2);
  expect(next.entries[0]?.note).toBe('Исправленная заметка');
  expect(JSON.stringify(diaryFixture)).toBe(old);
});
it('filters by watched date, sport, season, tag and private note with inclusive dates', () => {
  expect(
    filterDiary(diaryFixture.entries, { ...filter, from: '2026-11-09', to: '2026-11-09' }).map(
      (e) => e.event.sport,
    ),
  ).toEqual(['f1']);
  expect(
    filterDiary(diaryFixture.entries, {
      ...filter,
      sport: 'football',
      season: '2026/2027',
      tag: 'ДРУЗЬЯ',
      query: 'перерыва',
    }),
  ).toEqual([diaryFootballEntry]);
  expect(filterDiary(diaryFixture.entries, { ...filter, to: '2026-11-07' })).toEqual([]);
});
it('groups personal statistics by sport and season and excludes missing ratings from the average', () => {
  const stats = diarySeasons([diaryFootballEntry, { ...manual(1), rating: null }, diaryRaceEntry]);
  expect(stats.find((s) => s.sport === 'football')).toMatchObject({
    season: '2026/2027',
    count: 2,
    rated: 1,
    average: 8,
  });
  expect(diarySeasons([{ ...manual(2), rating: null }])[0]?.average).toBeNull();
});
it('handles leap days and rejects invalid calendar dates', () => {
  expect(validDay('2024-02-29')).toBe(true);
  expect(validDay('2026-02-29')).toBe(false);
  expect(validDay('2026-13-01')).toBe(false);
  expect(validDay('2026-2-1')).toBe(false);
});
it('defaults to the user timezone rather than the execution hosts date', () => {
  const now = new Date('2026-11-08T18:00:00Z');
  expect(todayInTimezone('Asia/Yakutsk', now)).toBe('2026-11-09');
  expect(todayInTimezone('UTC', now)).toBe('2026-11-08');
});
it('cleans case-insensitive duplicate tags but refuses excess or overlong tags', () => {
  expect(parseTags(' Друзья, тактика, друзья, ')).toEqual(['Друзья', 'тактика']);
  expect(() => parseTags(Array.from({ length: 9 }, (_, i) => `тег ${i}`).join(','))).toThrow(
    'до 8',
  );
  expect(() => parseTags('а'.repeat(31))).toThrow('30 символов');
});
it('round-trips the format and rejects duplicate IDs and inconsistent references', () => {
  expect(parseDiaryText(JSON.stringify(diaryFixture))).toEqual(diaryFixture);
  expect(parseDiary({ version: 1, entries: [diaryFootballEntry, diaryFootballEntry] })).toBeNull();
  expect(isDiaryEntry({ ...diaryFootballEntry, id: 'wrong' })).toBe(false);
  expect(
    isDiaryEntry({ ...diaryFootballEntry, event: { ...diaryFootballEntry.event, sport: 'f1' } }),
  ).toBe(false);
});
it('refuses future or damaged formats before restoration', () => {
  expect(parseDiaryText('{bad')).toBeNull();
  expect(parseDiary({ version: 2, entries: [] })).toBeNull();
  expect(diaryReadError(JSON.stringify({ version: 2, entries: [] }))).toContain(
    'Обновите приложение',
  );
  expect(parseDiaryText(' '.repeat(MAX_DIARY_BYTES + 1) + JSON.stringify(diaryFixture))).toBeNull();
});
it('preserves current notes on import until replacement is explicitly requested', () => {
  const changed = {
    version: 1 as const,
    entries: [{ ...diaryFootballEntry, note: 'Из файла' }, manual(1)],
  };
  expect(
    mergeDiary(diaryFixture, changed, false).entries.find((e) => e.id === diaryFootballEntry.id)
      ?.note,
  ).toBe(diaryFootballEntry.note);
  const next = mergeDiary(diaryFixture, changed, true);
  expect(next.entries).toHaveLength(3);
  expect(next.entries.find((e) => e.id === diaryFootballEntry.id)?.note).toBe('Из файла');
  expect(mergeDiary(diaryFixture, diaryFixture, false).entries).toHaveLength(2);
});
it('never prunes private entries when the size or count limit is reached', () => {
  const full = {
    version: 1 as const,
    entries: Array.from({ length: MAX_DIARY_ENTRIES }, (_, i) => manual(i)),
  };
  expect(() => withDiaryEntry(full, manual(MAX_DIARY_ENTRIES))).toThrow('Сначала экспортируйте');
  expect(full.entries).toHaveLength(MAX_DIARY_ENTRIES);
  const huge = {
    version: 1 as const,
    entries: Array.from({ length: 150 }, (_, i) => ({ ...manual(i), note: 'я'.repeat(1500) })),
  };
  expect(() => mergeDiary({ version: 1, entries: [] }, huge, false)).toThrow('заполнен');
});
it('creates a manual note only when called explicitly and keeps its snapshot self-contained', () => {
  const event = { ...diaryFootballEntry.event, reference: null };
  const e = newDiaryEntry(event, '2026-11-09', 'manual-id', '2026-11-09T00:00:00Z');
  expect(e.id).toBe('manual:manual-id');
  expect(e.rating).toBeNull();
  expect(e.event).not.toBe(event);
  expect(isDiaryEntry(e)).toBe(true);
});

const football = (i: number, patch: Partial<DiaryEntry> = {}): DiaryEntry => ({
  ...diaryFootballEntry,
  id: `manual:f${i}`,
  event: { ...diaryFootballEntry.event, reference: null },
  ...patch,
});
it('knows when a filter is set and what an empty one looks like', () => {
  expect(diaryFilterActive(EMPTY_DIARY_FILTER)).toBe(false);
  expect(diaryFilterActive({ ...EMPTY_DIARY_FILTER, tag: 'тактика' })).toBe(true);
  expect(diaryFilterActive({ ...EMPTY_DIARY_FILTER, query: ' ' })).toBe(true);
  expect(diaryFilterActive({ ...EMPTY_DIARY_FILTER, sport: 'f1' })).toBe(true);
});
it('offers no filter that cannot change a list of one saved view', () => {
  expect(diaryFilterControls([diaryFootballEntry], filter)).toEqual({
    sport: false,
    seasons: [],
    dates: false,
    tags: [],
    search: false,
  });
});
it('offers only the filters that split several views of one sport, season and day', () => {
  const same = [
    football(1, { tags: [] }),
    football(2, { tags: ['тактика'] }),
    football(3, { tags: [] }),
  ];
  expect(diaryFilterControls(same, filter)).toEqual({
    sport: false,
    seasons: [],
    dates: false,
    tags: ['тактика'],
    search: true,
  });
  // A tag held by every view splits nothing.
  const shared = [football(1), football(2)].map((e) => ({ ...e, tags: ['друзья'] }));
  expect(diaryFilterControls(shared, filter).tags).toEqual([]);
});
it('offers sport, season and date filters when the views differ in them', () => {
  const controls = diaryFilterControls(diaryFixture.entries, filter);
  expect(controls.sport).toBe(true);
  expect(controls.seasons).toEqual(['2026/2027', '2026']);
  expect(controls.dates).toBe(true);
  expect(controls.tags).toEqual(['друзья', 'пересмотреть', 'тактика', 'шины']);
  expect(controls.search).toBe(true);
  const later = [football(1), football(2, { watchedOn: '2026-11-10' })];
  expect(diaryFilterControls(later, filter).dates).toBe(true);
  const undated = [football(1), football(2, { event: { ...football(2).event, season: null } })];
  expect(diaryFilterControls(undated, filter).seasons).toEqual(['Unknown', '2026/2027']);
});
it('keeps a control visible while its value is set', () => {
  const one = [diaryFootballEntry];
  expect(diaryFilterControls(one, { ...filter, sport: 'f1' }).sport).toBe(true);
  expect(diaryFilterControls(one, { ...filter, from: '2026-11-01' }).dates).toBe(true);
  expect(diaryFilterControls(one, { ...filter, query: 'xyz' }).search).toBe(true);
  expect(diaryFilterControls(one, { ...filter, season: '2020' }).seasons).toEqual(['2026/2027']);
  expect(diaryFilterControls(one, { ...filter, tag: 'тактика' }).tags).toEqual([
    'друзья',
    'тактика',
  ]);
});
it('does not offer tags of views whose result is hidden', () => {
  const hidden = (e: DiaryEntry) => e.id === diaryFootballEntry.id;
  expect(diaryFilterControls(diaryFixture.entries, filter, hidden).tags).toEqual([
    'пересмотреть',
    'шины',
  ]);
});
it('counts views by sport and averages only open, rated views', () => {
  const summary = summarizeDiary(diaryFixture.entries);
  expect(summary).toEqual({ total: 2, football: 1, f1: 1, rated: 2, average: 8.5 });
  const hiddenFootball = summarizeDiary(diaryFixture.entries, [diaryRaceEntry]);
  expect(hiddenFootball).toEqual({ total: 2, football: 1, f1: 1, rated: 1, average: 9 });
  expect(summarizeDiary([football(1, { rating: null })]).average).toBeNull();
  expect(summarizeDiary([])).toEqual({ total: 0, football: 0, f1: 0, rated: 0, average: null });
});
it('shows tiles only for values that say something', () => {
  const ids = (entries: DiaryEntry[]) => diaryTiles(summarizeDiary(entries)).map((t) => t.id);
  expect(ids([])).toEqual([]);
  expect(ids([diaryFootballEntry])).toEqual([]);
  expect(ids(diaryFixture.entries)).toEqual(['total', 'football', 'f1', 'average']);
  // One sport: no zero tile and no sport tile that repeats the total.
  expect(ids([football(1), football(2)])).toEqual(['total', 'average']);
  // Nothing rated: no dash tile, and a lone total is not worth a tile row.
  const unrated = [football(1, { rating: null }), football(2, { rating: null })];
  expect(ids(unrated)).toEqual([]);
  const mixed = [football(1, { rating: null }), { ...diaryRaceEntry, rating: null }];
  expect(ids(mixed)).toEqual(['total', 'football', 'f1']);
  expect(diaryTiles(summarizeDiary(diaryFixture.entries)).find((t) => t.id === 'average')).toEqual({
    id: 'average',
    value: 8.5,
  });
});
