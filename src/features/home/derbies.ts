import { clubKey } from '../football/clubNames';
import type { MatchSummary } from '../football/types';

export interface DerbyPair {
  league: string;
  teams: readonly [string, string];
}

/**
 * Famous derbies only, one to three for each league the app follows. Names are the
 * catalogue spellings; clubKey makes the table's spellings match them.
 */
export const DERBIES: readonly DerbyPair[] = [
  { league: 'Premier League', teams: ['Manchester United', 'Manchester City'] },
  { league: 'Premier League', teams: ['Liverpool', 'Everton'] },
  { league: 'Premier League', teams: ['Arsenal', 'Tottenham Hotspur'] },
  // El Clásico.
  { league: 'Ла Лига', teams: ['Real Madrid', 'Barcelona'] },
  { league: 'Ла Лига', teams: ['Real Madrid', 'Atlético Madrid'] },
  { league: 'Ла Лига', teams: ['Sevilla', 'Real Betis'] },
  { league: 'Серия A', teams: ['Inter', 'Milan'] },
  { league: 'Серия A', teams: ['Lazio', 'Roma'] },
  { league: 'Серия A', teams: ['Juventus', 'Inter'] },
  { league: 'Бундеслига', teams: ['Bayern München', 'Borussia Dortmund'] },
  { league: 'Бундеслига', teams: ['Borussia Dortmund', 'Schalke 04'] },
  { league: 'Бундеслига', teams: ['Hamburger SV', 'Werder Bremen'] },
  { league: 'Лига 1', teams: ['Paris Saint-Germain', 'Marseille'] },
  { league: 'Лига 1', teams: ['Lyon', 'Saint-Étienne'] },
  { league: 'Лига 1', teams: ['Lille', 'Lens'] },
  { league: 'MLS', teams: ['LA Galaxy', 'Los Angeles FC'] },
  { league: 'MLS', teams: ['Columbus Crew', 'FC Cincinnati'] },
  { league: 'MLS', teams: ['Seattle Sounders', 'Portland Timbers'] },
];

function pairKey(homeName: string, awayName: string): string {
  const first = clubKey(homeName);
  const second = clubKey(awayName);
  return first <= second ? `${first}\u0000${second}` : `${second}\u0000${first}`;
}

const DERBY_KEYS = new Set(DERBIES.map((derby) => pairKey(derby.teams[0], derby.teams[1])));

/** The order of the pair and the source's spelling of each club do not matter. */
export function isDerby(homeName: string, awayName: string): boolean {
  if (!homeName || !awayName) return false;
  return DERBY_KEYS.has(pairKey(homeName, awayName));
}

export function isDerbyMatch(match: Pick<MatchSummary, 'home_team' | 'away_team'>): boolean {
  return isDerby(match.home_team.name, match.away_team.name);
}
