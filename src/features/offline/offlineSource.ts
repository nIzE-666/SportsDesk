import { classifyMatchStatus } from '../../lib/sportsIdentity';
import {
  isObject,
  validOfflineSeason,
  type OfflineMatch,
  type OfflineSeason,
} from './offlineModel';

/** Reject the whole response rather than silently dropping malformed fixtures. */
export function buildOfflineSeason(
  payload: unknown,
  leagueId: string,
  leagueName: string,
  season: string,
  fetchedAt: string,
): OfflineSeason {
  const data = isObject(payload) && isObject(payload.data) ? payload.data : payload;
  if (
    !isObject(data) ||
    !isObject(data.league) ||
    data.league.id !== leagueId ||
    data.league.season !== season ||
    !Array.isArray(data.matches)
  )
    throw new Error('Источник вернул другую лигу, сезон или неверный список матчей.');
  const matches = new Map<string, OfflineMatch>();
  let duplicates = 0;
  for (const raw of data.matches) {
    if (!isObject(raw) || !isObject(raw.home_team) || !isObject(raw.away_team))
      throw new Error('Некорректный матч в ответе источника.');
    const m = {
      id: raw.id,
      homeId: raw.home_team.id,
      homeName: raw.home_team.name,
      awayId: raw.away_team.id,
      awayName: raw.away_team.name,
      homeScore: raw.score_home ?? null,
      awayScore: raw.score_away ?? null,
      status: typeof raw.status === 'string' ? classifyMatchStatus(raw.status) : '',
      date: raw.date ?? '',
      timeUtc: raw.time_utc ?? null,
      round: raw.round_name ?? '',
    } as OfflineMatch;
    const previous = matches.get(m.id);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(m))
        throw new Error('Источник вернул разные матчи с одинаковым ID. Повторите загрузку.');
      duplicates++;
    } else matches.set(m.id, m);
  }
  const result: OfflineSeason = {
    version: 1,
    leagueId,
    leagueName,
    season,
    fetchedAt,
    pinned: true,
    duplicates,
    matches: [...matches.values()],
  };
  if (!validOfflineSeason(result))
    throw new Error('Пакет пуст, повреждён или превышает лимит 2000 матчей / 2 МБ.');
  return result;
}
