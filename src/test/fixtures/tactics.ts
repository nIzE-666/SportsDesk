import type { LineupsPayload, MatchDetail } from '../../features/football/types';

export const tacticMatch: MatchDetail = {
  id: 'tactics-fixture',
  status: 'finished',
  score_home: 1,
  score_away: 1,
  home_team: { id: 'arsenal', name: 'Arsenal' },
  away_team: { id: 'chelsea', name: 'Chelsea' },
  time_utc: '2026-11-08T18:00:00Z',
};
export const tacticLineups: LineupsPayload = {
  match_id: tacticMatch.id,
  home_team: tacticMatch.home_team,
  away_team: tacticMatch.away_team,
  home: {
    formation: '4-3-3',
    confirmed: false,
    starters: [
      { player_id: 'shared', name: 'Bukayo Saka', shirt_number: '7', pitch_x: 0.72, pitch_y: 0.26 },
      { player_id: 'rice', name: 'Declan Rice', shirt_number: '41', pitch_x: 0.42, pitch_y: 0.5 },
      { player_id: 'missing', name: 'Игрок без позиции', shirt_number: '12' },
    ],
    subs: [{ player_id: 'bench', name: 'Запасной игрок', shirt_number: '19' }],
  },
  away: {
    formation: '4-2-3-1',
    confirmed: true,
    starters: [
      { player_id: 'shared', name: 'Cole Palmer', shirt_number: '20', pitch_x: 0.65, pitch_y: 0.3 },
      {
        player_id: 'caicedo',
        name: 'Moisés Caicedo',
        shirt_number: '25',
        pitch_x: 0.4,
        pitch_y: 0.5,
      },
    ],
    subs: [],
  },
};
