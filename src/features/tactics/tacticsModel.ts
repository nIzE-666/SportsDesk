import { buildPitchTeam, lineupPlayerKey } from '../football/lineupModel';
import type { LineupsPayload, MatchDetail, TeamRef } from '../football/types';

export const TACTICS_KEY = 'sportsdesk.football.tactics';
export const TACTICS_VERSION = 1;
export const MAX_SCHEMES = 20;
export const MAX_ARROWS = 80;
export const MAX_TACTICS_BYTES = 190_000;
export interface Point {
  x: number;
  y: number;
}
export interface TacticPlayer {
  key: string;
  playerId: string;
  teamId: string;
  name: string;
  shirt: string;
  starter: boolean;
  position: Point | null;
  original: Point | null;
}
export interface TacticArrow {
  id: string;
  from: Point;
  to: Point;
}
export interface TacticSource {
  matchId: string;
  home: TeamRef;
  away: TeamRef;
  homeConfirmed: boolean | null;
  awayConfirmed: boolean | null;
  homeFormation: string;
  awayFormation: string;
}
export interface TacticScheme {
  id: string;
  title: string;
  binding: { kind: 'match' | 'team'; id: string };
  source: TacticSource;
  players: TacticPlayer[];
  arrows: TacticArrow[];
  updatedAt: string;
}
export interface TacticsStore {
  version: 1;
  schemes: TacticScheme[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 160): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => text(v) && v.trim().length > 0;
export const validPoint = (v: unknown): v is Point =>
  record(v) &&
  typeof v.x === 'number' &&
  Number.isFinite(v.x) &&
  v.x >= 0 &&
  v.x <= 1 &&
  typeof v.y === 'number' &&
  Number.isFinite(v.y) &&
  v.y >= 0 &&
  v.y <= 1;
const team = (v: unknown): v is TeamRef => record(v) && id(v.id) && id(v.name);
const nullablePoint = (v: unknown) => v === null || validPoint(v);
const confirmed = (v: unknown) => v === null || typeof v === 'boolean';

export function isTacticScheme(value: unknown): value is TacticScheme {
  if (
    !record(value) ||
    !id(value.id) ||
    !id(value.title) ||
    value.title.length > 80 ||
    !text(value.updatedAt, 40) ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !record(value.binding) ||
    !id(value.binding.id) ||
    !record(value.source)
  )
    return false;
  const source = value.source;
  if (
    !id(source.matchId) ||
    !team(source.home) ||
    !team(source.away) ||
    source.home.id === source.away.id ||
    !confirmed(source.homeConfirmed) ||
    !confirmed(source.awayConfirmed) ||
    !text(source.homeFormation, 40) ||
    !text(source.awayFormation, 40)
  )
    return false;
  if (
    !(value.binding.kind === 'match' && value.binding.id === source.matchId) &&
    !(value.binding.kind === 'team' && [source.home.id, source.away.id].includes(value.binding.id))
  )
    return false;
  if (
    !Array.isArray(value.players) ||
    value.players.length > 80 ||
    !Array.isArray(value.arrows) ||
    value.arrows.length > MAX_ARROWS
  )
    return false;
  const keys = new Set<string>();
  for (const p of value.players) {
    if (
      !record(p) ||
      !id(p.playerId) ||
      !id(p.teamId) ||
      !id(p.name) ||
      !text(p.shirt, 16) ||
      typeof p.starter !== 'boolean' ||
      !nullablePoint(p.position) ||
      !nullablePoint(p.original) ||
      ![source.home.id, source.away.id].includes(p.teamId) ||
      p.key !== lineupPlayerKey(p.teamId, p.playerId) ||
      keys.has(p.key)
    )
      return false;
    keys.add(p.key);
  }
  const arrowIds = new Set<string>();
  for (const a of value.arrows) {
    if (!record(a) || !id(a.id) || !validPoint(a.from) || !validPoint(a.to) || arrowIds.has(a.id))
      return false;
    arrowIds.add(a.id);
  }
  return true;
}
export function parseTactics(value: unknown): TacticsStore | null {
  if (
    !record(value) ||
    value.version !== TACTICS_VERSION ||
    !Array.isArray(value.schemes) ||
    value.schemes.length > MAX_SCHEMES
  )
    return null;
  const seen = new Set<string>();
  for (const scheme of value.schemes) {
    if (!isTacticScheme(scheme) || seen.has(scheme.id)) return null;
    seen.add(scheme.id);
  }
  return { version: TACTICS_VERSION, schemes: value.schemes as TacticScheme[] };
}
export function isValidTacticsValue(value: string) {
  try {
    return (
      new TextEncoder().encode(value).length <= MAX_TACTICS_BYTES &&
      parseTactics(JSON.parse(value)) !== null
    );
  } catch {
    return false;
  }
}
export function tacticsReadError(value: string): string {
  try {
    const data: unknown = JSON.parse(value);
    if (record(data) && typeof data.version === 'number' && data.version > TACTICS_VERSION)
      return 'Тактические схемы созданы более новой версией SportsDesk. Обновите приложение.';
  } catch {
    /* A damaged document receives the recovery hint below. */
  }
  return 'Сохранённые тактические схемы повреждены. Восстановите их из резервной копии.';
}
export function schemeFromLineups(
  detail: MatchDetail,
  payload: LineupsPayload | null,
  schemeId: string,
): TacticScheme {
  if (
    !payload ||
    (payload.match_id && payload.match_id !== detail.id) ||
    (payload.home_team?.id && payload.home_team.id !== detail.home_team.id) ||
    (payload.away_team?.id && payload.away_team.id !== detail.away_team.id)
  )
    throw new Error('Состав этого матча пока недоступен. Сохранённые схемы можно открыть ниже.');
  const home = buildPitchTeam(detail.home_team, payload.home, []);
  const away = buildPitchTeam(detail.away_team, payload.away, [], true);
  const players = [home, away].flatMap((t) =>
    [...t.starters, ...t.subs].map((p) => {
      const point = p.point ? { x: p.point.left / 100, y: p.point.top / 100 } : null;
      return {
        key: lineupPlayerKey(t.team.id, p.player.player_id),
        playerId: p.player.player_id,
        teamId: t.team.id,
        name: p.player.name,
        shirt: String(p.player.shirt_number ?? '').slice(0, 16),
        starter: t.starters.includes(p),
        position: point ? { ...point } : null,
        original: point ? { ...point } : null,
      };
    }),
  );
  if (!players.length)
    throw new Error('Источник пока не указал игроков. Можно открыть сохранённую схему.');
  const result: TacticScheme = {
    id: schemeId,
    title: 'Моя расстановка',
    binding: { kind: 'match', id: detail.id },
    source: {
      matchId: detail.id,
      home: { id: detail.home_team.id, name: detail.home_team.name },
      away: { id: detail.away_team.id, name: detail.away_team.name },
      homeConfirmed: typeof payload.home?.confirmed === 'boolean' ? payload.home.confirmed : null,
      awayConfirmed: typeof payload.away?.confirmed === 'boolean' ? payload.away.confirmed : null,
      homeFormation: home.formation ?? '',
      awayFormation: away.formation ?? '',
    },
    players,
    arrows: [],
    updatedAt: new Date().toISOString(),
  };
  if (!isTacticScheme(result))
    throw new Error('В составе есть неподдерживаемые данные. Схема не создана.');
  return result;
}
export function movePlayer(
  scheme: TacticScheme,
  key: string,
  position: Point | null,
): TacticScheme {
  if (!nullablePoint(position)) return scheme;
  return {
    ...scheme,
    players: scheme.players.map((p) =>
      p.key === key ? { ...p, position: position ? { ...position } : null } : p,
    ),
  };
}
export function addArrow(
  scheme: TacticScheme,
  from: Point,
  to: Point,
  arrowId: string,
): TacticScheme {
  if (!validPoint(from) || !validPoint(to) || Math.hypot(from.x - to.x, from.y - to.y) < 0.015)
    return scheme;
  if (scheme.arrows.length >= MAX_ARROWS)
    throw new Error(`На доске уже ${MAX_ARROWS} стрелок. Удалите одну или отмените действие.`);
  return {
    ...scheme,
    arrows: [...scheme.arrows, { id: arrowId, from: { ...from }, to: { ...to } }],
  };
}
export const resetScheme = (s: TacticScheme): TacticScheme => ({
  ...s,
  arrows: [],
  players: s.players.map((p) => ({ ...p, position: p.original ? { ...p.original } : null })),
});
export const appliesToMatch = (s: TacticScheme, d: MatchDetail) =>
  s.binding.kind === 'match'
    ? s.binding.id === d.id
    : [d.home_team.id, d.away_team.id].includes(s.binding.id);
export function upsertScheme(store: TacticsStore, scheme: TacticScheme): TacticsStore {
  if (!isTacticScheme(scheme)) throw new Error('Проверьте название и данные схемы.');
  const found = store.schemes.some((s) => s.id === scheme.id);
  if (!found && store.schemes.length >= MAX_SCHEMES)
    throw new Error(`Можно сохранить ${MAX_SCHEMES} схем. Удалите ненужную перед созданием новой.`);
  const next: TacticsStore = {
    version: TACTICS_VERSION,
    schemes: [scheme, ...store.schemes.filter((s) => s.id !== scheme.id)],
  };
  if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_TACTICS_BYTES)
    throw new Error('Хранилище схем заполнено. Удалите ненужную схему и повторите сохранение.');
  return next;
}
