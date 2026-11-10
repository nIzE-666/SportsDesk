import { api } from '../../lib/bridge';
import type { LineupsPayload, PlayerMatchEntry } from './types';

export interface SquadMember {
  id: string;
  name: string;
  number?: string;
  role: 'start' | 'sub' | 'played';
  captain?: boolean;
  imageUrl?: string | null;
  entry?: PlayerMatchEntry;
}

export function mergeSquad(
  teamId: string,
  lineup: LineupsPayload | null,
  entries: PlayerMatchEntry[],
): SquadMember[] {
  const side =
    lineup?.home_team?.id === teamId
      ? lineup.home
      : lineup?.away_team?.id === teamId
        ? lineup.away
        : null;
  const members = new Map<string, SquadMember>();
  for (const [role, list] of [
    ['start', side?.starters],
    ['sub', side?.subs],
  ] as const) {
    for (const p of list ?? [])
      if (p.player_id && p.name)
        members.set(p.player_id, {
          id: p.player_id,
          name: p.name,
          number: p.shirt_number,
          role,
          captain: p.is_captain,
        });
  }
  for (const entry of entries) {
    if (entry.team_id !== teamId || !entry.player?.id || !entry.player.name) continue;
    const old = members.get(entry.player.id);
    members.set(entry.player.id, {
      ...old,
      id: entry.player.id,
      name: entry.player.name,
      role: old?.role ?? 'played',
      imageUrl: entry.player.image_url,
      entry,
    });
  }
  return [...members.values()];
}

// One pair of requests per match, shared by the club and the player directory.
const cache = new Map<string, { until: number; promise: ReturnType<typeof requestSquad> }>();
async function requestSquad(matchId: string) {
  const [lineups, players] = await Promise.allSettled([
    api('pitch', `matches/${encodeURIComponent(matchId)}/lineups`),
    api('pitch', `matches/${encodeURIComponent(matchId)}/players`),
  ]);
  if (lineups.status === 'rejected' && players.status === 'rejected')
    throw new Error('Источник не вернул состав и статистику. Попробуйте обновить.');
  const lineup =
    lineups.status === 'fulfilled'
      ? ((lineups.value.payload?.data ?? lineups.value.payload) as LineupsPayload)
      : null;
  const raw =
    players.status === 'fulfilled' ? (players.value.payload?.data ?? players.value.payload) : null;
  return {
    lineup,
    entries: Array.isArray(raw) ? (raw as PlayerMatchEntry[]) : [],
    note:
      lineups.status === 'rejected'
        ? 'Состав недоступен: показаны игроки со статистикой матча.'
        : players.status === 'rejected'
          ? 'Статистика матча и фотографии временно недоступны. Состав загружен.'
          : null,
  };
}
export function loadSquad(matchId: string, refresh = false) {
  const hit = cache.get(matchId);
  if (!refresh && hit && hit.until > Date.now()) return hit.promise;
  const promise = requestSquad(matchId).catch((error) => {
    cache.delete(matchId);
    throw error;
  });
  cache.set(matchId, { until: Date.now() + 15 * 60_000, promise });
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  return promise;
}
