import { expect, it } from 'vitest';
import { mergeSquad, squadPositionGroups, type SquadMember } from './squad';
import type { LineupsPayload } from './types';

const member = (id: string, positionId?: number | null): SquadMember => ({
  id,
  name: id,
  role: 'start',
  positionId,
});

it('groups players by the provider position and keeps unknown ids honest', () => {
  const groups = squadPositionGroups([
    member('mid', 3),
    member('gk', 1),
    member('def', 2),
    member('fw', 4),
    member('unknown', null),
    member('other', 99),
  ]);
  expect(groups.map((group) => group.label)).toEqual([
    'Вратари',
    'Защитники',
    'Полузащитники',
    'Нападающие',
    'Без позиции',
  ]);
  expect(groups.at(-1)?.members.map((entry) => entry.id)).toEqual(['unknown', 'other']);
});

it('keeps the position of a lineup player when the stats entry has none', () => {
  const lineup: LineupsPayload = {
    match_id: 'match',
    home_team: { id: 'home', name: 'Home' },
    away_team: { id: 'away', name: 'Away' },
    home: {
      starters: [
        { player_id: 'one', name: 'One', position_id: 2 },
        { player_id: 'two', name: 'Two' },
      ],
      subs: [],
    },
    away: { starters: [], subs: [] },
  };
  const squad = mergeSquad('home', lineup, [
    {
      team_id: 'home',
      player: { id: 'one', name: 'One', image_url: 'one.png' },
      stats: [],
    },
  ]);
  expect(squad.find((entry) => entry.id === 'one')?.positionId).toBe(2);
  expect(squad.find((entry) => entry.id === 'two')?.positionId).toBeUndefined();
});
