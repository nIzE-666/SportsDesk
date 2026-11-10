import type { OfflineSeason } from '../../features/offline/offlineModel';
export const offlineSeason: OfflineSeason = {
  version: 1,
  leagueId: 'l_4WFCIZ',
  leagueName: 'Premier League',
  season: '2026/2027',
  fetchedAt: '2026-11-09T00:00:00Z',
  pinned: true,
  duplicates: 0,
  matches: [
    {
      id: 'offline-finished',
      homeId: 'arsenal',
      homeName: 'Arsenal',
      awayId: 'chelsea',
      awayName: 'Chelsea',
      homeScore: 2,
      awayScore: 1,
      status: 'finished',
      date: '2026-11-08',
      timeUtc: '2026-11-08T16:30:00Z',
      round: '11',
    },
    {
      id: 'offline-future',
      homeId: 'chelsea',
      homeName: 'Chelsea',
      awayId: 'arsenal',
      awayName: 'Arsenal',
      homeScore: null,
      awayScore: null,
      status: 'scheduled',
      date: '2027-03-20',
      timeUtc: null,
      round: '29',
    },
  ],
};
export const offlinePayload = (p = offlineSeason) => ({
  data: {
    league: { id: p.leagueId, name: p.leagueName, season: p.season },
    matches: p.matches.map((m) => ({
      id: m.id,
      home_team: { id: m.homeId, name: m.homeName },
      away_team: { id: m.awayId, name: m.awayName },
      score_home: m.homeScore,
      score_away: m.awayScore,
      status: m.status,
      date: m.date,
      time_utc: m.timeUtc,
      round_name: m.round,
    })),
  },
});
export function completeOfflineSeason(): OfflineSeason {
  const matches: OfflineSeason['matches'] = [];
  for (let home = 0; home < 20; home++)
    for (let away = 0; away < 20; away++)
      if (home !== away)
        matches.push({
          ...offlineSeason.matches[0]!,
          id: `m-${home}-${away}`,
          homeId: `t-${home}`,
          awayId: `t-${away}`,
          homeName: `Команда ${home + 1}`,
          awayName: `Команда ${away + 1}`,
        });
  return { ...offlineSeason, matches };
}
