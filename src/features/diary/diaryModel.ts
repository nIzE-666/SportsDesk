import type { MatchDetail } from '../football/types';
import type { JolpicaRace } from '../f1/types';

export const DIARY_KEY = 'sportsdesk.view.diary';
export const DIARY_VERSION = 1;
export const MAX_DIARY_ENTRIES = 500;
export const MAX_DIARY_BYTES = 190_000;
export type DiarySport = 'football' | 'f1';
export type DiaryReference =
  | { kind: 'football'; matchId: string; leagueId: string | null }
  | { kind: 'f1'; season: string; round: string };
export interface DiaryEvent {
  sport: DiarySport;
  title: string;
  season: string | null;
  eventDate: string | null;
  reference: DiaryReference | null;
}
export interface DiaryEntry {
  id: string;
  event: DiaryEvent;
  watchedOn: string;
  note: string;
  tags: string[];
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface DiaryStore {
  version: 1;
  entries: DiaryEntry[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const nonempty = (v: unknown, max = 160): v is string => text(v, max) && !!v.trim();
export function validDay(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
const timestamp = (v: unknown): v is string =>
  text(v, 40) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const fold = (v: string) => v.trim().toLocaleLowerCase('ru-RU');
export function diaryEventKey(event: DiaryEvent): string | null {
  const ref = event.reference;
  return ref
    ? JSON.stringify(
        ref.kind === 'football' ? ['football', ref.matchId] : ['f1', ref.season, ref.round],
      )
    : null;
}
export function validDiaryEvent(v: unknown): v is DiaryEvent {
  if (
    !record(v) ||
    !['football', 'f1'].includes(String(v.sport)) ||
    !nonempty(v.title, 200) ||
    !(v.season === null || nonempty(v.season, 30)) ||
    !(v.eventDate === null || validDay(v.eventDate) || timestamp(v.eventDate))
  )
    return false;
  const ref = v.reference;
  if (ref === null) return true;
  if (!record(ref)) return false;
  if (ref.kind === 'football')
    return (
      v.sport === 'football' &&
      nonempty(ref.matchId) &&
      (ref.leagueId === null || nonempty(ref.leagueId))
    );
  return (
    ref.kind === 'f1' &&
    v.sport === 'f1' &&
    typeof ref.season === 'string' &&
    /^\d{4}$/.test(ref.season) &&
    typeof ref.round === 'string' &&
    /^[1-9]\d?$/.test(ref.round)
  );
}
export function isDiaryEntry(v: unknown): v is DiaryEntry {
  if (
    !record(v) ||
    !nonempty(v.id, 400) ||
    !validDiaryEvent(v.event) ||
    !validDay(v.watchedOn) ||
    !text(v.note, 1500) ||
    !timestamp(v.createdAt) ||
    !timestamp(v.updatedAt) ||
    !(
      v.rating === null ||
      (typeof v.rating === 'number' &&
        Number.isInteger(v.rating) &&
        v.rating >= 1 &&
        v.rating <= 10)
    ) ||
    !Array.isArray(v.tags) ||
    v.tags.length > 8 ||
    !v.tags.every((t) => nonempty(t, 30) && !/[\r\n]/.test(t))
  )
    return false;
  if (new Set(v.tags.map(fold)).size !== v.tags.length) return false;
  const key = diaryEventKey(v.event);
  return key === null ? /^manual:[a-zA-Z0-9-]{1,80}$/.test(v.id) : v.id === key;
}
export function parseDiary(value: unknown): DiaryStore | null {
  if (
    !record(value) ||
    value.version !== DIARY_VERSION ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_DIARY_ENTRIES
  )
    return null;
  const ids = new Set<string>();
  for (const e of value.entries) {
    if (!isDiaryEntry(e) || ids.has(e.id)) return null;
    ids.add(e.id);
  }
  return { version: DIARY_VERSION, entries: value.entries as DiaryEntry[] };
}
export function parseDiaryText(value: string): DiaryStore | null {
  try {
    return new TextEncoder().encode(value).length <= MAX_DIARY_BYTES
      ? parseDiary(JSON.parse(value))
      : null;
  } catch {
    return null;
  }
}
export const isValidDiaryValue = (value: string) => parseDiaryText(value) !== null;
export function diaryReadError(value: string): string {
  try {
    const data: unknown = JSON.parse(value);
    if (record(data) && typeof data.version === 'number' && data.version > DIARY_VERSION)
      return 'Дневник создан более новой версией SportsDesk. Обновите приложение.';
  } catch {
    /* use recovery hint */
  }
  return 'Дневник повреждён или превышает допустимый размер. Восстановите его из резервной копии.';
}
export function parseTags(value: string): string[] {
  const seen = new Set<string>();
  const tags = value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => {
      const key = fold(t);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (tags.length > 8 || tags.some((t) => t.length > 30 || /[\r\n]/.test(t)))
    throw new Error('Укажите до 8 тегов длиной до 30 символов через запятую.');
  return tags;
}
export function todayInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function newDiaryEntry(
  event: DiaryEvent,
  watchedOn: string,
  manualId: string,
  stamp = new Date().toISOString(),
): DiaryEntry {
  return {
    id: diaryEventKey(event) ?? `manual:${manualId}`,
    event: { ...event, reference: event.reference ? { ...event.reference } : null },
    watchedOn,
    note: '',
    tags: [],
    rating: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
export function footballDiaryEvent(detail: MatchDetail): DiaryEvent {
  const date = detail.time_utc ?? detail.date ?? null;
  return {
    sport: 'football',
    title: `${detail.home_team.name} — ${detail.away_team.name}`,
    season: detail.season ?? detail.league?.season ?? null,
    eventDate: validDay(date) || timestamp(date) ? date : null,
    reference: { kind: 'football', matchId: detail.id, leagueId: detail.league?.id ?? null },
  };
}
export function f1DiaryEvent(race: JolpicaRace): DiaryEvent {
  return {
    sport: 'f1',
    title: race.raceName,
    season: race.season,
    eventDate: validDay(race.date) ? race.date : null,
    reference: { kind: 'f1', season: race.season, round: race.round },
  };
}
function checkedStore(store: DiaryStore): DiaryStore {
  if (!parseDiary(store)) throw new Error('Проверьте поля записи дневника.');
  if (new TextEncoder().encode(JSON.stringify(store)).length > MAX_DIARY_BYTES)
    throw new Error(
      'Дневник заполнен. Экспортируйте записи перед удалением ненужных и повторите сохранение.',
    );
  return store;
}
export function withDiaryEntry(store: DiaryStore, entry: DiaryEntry): DiaryStore {
  if (!isDiaryEntry(entry)) throw new Error('Проверьте название, дату, оценку и теги записи.');
  if (!store.entries.some((e) => e.id === entry.id) && store.entries.length >= MAX_DIARY_ENTRIES)
    throw new Error(
      `Можно сохранить до ${MAX_DIARY_ENTRIES} записей. Сначала экспортируйте дневник и освободите место.`,
    );
  return checkedStore({
    version: DIARY_VERSION,
    entries: [entry, ...store.entries.filter((e) => e.id !== entry.id)],
  });
}
export function mergeDiary(
  store: DiaryStore,
  imported: DiaryStore,
  overwrite: boolean,
): DiaryStore {
  if (!parseDiary(store) || !parseDiary(imported))
    throw new Error('Неподдерживаемый формат дневника.');
  const entries = new Map(store.entries.map((e) => [e.id, e]));
  for (const entry of imported.entries)
    if (overwrite || !entries.has(entry.id)) entries.set(entry.id, entry);
  if (entries.size > MAX_DIARY_ENTRIES)
    throw new Error(`После импорта будет больше ${MAX_DIARY_ENTRIES} записей. Ничего не изменено.`);
  return checkedStore({ version: DIARY_VERSION, entries: [...entries.values()] });
}
export interface DiaryFilter {
  sport: 'All' | DiarySport;
  from: string;
  to: string;
  season: string;
  tag: string;
  query: string;
}
export function filterDiary(entries: DiaryEntry[], f: DiaryFilter): DiaryEntry[] {
  const query = fold(f.query);
  return entries
    .filter(
      (e) =>
        (f.sport === 'All' || e.event.sport === f.sport) &&
        (!f.from || e.watchedOn >= f.from) &&
        (!f.to || e.watchedOn <= f.to) &&
        (f.season === 'All' || (e.event.season ?? 'Unknown') === f.season) &&
        (!f.tag || e.tags.some((t) => fold(t) === fold(f.tag))) &&
        (!query || fold(`${e.event.title} ${e.note} ${e.tags.join(' ')}`).includes(query)),
    )
    .sort(
      (a, b) => b.watchedOn.localeCompare(a.watchedOn) || b.updatedAt.localeCompare(a.updatedAt),
    );
}
export function diarySeasons(entries: DiaryEntry[]) {
  const groups = new Map<
    string,
    { sport: DiarySport; season: string | null; count: number; rated: number; sum: number }
  >();
  for (const e of entries) {
    const key = JSON.stringify([e.event.sport, e.event.season]);
    const group = groups.get(key) ?? {
      sport: e.event.sport,
      season: e.event.season,
      count: 0,
      rated: 0,
      sum: 0,
    };
    group.count++;
    if (e.rating !== null) {
      group.rated++;
      group.sum += e.rating;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, average: g.rated ? g.sum / g.rated : null }))
    .sort(
      (a, b) => (b.season ?? '').localeCompare(a.season ?? '') || a.sport.localeCompare(b.sport),
    );
}
