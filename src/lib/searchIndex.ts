import type { FavoritePlayer } from '../features/football/types';
import { getJson, getUserTimezone, setJson, STORAGE_KEYS } from '../features/football/storage';
import { formatHumanDateTime } from './humanDate';

/** «Раздел» targets of the five-section model. Competition stays a parameter. */
export type SearchSectionId =
  | 'today'
  | 'today.week'
  | 'today.plan'
  | 'football.matches'
  | 'football.standings'
  | 'football.team'
  | 'football.players'
  | 'football.live'
  | 'f1'
  | 'watch'
  | 'my.favorites'
  | 'my.diary'
  | 'my.games'
  | 'my.schemes'
  | 'events'
  | 'offline'
  | 'settings';
export type SearchTarget =
  | { kind: 'team'; id: string; leagueId?: string }
  | { kind: 'match'; id: string; leagueId?: string }
  | { kind: 'player'; player: FavoritePlayer }
  | { kind: 'driver'; id: string; year: number }
  | { kind: 'channel'; id: number }
  | { kind: 'section'; id: SearchSectionId };
export interface SearchItem {
  key: string;
  title: string;
  subtitle: string;
  target: SearchTarget;
  aliases?: string;
}
const INDEX_KEY = 'sportsdesk.search.index';
const RECENT_KEY = 'sportsdesk.search.recent';
export const SEARCH_CHANGED = 'sportsdesk-search-changed';
const SEARCH_SECTION_IDS: readonly string[] = [
  'today',
  'today.week',
  'today.plan',
  'football.matches',
  'football.standings',
  'football.team',
  'football.players',
  'football.live',
  'f1',
  'watch',
  'my.favorites',
  'my.diary',
  'my.games',
  'my.schemes',
  'events',
  'offline',
  'settings',
];
/** Old «раздел» ids of 1.7.0/1.8.0, mapped to the same screens. */
const SEARCH_SECTION_ALIASES: Record<string, SearchSectionId> = {
  matches: 'football.matches',
  players: 'football.players',
  f1: 'f1',
  watch: 'watch',
  planner: 'today.plan',
  events: 'events',
};
function migrateSearchSectionId(value: unknown): SearchSectionId | undefined {
  if (typeof value !== 'string') return undefined;
  if (SEARCH_SECTION_IDS.includes(value)) return value as SearchSectionId;
  return SEARCH_SECTION_ALIASES[value];
}
function migrateSearchKey(key: string): string {
  if (!key.startsWith('section:')) return key;
  const id = migrateSearchSectionId(key.slice('section:'.length));
  return id ? `section:${id}` : key;
}
function migrateSearchItem(value: unknown): SearchItem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as SearchItem;
  const target = item.target as SearchTarget | undefined;
  if (target?.kind !== 'section') return validSearchItem(value) ? value : undefined;
  const id = migrateSearchSectionId(target.id);
  if (!id) return undefined;
  return {
    ...item,
    key: `section:${id}`,
    target: { ...target, id },
  };
}
function mergeItem(previous: SearchItem | undefined, next: SearchItem): SearchItem {
  const kind = next.target.kind;
  if ((kind === 'team' || kind === 'match') && previous?.target.kind === kind) {
    const old = previous.target as Extract<SearchTarget, { kind: 'team' | 'match' }>;
    return { ...next, target: { ...next.target, leagueId: next.target.leagueId ?? old.leagueId } };
  }
  return next;
}
const limits: Record<SearchTarget['kind'], number> = {
  team: 300,
  match: 3000,
  player: 300,
  driver: 80,
  channel: 200,
  section: 20,
};
const clean = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 300;
export function validSearchItem(v: unknown): v is SearchItem {
  if (!v || typeof v !== 'object') return false;
  const x = v as SearchItem,
    t = x.target;
  if (
    !clean(x.key) ||
    !clean(x.title) ||
    typeof x.subtitle !== 'string' ||
    x.subtitle.length > 500 ||
    !t
  )
    return false;
  if (t.kind === 'team' || t.kind === 'match')
    return clean(t.id) && (t.leagueId === undefined || clean(t.leagueId));
  if (t.kind === 'driver')
    return (
      clean(t.id) &&
      Number.isInteger(t.year) &&
      t.year >= 2023 &&
      t.year <= new Date().getFullYear()
    );
  if (t.kind === 'channel') return Number.isSafeInteger(t.id) && t.id > 0;
  if (t.kind === 'player')
    return (
      !!t.player &&
      clean(t.player.id) &&
      clean(t.player.name) &&
      clean(t.player.teamId) &&
      typeof t.player.savedAt === 'string'
    );
  return t.kind === 'section' && SEARCH_SECTION_IDS.includes(t.id);
}
export const searchSections: SearchItem[] = [
  ['football.matches', 'Матчи', 'Футбол'],
  ['football.players', 'Игроки', 'Профили и сравнение'],
  ['f1', 'Формула 1', 'Гоночный уикенд'],
  ['watch', 'Каналы', 'Онлайн-просмотр'],
  ['today.plan', 'Мой спортивный вечер', 'Личный план'],
  ['events', 'Центр событий', 'Голы, результаты и напоминания'],
].map(([id, title, subtitle]) => ({
  key: `section:${id}`,
  title: title!,
  subtitle: subtitle!,
  target: { kind: 'section', id: id as SearchSectionId },
}));
function storedSearchItems(): SearchItem[] {
  const raw = getJson<unknown>(INDEX_KEY, []);
  return Array.isArray(raw)
    ? raw
        .map(migrateSearchItem)
        .filter((item): item is SearchItem => item !== undefined)
        .slice(0, 4000)
    : [];
}
export function readSearchIndex(): SearchItem[] {
  const items = storedSearchItems();
  const catalogue = getJson<unknown>(STORAGE_KEYS.catalogue, []);
  if (Array.isArray(catalogue))
    for (const t of catalogue)
      if (clean(t?.id) && clean(t?.name))
        items.push({
          key: `team:${t.id}`,
          title: t.name,
          subtitle: t.leagueName ?? 'Клуб',
          target: { kind: 'team', id: t.id, leagueId: t.leagueId },
        });
  const players = getJson<unknown>(STORAGE_KEYS.favoritePlayers, []);
  if (Array.isArray(players))
    for (const p of players)
      if (p?.id && p?.name && p?.teamId)
        items.push({
          key: `player:${p.id}`,
          title: p.name,
          subtitle: p.teamName ?? 'Футболист',
          target: { kind: 'player', player: p },
        });
  const merged = new Map<string, SearchItem>();
  for (const item of [...items.filter(validSearchItem), ...searchSections])
    merged.set(item.key, mergeItem(merged.get(item.key), item));
  return [...merged.values()];
}
export function rememberSearchItems(items: SearchItem[]) {
  if (!items.length) return;
  const previous = storedSearchItems();
  const map = new Map(previous.map((x) => [x.key, x]));
  for (const item of items.filter(validSearchItem)) {
    const merged = mergeItem(map.get(item.key), item);
    map.delete(item.key);
    map.set(item.key, merged);
  }
  const counts = new Map<string, number>();
  const next = [...map.values()]
    .reverse()
    .filter((x) => {
      const n = (counts.get(x.target.kind) ?? 0) + 1;
      counts.set(x.target.kind, n);
      return n <= limits[x.target.kind];
    })
    .reverse();
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  setJson(INDEX_KEY, next);
  window.dispatchEvent(new Event(SEARCH_CHANGED));
}
export function rememberSearchVisit(key: string) {
  const migrated = migrateSearchKey(key);
  setJson(RECENT_KEY, [migrated, ...readSearchRecent().filter((x) => x !== migrated)].slice(0, 10));
}
export function readSearchRecent(): string[] {
  const v = getJson<unknown>(RECENT_KEY, []);
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(v.filter((x): x is string => typeof x === 'string').map(migrateSearchKey)),
  ].slice(0, 10);
}
export function normalizeSearch(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export function findSearchItems(items: SearchItem[], query: string): SearchItem[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) {
    const recent = readSearchRecent();
    return [
      ...items
        .filter((x) => recent.includes(x.key))
        .sort((a, b) => recent.indexOf(a.key) - recent.indexOf(b.key)),
      ...items.filter((x) => x.target.kind === 'section' && !recent.includes(x.key)),
    ].slice(0, 20);
  }
  return items
    .filter((x) =>
      words.every((w) =>
        normalizeSearch(`${x.title} ${x.subtitle} ${x.aliases ?? ''}`).includes(w),
      ),
    )
    .sort((a, b) => {
      const score = (item: SearchItem) =>
        normalizeSearch(item.title) === words.join(' ')
          ? 2
          : Number(normalizeSearch(item.title).startsWith(words.join(' ')));
      return score(b) - score(a);
    })
    .slice(0, 20);
}

/** Index only public labels and IDs already returned to the UI; never channel URLs/tokens. */
export function indexSportsPayload(source: string, path: string, payload: any) {
  const items: SearchItem[] = [];
  if (source === 'pitch') {
    const data = payload?.data ?? payload;
    const leagueId = path.match(/^leagues\/([^/]+)/)?.[1] ?? data?.league?.id;
    const matches = Array.isArray(data?.matches)
      ? data.matches
      : data?.home_team && data?.away_team
        ? [data]
        : [];
    for (const m of matches)
      if (clean(m.id) && clean(m.home_team?.name) && clean(m.away_team?.name)) {
        items.push({
          key: `match:${m.id}`,
          title: `${m.home_team.name} — ${m.away_team.name}`,
          subtitle: [
            data.league?.name,
            formatHumanDateTime(m.time_utc ?? m.date, getUserTimezone()),
          ]
            .filter(Boolean)
            .join(' · '),
          target: { kind: 'match', id: m.id, leagueId },
        });
        for (const t of [m.home_team, m.away_team])
          if (clean(t.id))
            items.push({
              key: `team:${t.id}`,
              title: t.name,
              subtitle: data.league?.name ?? 'Клуб',
              target: { kind: 'team', id: t.id, leagueId },
            });
      }
    const matchId = path.match(/^matches\/([^/]+)\/players/)?.[1];
    if (matchId && Array.isArray(data))
      for (const p of data)
        if (clean(p.player?.id) && clean(p.player?.name) && clean(p.team_id))
          items.push({
            key: `player:${p.player.id}`,
            title: p.player.name,
            subtitle: 'Футболист · профиль и статистика',
            target: {
              kind: 'player',
              player: {
                id: p.player.id,
                name: p.player.name,
                teamId: p.team_id,
                matchId,
                savedAt: new Date().toISOString(),
              },
            },
          });
  }
  if (source === 'jolpica')
    for (const list of payload?.MRData?.StandingsTable?.StandingsLists ?? [])
      for (const row of list.DriverStandings ?? []) {
        const d = row.Driver,
          year = Number(list.season ?? payload.MRData.StandingsTable.season);
        if (clean(d?.driverId) && clean(d.givenName) && clean(d.familyName))
          items.push({
            key: `driver:${year}:${d.driverId}`,
            title: `${d.givenName} ${d.familyName}`,
            subtitle: `Формула 1 · ${year}`,
            aliases: `${d.driverId} ${d.code ?? ''} ${d.driverId === 'max_verstappen' ? 'Ферстаппен Макс' : ''}`,
            target: { kind: 'driver', id: d.driverId, year },
          });
      }
  rememberSearchItems(items);
}
