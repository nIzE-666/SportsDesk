import type { FavoritePlayer } from '../features/football/types';
import { SETTINGS_CATEGORIES } from '../features/settings/categories';
import { CUP_COMPETITIONS } from '../features/ucl/cupMetadata';
import { getJson, getUserTimezone, setJson, STORAGE_KEYS } from '../features/football/storage';
import { formatHumanDateTime } from './humanDate';
import { isCompetitionVisibleWith, type ModulesState } from './modules';
import type { SettingsCategory } from './navigation';
import { LEAGUES } from './navigationMetadata';

/** «Раздел» targets of the five-section model. Competition stays a parameter. */
export type SearchSectionId =
  | 'today'
  | 'today.week'
  | 'today.plan'
  | 'football'
  | 'football.matches'
  | 'football.standings'
  | 'football.team'
  | 'football.players'
  | 'football.live'
  | 'f1'
  | 'f1.calendar'
  | 'f1.standings'
  | 'f1.analysis'
  | 'watch'
  | 'my'
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
  | { kind: 'section'; id: SearchSectionId }
  | { kind: 'competition'; id: string }
  | { kind: 'settings'; category: SettingsCategory };
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
  'football',
  'football.matches',
  'football.standings',
  'football.team',
  'football.players',
  'football.live',
  'f1',
  'f1.calendar',
  'f1.standings',
  'f1.analysis',
  'watch',
  'my',
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
  // Tournament tabs removed in U4.5: «Обзор» → matches, «Статистика» → players.
  overview: 'football.matches',
  stats: 'football.players',
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
  section: 40,
  competition: 40,
  settings: 20,
};
const clean = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 300;
const SETTINGS_CATEGORY_IDS: ReadonlySet<string> = new Set(
  SETTINGS_CATEGORIES.map((category) => category.id),
);
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
  if (t.kind === 'competition') return clean(t.id) && competitionTitles.has(t.id);
  if (t.kind === 'settings') return SETTINGS_CATEGORY_IDS.has(t.category);
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
function sectionItem(
  id: SearchSectionId,
  title: string,
  subtitle: string,
  aliases?: string,
): SearchItem {
  return { key: `section:${id}`, title, subtitle, aliases, target: { kind: 'section', id } };
}

/** Sections, «Моё» tabs and F1 tabs: everything that is a fixed screen. */
export const searchSections: SearchItem[] = [
  sectionItem('today', 'Сегодня', 'Главная', 'матчи дня сейчас'),
  sectionItem('football', 'Футбол', 'Матчи, таблицы и клубы', 'турниры лиги'),
  sectionItem('f1', 'Формула 1', 'Гонки и зачёты', 'f1 паддок'),
  sectionItem('watch', 'Смотреть', 'Онлайн-просмотр', 'каналы трансляции'),
  sectionItem('my', 'Моё', 'Избранное, дневник и игры', 'профиль'),
  sectionItem('football.matches', 'Матчи', 'Футбол', 'календарь'),
  sectionItem('football.live', 'Сейчас идут', 'Футбол · матчи сегодня', 'прямой эфир live счёт'),
  sectionItem('football.players', 'Игроки', 'Футбол · профили и сравнение', 'футболисты'),
  sectionItem('today.plan', 'Мой план', 'Сегодня', 'планировщик мой спортивный вечер'),
  sectionItem('events', 'События', 'Голы, результаты и напоминания', 'центр событий уведомления'),
  sectionItem('my.favorites', 'Избранное', 'Моё', 'клубы команды игроки пилоты'),
  sectionItem('my.diary', 'Дневник', 'Моё', 'просмотрено отметки'),
  sectionItem('my.games', 'Игры и прогнозы', 'Моё', 'стартовые огни угадай счёт'),
  sectionItem('my.schemes', 'Схемы', 'Моё', 'тактическая доска'),
  sectionItem('f1.calendar', 'Календарь', 'Формула 1', 'расписание гонок этапы'),
  sectionItem('f1.standings', 'Зачёты', 'Формула 1', 'пилоты кубок конструкторов таблица'),
  sectionItem('f1.analysis', 'Анализ', 'Формула 1', 'сравнение пилотов темп по кругам сессия'),
];

const SETTINGS_ALIASES: Record<string, string> = {
  general: 'часовой пояс трей сочетание клавиш стартовый экран',
  favorites: 'клубы команды игроки пилоты',
  notifications: 'оповещения тихие часы',
  appearance: 'тема оформление плотность',
  modules: 'выключатели разделы',
  watch: 'каналы kino',
  data: 'резервная копия восстановление офлайн-сезоны',
  sources: 'поставщики данных',
  about: 'версия обновления',
};
const searchSettings: SearchItem[] = SETTINGS_CATEGORIES.map((category) => ({
  key: `settings:${category.id}`,
  title: category.label,
  subtitle: 'Настройки',
  aliases: SETTINGS_ALIASES[category.id],
  target: { kind: 'settings', category: category.id },
}));

const COMPETITION_ALIASES: Record<string, string> = {
  l_4WFCIZ: 'Англия АПЛ Премьер-лига Premier League',
  l_0ErfuF: 'Испания ЛаЛига La Liga',
  l_0ALvwF: 'Италия Serie A',
  l_1Isor4: 'Германия Bundesliga',
  l_3FJFUl: 'Франция Ligue 1',
  l_0eg6C9: 'США Major League Soccer',
  l_0bfbkO: 'ЛЧ Лига чемпионов Champions League УЕФА',
  l_38d9HA: 'ЛЕ Лига Европы Europa League',
  l_2WZ2tt: 'ЛК Лига конференций Conference League',
  l_1XLtP0: 'ЧМ Чемпионат мира World Cup',
};
const competitionTitles = new Map<string, string>([
  ...LEAGUES.map((league) => [league.id, league.label] as const),
  ...CUP_COMPETITIONS.map((cup) => [cup.id, cup.title] as const),
]);
const searchCompetitions: SearchItem[] = [...competitionTitles].map(([id, title]) => ({
  key: `competition:${id}`,
  title,
  subtitle: 'Футбол',
  aliases: COMPETITION_ALIASES[id],
  target: { kind: 'competition', id },
}));

/** Every built-in target merged into the stored index on read. */
export const searchCatalogue: SearchItem[] = [
  ...searchSections,
  ...searchSettings,
  ...searchCompetitions,
];

/**
 * A result is hidden when its screen, channel or competition is switched off.
 * Stored team and match targets keep their league so this check also works for
 * results saved before the modules existed.
 */
export function isSearchItemVisible(item: SearchItem, modules: ModulesState): boolean {
  const target = item.target;
  if (target.kind === 'channel') return modules.watch;
  if (target.kind === 'competition') return isCompetitionVisibleWith(target.id, modules);
  if (target.kind === 'section') {
    if (target.id === 'watch') return modules.watch;
    if (target.id === 'my.diary') return modules.diary;
    if (target.id === 'my.games') return modules.games || modules.predictions;
    if (target.id === 'my.schemes') return modules.tactics;
    return true;
  }
  if ((target.kind === 'team' || target.kind === 'match') && target.leagueId)
    return isCompetitionVisibleWith(target.leagueId, modules);
  return true;
}
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
  for (const item of [...items.filter(validSearchItem), ...searchCatalogue])
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
