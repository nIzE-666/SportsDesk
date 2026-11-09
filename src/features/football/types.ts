export interface LeagueRef {
  id: string;
  name: string;
  season?: string;
  image_url?: string;
}

export interface TeamRef {
  id: string;
  name: string;
  image_url?: string | null;
}

export interface MatchSummary {
  id: string;
  date?: string;
  time_utc?: string;
  status: string;
  status_text?: string;
  home_team: TeamRef;
  away_team: TeamRef;
  score_home: number | null;
  score_away: number | null;
  round_name?: string;
}

export interface LeagueMatchesPayload {
  league: LeagueRef;
  matches: MatchSummary[];
}

export interface MatchDetail {
  id: string;
  league?: LeagueRef;
  season?: string;
  home_team: TeamRef;
  away_team: TeamRef;
  date?: string;
  time_utc?: string;
  status: string;
  score_home: number | null;
  score_away: number | null;
  round_name?: string;
  referee?: string;
  stadium?: string;
}

export interface StatValue {
  type: string;
  value?: number;
  total?: number;
}

export interface PlayerStatEntry {
  key: string;
  stat: StatValue;
}

export interface PlayerStatGroup {
  key: string;
  title: string;
  stats: Record<string, PlayerStatEntry>;
}

export interface PlayerMatchEntry {
  player: {
    id: string;
    name: string;
    position_id?: number | null;
    image_url?: string | null;
  };
  team_id: string;
  stats: PlayerStatGroup[];
}

export interface LineupPlayer {
  player_id: string;
  name: string;
  shirt_number?: string;
  position_id?: number | null;
  is_captain?: boolean;
  pitch_x?: number;
  pitch_y?: number;
}

export interface TeamLineup {
  formation?: string;
  confirmed?: boolean;
  coach?: { name?: string };
  starters: LineupPlayer[];
  subs: LineupPlayer[];
}

export interface LineupsPayload {
  match_id: string;
  home_team: TeamRef;
  away_team: TeamRef;
  home: TeamLineup;
  away: TeamLineup;
}

export interface StatItem {
  title: string;
  key: string;
  home: string;
  away: string;
  format_type?: string;
}

export interface StatGroup {
  group_name: string;
  items: StatItem[];
}

export interface StatsPeriod {
  period: string;
  groups: StatGroup[];
}

export interface StatsPayload {
  match_id: string;
  home_team: TeamRef;
  away_team: TeamRef;
  periods: StatsPeriod[];
}

export interface MatchEvent {
  event_type: string;
  minute: number;
  minute_added?: number;
  period?: string;
  team_id?: string;
  player?: { id?: string; name?: string; image_url?: string | null };
  score_home?: number | null;
  score_away?: number | null;
  is_own_goal?: boolean;
  is_penalty?: boolean;
}

export interface EventsPayload {
  match_id: string;
  events: MatchEvent[];
}

export interface FavoritePlayer {
  id: string;
  name: string;
  teamId?: string;
  teamName?: string;
  imageUrl?: string | null;
  matchId?: string;
  matchLabel?: string;
  savedAt: string;
}

export interface SportScoreStandingRow {
  pos: number;
  team: string;
  team_logo?: string;
  team_slug?: string;
  p?: number;
  w?: number;
  d?: number;
  l?: number;
  gf?: number;
  ga?: number;
  gd?: number;
  pts?: number;
  promo_name?: string;
}

export interface SportScoreStandings {
  sport?: string;
  competition?: string;
  competition_logo?: string;
  competition_slug?: string;
  tables: Array<{ group?: string; rows: SportScoreStandingRow[] }>;
}
