import { expect, it } from 'vitest';
import { tacticLineups, tacticMatch } from '../../test/fixtures/tactics';
import {
  addArrow,
  appliesToMatch,
  isTacticScheme,
  isValidTacticsValue,
  MAX_SCHEMES,
  MAX_ARROWS,
  movePlayer,
  parseTactics,
  resetScheme,
  schemeFromLineups,
  upsertScheme,
} from './tacticsModel';
const create = () => schemeFromLineups(tacticMatch, tacticLineups, 'scheme');

it('copies all players including substitutes and missing positions with team-qualified identity', () => {
  const s = create();
  expect(s.players).toHaveLength(6);
  expect(new Set(s.players.map((p) => p.key)).size).toBe(6);
  expect(s.players.find((p) => p.playerId === 'missing')).toMatchObject({
    position: null,
    original: null,
    starter: true,
  });
  expect(s.players.find((p) => p.playerId === 'bench')).toMatchObject({
    position: null,
    starter: false,
  });
  expect(s.source).toMatchObject({ homeConfirmed: false, awayConfirmed: true });
});
it('never mutates the provider lineup or original snapshot during edits and reset', () => {
  const raw = JSON.stringify(tacticLineups),
    s = create(),
    original = JSON.stringify(s);
  const key = s.players[0]!.key;
  const moved = movePlayer(s, key, { x: 0.8, y: 0.9 });
  const arrows = addArrow(moved, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 'arrow');
  expect(arrows.players[0]?.original).toEqual(s.players[0]?.original);
  expect(JSON.stringify(tacticLineups)).toBe(raw);
  expect(JSON.stringify(s)).toBe(original);
  const reset = resetScheme(arrows);
  expect(reset.players).toEqual(s.players);
  expect(reset.arrows).toEqual([]);
});
it('uses normalized coordinates on both halves without depending on the viewport', () => {
  const s = create();
  expect(s.players[0]?.position?.x).toBeCloseTo(0.3668);
  expect(s.players.find((p) => p.teamId === 'chelsea')?.position?.x).toBeCloseTo(0.664);
  const moved = movePlayer(s, s.players[0]!.key, { x: 0.73, y: 0.27 });
  const restored = parseTactics(JSON.parse(JSON.stringify({ version: 1, schemes: [moved] })))!;
  expect(restored.schemes[0]?.players[0]?.position).toEqual({ x: 0.73, y: 0.27 });
});
it('rejects mismatched and empty source lineups', () => {
  expect(() => schemeFromLineups(tacticMatch, null, 'id')).toThrow('недоступен');
  expect(() =>
    schemeFromLineups(tacticMatch, { ...tacticLineups, match_id: 'other' }, 'id'),
  ).toThrow();
  expect(() =>
    schemeFromLineups(
      tacticMatch,
      { ...tacticLineups, home: { starters: [], subs: [] }, away: { starters: [], subs: [] } },
      'id',
    ),
  ).toThrow('не указал игроков');
});
it('does not infer confirmation when the provider omitted it', () => {
  expect(
    schemeFromLineups(
      tacticMatch,
      { ...tacticLineups, home: { ...tacticLineups.home, confirmed: undefined } },
      'id',
    ).source.homeConfirmed,
  ).toBeNull();
});
it('keeps a team scheme available in another match of that team while match schemes stay local', () => {
  const s = create(),
    other = { ...tacticMatch, id: 'next', away_team: { id: 'other', name: 'Other' } };
  expect(appliesToMatch(s, other)).toBe(false);
  expect(appliesToMatch({ ...s, binding: { kind: 'team', id: 'arsenal' } }, other)).toBe(true);
  expect(appliesToMatch({ ...s, binding: { kind: 'team', id: 'chelsea' } }, other)).toBe(false);
});
it('keeps unknown coordinates off the pitch until placed and ignores invalid points', () => {
  const s = create(),
    key = s.players.find((p) => p.playerId === 'missing')!.key;
  expect(
    movePlayer(s, key, { x: 0.5, y: 0.5 }).players.find((p) => p.key === key)?.position,
  ).toEqual({ x: 0.5, y: 0.5 });
  expect(movePlayer(s, key, { x: Infinity, y: 0.5 })).toBe(s);
  expect(movePlayer(s, key, { x: -1, y: 0.5 })).toBe(s);
});
it('bounds arrows and refuses zero-length arrows', () => {
  const s = create();
  expect(addArrow(s, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 'a')).toBe(s);
  const full = {
    ...s,
    arrows: Array.from({ length: MAX_ARROWS }, (_, i) => ({
      id: String(i),
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    })),
  };
  expect(() => addArrow(full, { x: 0, y: 0 }, { x: 1, y: 1 }, 'next')).toThrow('стрелок');
});
it('updates a saved ID without duplication and refuses a full library without deleting anything', () => {
  const s = create(),
    store = {
      version: 1 as const,
      schemes: Array.from({ length: MAX_SCHEMES }, (_, i) => ({ ...s, id: String(i) })),
    };
  const updated = upsertScheme(store, { ...s, id: '0', title: 'Исправлено' });
  expect(updated.schemes).toHaveLength(MAX_SCHEMES);
  expect(updated.schemes[0]?.title).toBe('Исправлено');
  expect(() => upsertScheme(store, s)).toThrow('Удалите');
  expect(store.schemes[0]?.title).toBe('Моя расстановка');
});
it('rejects a new format, malformed coordinates, duplicate identities and invalid bindings', () => {
  const s = create();
  expect(parseTactics({ version: 2, schemes: [s] })).toBeNull();
  expect(isTacticScheme({ ...s, players: [{ ...s.players[0], position: { x: NaN, y: 0 } }] })).toBe(
    false,
  );
  expect(isTacticScheme({ ...s, players: [s.players[0], s.players[0]] })).toBe(false);
  expect(isTacticScheme({ ...s, binding: { kind: 'team', id: 'unknown' } })).toBe(false);
  expect(parseTactics({ version: 1, schemes: [s, s] })).toBeNull();
});
it('validates serialized values for profile restore before accepting them', () => {
  const valid = JSON.stringify({ version: 1, schemes: [create()] });
  expect(isValidTacticsValue(valid)).toBe(true);
  expect(isValidTacticsValue('{broken')).toBe(false);
  expect(
    isValidTacticsValue(JSON.stringify({ version: 1, schemes: [{ ...create(), title: '' }] })),
  ).toBe(false);
  expect(isValidTacticsValue(' '.repeat(190_001) + valid)).toBe(false);
});
