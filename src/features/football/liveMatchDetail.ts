import { api } from '../../lib/bridge';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { clubKey } from './clubNames';
import { loadLiveDay, loadLiveNow } from './liveData';
import { espnSlugForLeague, type LiveMatch, type LiveSource } from './liveSources';
import type {
  EventsPayload,
  LineupPlayer,
  LineupsPayload,
  MatchDetail,
  MatchEvent,
  StatGroup,
  StatItem,
  StatsPayload,
  TeamLineup,
  TeamRef,
} from './types';

/**
 * Free real-time live match center adapter (LiveScore primary + ESPN summary fallback).
 *
 * PitchAPI only publishes pre-match (`not_started`) and post-match (`finished`) records;
 * while a fixture is under way, this module maps LiveScore's scoreboard/incidents/statistics/
 * lineups endpoints and ESPN's `/summary?event=` endpoint directly into SportsDesk's
 * standard `MatchDetail`, `EventsPayload`, `StatsPayload` and `LineupsPayload` contracts.
 */

export interface LiveMatchCommentaryItem {
  minute: string;
  text: string;
}

export interface LiveMatchSnapshot {
  source: LiveSource;
  fetchedAt: string | null;
  stale: boolean;
  minute: string | null;
  status: string;
  scoreHome: number | null;
  scoreAway: number | null;
  events: EventsPayload | null;
  stats: StatsPayload | null;
  lineups: LineupsPayload | null;
  commentary: LiveMatchCommentaryItem[];
}

export interface ResolvedLiveMatchRef {
  source: LiveSource;
  eventId: string;
  leagueSlug: string | null;
  liveMatch: LiveMatch;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const PRE_KICKOFF_WINDOW_MS = 20 * MINUTE_MS;
const POST_KICKOFF_WINDOW_MS = 210 * MINUTE_MS; // 3.5 hours covers ET + penalties
const MATCH_KICKOFF_TOLERANCE_MS = 4 * HOUR_MS;
const NUMERIC_ID = /^\d{1,24}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * True when a match may currently be in play or about to kick off (including fixtures
 * where PitchAPI still reports `not_started` past the scheduled kick-off time).
 */
export function isMatchPotentiallyLive(detail: MatchDetail | null, nowMs = Date.now()): boolean {
  if (!detail) return false;
  const state = classifyMatchStatus(detail.status);
  if (state === 'live') return true;
  if (state === 'finished' || state === 'cancelled' || state === 'postponed') return false;
  const rawKickoff = detail.time_utc ?? detail.date;
  if (!rawKickoff) return false;
  const kickoff = Date.parse(rawKickoff);
  if (!Number.isFinite(kickoff)) return false;
  return nowMs >= kickoff - PRE_KICKOFF_WINDOW_MS && nowMs <= kickoff + POST_KICKOFF_WINDOW_MS;
}

/** Matches a PitchAPI `MatchDetail` against a list of `LiveMatch` entries by clubs & kick-off. */
export function matchLiveFixture(
  detail: MatchDetail,
  candidates: readonly LiveMatch[],
): LiveMatch | null {
  const homeKey = clubKey(detail.home_team.name);
  const awayKey = clubKey(detail.away_team.name);
  if (!homeKey || !awayKey) return null;
  const pitchKickoff = Date.parse(detail.time_utc ?? detail.date ?? '');
  const hasPitchKickoff = Number.isFinite(pitchKickoff);
  for (const candidate of candidates) {
    if (candidate.home.clubKey !== homeKey || candidate.away.clubKey !== awayKey) continue;
    if (hasPitchKickoff && candidate.kickoffUtc) {
      const candidateKickoff = Date.parse(candidate.kickoffUtc);
      if (
        Number.isFinite(candidateKickoff) &&
        Math.abs(candidateKickoff - pitchKickoff) > MATCH_KICKOFF_TOLERANCE_MS
      ) {
        continue;
      }
    }
    return candidate;
  }
  return null;
}

export function extractSourceEventId(liveMatch: LiveMatch): string | null {
  const prefix = `${liveMatch.source}:`;
  if (!liveMatch.id.startsWith(prefix)) return null;
  const id = liveMatch.id.slice(prefix.length).trim();
  return id || null;
}

function liveScoreStatusFromEps(eps: string | undefined): {
  status: string;
  minute: string | null;
} {
  const clean = (eps ?? '').trim();
  if (!clean || clean === 'NS') return { status: 'scheduled', minute: null };
  if (clean === 'FT' || clean === 'AET' || clean === 'AP') {
    return { status: 'finished', minute: null };
  }
  if (clean === 'Postp.' || clean === 'Postp') return { status: 'postponed', minute: null };
  if (clean === 'Canc.' || clean === 'Canc') return { status: 'cancelled', minute: null };
  if (clean === 'HT') return { status: 'live', minute: 'HT' };
  if (/^\d{1,3}(?:\+\d{1,2})?'?$/.test(clean)) {
    return { status: 'live', minute: clean.endsWith("'") ? clean : `${clean}'` };
  }
  return { status: 'live', minute: clean };
}

export function parseLiveScoreScoreboard(raw: unknown): {
  status: string;
  minute: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
} | null {
  if (!isRecord(raw)) return null;
  const eps = asString(raw.Eps);
  const { status, minute } = liveScoreStatusFromEps(eps);
  const scoreHome = status === 'live' || status === 'finished' ? asInt(raw.Tr1) : null;
  const scoreAway = status === 'live' || status === 'finished' ? asInt(raw.Tr2) : null;
  return { status, minute, scoreHome, scoreAway };
}

function liveScorePlayerName(entry: Record<string, unknown>): string | undefined {
  const short = asString(entry.Pn);
  if (short) return short;
  const full = [asString(entry.Fn), asString(entry.Ln)].filter(Boolean).join(' ').trim();
  return full || asString(entry.Snm);
}

function pushLiveScoreIncident(
  out: MatchEvent[],
  entry: Record<string, unknown>,
  period: string,
  home: TeamRef,
  away: TeamRef,
): void {
  const nested = asArray(entry.Incs).filter(isRecord);
  if (nested.length > 0) {
    for (const child of nested) {
      pushLiveScoreIncident(out, child, period, home, away);
    }
    return;
  }
  const code = asInt(entry.IT);
  const minute = asInt(entry.Min);
  if (code === null || minute === null || minute < 0) return;
  // IT=63 is an assist attached inside a goal Incs[] pair; skip duplicate row in timeline.
  if (code === 63) return;

  let eventType: string | null = null;
  let isPenalty = false;
  let isOwnGoal = false;
  if (code === 36) {
    eventType = 'goal';
  } else if (code === 37) {
    eventType = 'goal';
    isPenalty = true;
  } else if (code === 39) {
    eventType = 'goal';
    isOwnGoal = true;
  } else if (code === 38) {
    eventType = 'penalty';
  } else if (code === 43) {
    eventType = 'yellowcard';
  } else if (code === 44 || code === 45) {
    eventType = 'redcard';
  } else if (code === 62) {
    eventType = 'substitution';
  }
  if (!eventType) return;

  const side = asInt(entry.Nm);
  const teamId = side === 1 ? home.id : side === 2 ? away.id : undefined;
  const playerName = liveScorePlayerName(entry);
  const playerId = asString(entry.ID) ?? asString(entry.Aid);
  const scoreArr = asArray(entry.Sc);
  const scoreHome = scoreArr.length >= 2 ? asInt(scoreArr[0]) : null;
  const scoreAway = scoreArr.length >= 2 ? asInt(scoreArr[1]) : null;
  const minuteAdded = asInt(entry.MinEx);

  out.push({
    event_type: eventType,
    minute,
    minute_added: minuteAdded !== null && minuteAdded > 0 ? minuteAdded : undefined,
    period,
    team_id: teamId,
    player: playerName ? { id: playerId, name: playerName } : undefined,
    score_home: scoreHome,
    score_away: scoreAway,
    is_penalty: isPenalty || undefined,
    is_own_goal: isOwnGoal || undefined,
  });
}

export function parseLiveScoreIncidents(raw: unknown, detail: MatchDetail): EventsPayload | null {
  if (!isRecord(raw) || !isRecord(raw.Incs)) return null;
  const events: MatchEvent[] = [];
  const periodKeys = Object.keys(raw.Incs).sort((a, b) => Number(a) - Number(b));
  for (const period of periodKeys) {
    for (const item of asArray(raw.Incs[period])) {
      if (isRecord(item)) {
        pushLiveScoreIncident(events, item, period, detail.home_team, detail.away_team);
      }
    }
  }
  events.sort((a, b) => a.minute - b.minute || (a.minute_added ?? 0) - (b.minute_added ?? 0));
  return { match_id: detail.id, events };
}

function statNum(record: Record<string, unknown>, key: string): number | null {
  return asInt(record[key]);
}

function buildStatItem(
  key: string,
  title: string,
  home: number | null,
  away: number | null,
  formatType?: string,
): StatItem | null {
  if (home === null && away === null) return null;
  const suffix = formatType === 'percentage' ? '%' : '';
  return {
    key,
    title,
    home: home === null ? '0' : `${home}${suffix}`,
    away: away === null ? '0' : `${away}${suffix}`,
    format_type: formatType,
  };
}

export function parseLiveScoreStats(raw: unknown, detail: MatchDetail): StatsPayload | null {
  if (!isRecord(raw)) return null;
  const rows = asArray(raw.Stat).filter(isRecord);
  const homeRow = rows.find((r) => asInt(r.Tnb) === 1);
  const awayRow = rows.find((r) => asInt(r.Tnb) === 2);
  if (!homeRow || !awayRow) return null;

  const sumShots = (row: Record<string, unknown>): number | null => {
    const on = statNum(row, 'Shon');
    const off = statNum(row, 'Shof');
    const blocked = statNum(row, 'Shbl');
    if (on === null && off === null && blocked === null) return null;
    return (on ?? 0) + (off ?? 0) + (blocked ?? 0);
  };

  const topItems = [
    buildStatItem(
      'ball_possession',
      'Ball possession',
      statNum(homeRow, 'Pss'),
      statNum(awayRow, 'Pss'),
      'percentage',
    ),
    buildStatItem('total_shots', 'Total shots', sumShots(homeRow), sumShots(awayRow)),
    buildStatItem(
      'shots_on_target',
      'Shots on target',
      statNum(homeRow, 'Shon'),
      statNum(awayRow, 'Shon'),
    ),
    buildStatItem('corners', 'Corners', statNum(homeRow, 'Cos'), statNum(awayRow, 'Cos')),
    buildStatItem('fouls', 'Fouls', statNum(homeRow, 'Fls'), statNum(awayRow, 'Fls')),
  ].filter((item): item is StatItem => item !== null);

  const shotItems = [
    buildStatItem(
      'shots_off_target',
      'Shots off target',
      statNum(homeRow, 'Shof'),
      statNum(awayRow, 'Shof'),
    ),
    buildStatItem(
      'blocked_shots',
      'Blocked shots',
      statNum(homeRow, 'Shbl'),
      statNum(awayRow, 'Shbl'),
    ),
    buildStatItem(
      'keeper_saves',
      'Goalkeeper saves',
      statNum(homeRow, 'Gks'),
      statNum(awayRow, 'Gks'),
    ),
    buildStatItem('offsides', 'Offsides', statNum(homeRow, 'Ofs'), statNum(awayRow, 'Ofs')),
  ].filter((item): item is StatItem => item !== null);

  const disciplineItems = [
    buildStatItem('yellow_cards', 'Yellow cards', statNum(homeRow, 'Ycs'), statNum(awayRow, 'Ycs')),
    buildStatItem('red_cards', 'Red cards', statNum(homeRow, 'Rcs'), statNum(awayRow, 'Rcs')),
  ].filter((item): item is StatItem => item !== null);

  const groups: StatGroup[] = [];
  if (topItems.length) groups.push({ group_name: 'top_stats', items: topItems });
  if (shotItems.length) groups.push({ group_name: 'shots', items: shotItems });
  if (disciplineItems.length) groups.push({ group_name: 'discipline', items: disciplineItems });
  if (!groups.length) return null;

  return {
    match_id: detail.id,
    home_team: detail.home_team,
    away_team: detail.away_team,
    periods: [{ period: 'All', groups }],
  };
}

function parseLiveScoreTeamLineup(entry: Record<string, unknown>): TeamLineup {
  const formationNums = asArray(entry.Fo)
    .map((n) => asInt(n))
    .filter((n): n is number => n !== null && n > 0);
  const formation = formationNums.length ? formationNums.join('-') : undefined;
  const rowsCount = formationNums.length + 1; // row 1 = GK, rows 2..N = outfield lines

  const starters: LineupPlayer[] = [];
  const subs: LineupPlayer[] = [];
  let coachName: string | undefined;

  for (const rawPlayer of asArray(entry.Ps)) {
    if (!isRecord(rawPlayer)) continue;
    const pos = asInt(rawPlayer.Pos);
    const pon = (asString(rawPlayer.Pon) ?? '').toUpperCase();
    const name =
      asString(rawPlayer.Snm) ??
      [asString(rawPlayer.Fn), asString(rawPlayer.Ln)].filter(Boolean).join(' ').trim();
    if (!name) continue;
    if (pos === 10 || pon === 'COACH') {
      coachName = name;
      continue;
    }
    const id = asString(rawPlayer.Pid) ?? asString(rawPlayer.Aid) ?? name;
    const shirt = asInt(rawPlayer.Snu);
    const fp = asString(rawPlayer.Fp);

    const player: LineupPlayer = {
      player_id: id,
      name,
      shirt_number: shirt !== null ? String(shirt) : undefined,
      position_id: pos,
    };

    if (fp && /^\d+:\d+$/.test(fp)) {
      const [rowStr, colStr] = fp.split(':');
      const row = Number(rowStr);
      const col = Number(colStr);
      if (row === 1) {
        player.pitch_x = 0.05;
        player.pitch_y = 0.5;
      } else if (row >= 2 && rowsCount > 1) {
        const linePlayers = formationNums[row - 2] ?? 1;
        const fracX = rowsCount <= 2 ? 0.55 : (row - 2) / Math.max(1, rowsCount - 2);
        player.pitch_x = Number((0.24 + fracX * 0.62).toFixed(3));
        player.pitch_y = Number(
          Math.min(0.95, Math.max(0.05, (col - 0.5) / Math.max(1, linePlayers))).toFixed(3),
        );
      }
      starters.push(player);
    } else if (pos !== null && pos >= 1 && pos <= 4 && starters.length < 11) {
      starters.push(player);
    } else {
      subs.push(player);
    }
  }

  return {
    formation,
    confirmed: starters.length >= 11,
    coach: coachName ? { name: coachName } : undefined,
    starters,
    subs,
  };
}

export function parseLiveScoreLineups(raw: unknown, detail: MatchDetail): LineupsPayload | null {
  if (!isRecord(raw)) return null;
  const teams = asArray(raw.Lu).filter(isRecord);
  const homeRaw = teams.find((t) => asInt(t.Tnb) === 1);
  const awayRaw = teams.find((t) => asInt(t.Tnb) === 2);
  if (!homeRaw || !awayRaw) return null;
  const home = parseLiveScoreTeamLineup(homeRaw);
  const away = parseLiveScoreTeamLineup(awayRaw);
  if (!home.starters.length && !away.starters.length) return null;
  return {
    match_id: detail.id,
    home_team: detail.home_team,
    away_team: detail.away_team,
    home,
    away,
  };
}

function parseClockMinute(display: string | undefined): { minute: number; added?: number } | null {
  if (!display) return null;
  const match = /^(\d{1,3})'?(?:\+(\d{1,2})'?)?$/.exec(display.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  const added = match[2] ? Number(match[2]) : undefined;
  return Number.isFinite(minute) ? { minute, added } : null;
}

export function parseEspnMatchSummary(
  raw: unknown,
  detail: MatchDetail,
  fetchedAt: string | null,
  stale: boolean,
): LiveMatchSnapshot | null {
  if (!isRecord(raw)) return null;

  // 1. Header status & score
  let status = detail.status;
  let minute: string | null = null;
  let scoreHome: number | null = detail.score_home;
  let scoreAway: number | null = detail.score_away;

  const header = isRecord(raw.header) ? raw.header : null;
  const comp = header ? asArray(header.competitions).find(isRecord) : undefined;
  if (comp) {
    const st = isRecord(comp.status) ? comp.status : null;
    const stType = st && isRecord(st.type) ? st.type : null;
    const stateStr = (asString(stType?.state) ?? '').toLowerCase();
    const typeName = (asString(stType?.name) ?? '').toUpperCase();
    const clock = asString(st?.displayClock);
    if (stateStr === 'in' || typeName.includes('HALF')) {
      status = 'live';
      minute = typeName === 'STATUS_HALFTIME' ? 'HT' : (clock ?? null);
    } else if (stateStr === 'post' || typeName === 'STATUS_FULL_TIME') {
      status = 'finished';
      minute = null;
    } else if (stateStr === 'pre') {
      status = 'scheduled';
      minute = null;
    }
    for (const c of asArray(comp.competitors)) {
      if (!isRecord(c)) continue;
      const side = (asString(c.homeAway) ?? '').toLowerCase();
      const sc = status === 'live' || status === 'finished' ? asInt(c.score) : null;
      if (side === 'home') scoreHome = sc;
      else if (side === 'away') scoreAway = sc;
    }
  }

  const homeKey = clubKey(detail.home_team.name);
  const awayKey = clubKey(detail.away_team.name);
  const matchSideId = (teamObj: unknown): string | undefined => {
    if (!isRecord(teamObj)) return undefined;
    const name = asString(teamObj.displayName) ?? asString(teamObj.name);
    if (!name) return undefined;
    const k = clubKey(name);
    if (k === homeKey) return detail.home_team.id;
    if (k === awayKey) return detail.away_team.id;
    return undefined;
  };

  // 2. Key events (goals, cards, substitutions)
  const eventsList: MatchEvent[] = [];
  for (const item of asArray(raw.keyEvents)) {
    if (!isRecord(item)) continue;
    const typeObj = isRecord(item.type) ? item.type : null;
    const typeKey = (asString(typeObj?.type) ?? asString(typeObj?.text) ?? '').toLowerCase();
    const clockObj = isRecord(item.clock) ? item.clock : null;
    const parsedClock = parseClockMinute(asString(clockObj?.displayValue));
    if (!parsedClock) continue;

    let eventType: string | null = null;
    let isPenalty = false;
    let isOwnGoal = false;
    if (item.scoringPlay === true || typeKey.includes('goal')) {
      eventType = 'goal';
      if (typeKey.includes('penalty')) isPenalty = true;
      if (typeKey.includes('own')) isOwnGoal = true;
    } else if (typeKey.includes('yellow-card') || typeKey === 'yellow card') {
      eventType = 'yellowcard';
    } else if (typeKey.includes('red-card') || typeKey === 'red card') {
      eventType = 'redcard';
    } else if (typeKey.includes('substitution')) {
      eventType = 'substitution';
    }
    if (!eventType) continue;

    const firstParticipant = asArray(item.participants).find(isRecord);
    const athlete =
      firstParticipant && isRecord(firstParticipant.athlete) ? firstParticipant.athlete : null;
    const playerName = asString(athlete?.displayName) ?? asString(athlete?.shortName);
    const playerId = asString(athlete?.id);
    eventsList.push({
      event_type: eventType,
      minute: parsedClock.minute,
      minute_added: parsedClock.added,
      team_id: matchSideId(item.team),
      player: playerName ? { id: playerId, name: playerName } : undefined,
      is_penalty: isPenalty || undefined,
      is_own_goal: isOwnGoal || undefined,
    });
  }

  // 3. Boxscore statistics
  let stats: StatsPayload | null = null;
  const boxTeams = isRecord(raw.boxscore) ? asArray(raw.boxscore.teams).filter(isRecord) : [];
  if (boxTeams.length >= 2) {
    const homeBox =
      boxTeams.find((t) => matchSideId(t.team) === detail.home_team.id) ?? boxTeams[0];
    const awayBox =
      boxTeams.find((t) => matchSideId(t.team) === detail.away_team.id) ?? boxTeams[1];
    const statMap = (teamBox: Record<string, unknown>): Map<string, string> => {
      const m = new Map<string, string>();
      for (const s of asArray(teamBox.statistics)) {
        if (!isRecord(s)) continue;
        const name = asString(s.name);
        const val = asString(s.displayValue);
        if (name && val !== undefined) m.set(name, val);
      }
      return m;
    };
    const hm = homeBox ? statMap(homeBox) : new Map<string, string>();
    const am = awayBox ? statMap(awayBox) : new Map<string, string>();
    const row = (
      espnName: string,
      key: string,
      title: string,
      formatType?: string,
    ): StatItem | null => {
      const h = hm.get(espnName);
      const a = am.get(espnName);
      if (h === undefined && a === undefined) return null;
      const suffix = formatType === 'percentage' && h && !h.endsWith('%') ? '%' : '';
      return {
        key,
        title,
        home: h !== undefined ? `${h}${suffix}` : '0',
        away: a !== undefined ? `${a}${suffix}` : '0',
        format_type: formatType,
      };
    };
    const topItems = [
      row('possessionPct', 'ball_possession', 'Ball possession', 'percentage'),
      row('totalShots', 'total_shots', 'Total shots'),
      row('shotsOnTarget', 'shots_on_target', 'Shots on target'),
      row('wonCorners', 'corners', 'Corners'),
      row('foulsCommitted', 'fouls', 'Fouls'),
    ].filter((i): i is StatItem => i !== null);
    const extraItems = [
      row('saves', 'keeper_saves', 'Goalkeeper saves'),
      row('offsides', 'offsides', 'Offsides'),
      row('yellowCards', 'yellow_cards', 'Yellow cards'),
      row('redCards', 'red_cards', 'Red cards'),
    ].filter((i): i is StatItem => i !== null);
    const groups: StatGroup[] = [];
    if (topItems.length) groups.push({ group_name: 'top_stats', items: topItems });
    if (extraItems.length) groups.push({ group_name: 'discipline', items: extraItems });
    if (groups.length) {
      stats = {
        match_id: detail.id,
        home_team: detail.home_team,
        away_team: detail.away_team,
        periods: [{ period: 'All', groups }],
      };
    }
  }

  // 4. Rosters / Lineups
  let lineups: LineupsPayload | null = null;
  const rosters = asArray(raw.rosters).filter(isRecord);
  if (rosters.length >= 2) {
    const parseRoster = (r: Record<string, unknown>): TeamLineup => {
      const starters: LineupPlayer[] = [];
      const subs: LineupPlayer[] = [];
      for (const p of asArray(r.roster)) {
        if (!isRecord(p)) continue;
        const athlete = isRecord(p.athlete) ? p.athlete : null;
        const name = asString(athlete?.displayName) ?? asString(athlete?.fullName);
        if (!name) continue;
        const player: LineupPlayer = {
          player_id: asString(athlete?.id) ?? name,
          name,
          shirt_number: asString(p.jersey),
        };
        if (p.starter === true) starters.push(player);
        else subs.push(player);
      }
      return {
        formation: asString(r.formation),
        confirmed: starters.length >= 11,
        starters,
        subs,
      };
    };
    const homeR =
      rosters.find(
        (r) => asString(r.homeAway) === 'home' || matchSideId(r.team) === detail.home_team.id,
      ) ?? rosters[0];
    const awayR =
      rosters.find(
        (r) => asString(r.homeAway) === 'away' || matchSideId(r.team) === detail.away_team.id,
      ) ?? rosters[1];
    if (homeR && awayR) {
      const home = parseRoster(homeR);
      const away = parseRoster(awayR);
      if (home.starters.length || away.starters.length) {
        lineups = {
          match_id: detail.id,
          home_team: detail.home_team,
          away_team: detail.away_team,
          home,
          away,
        };
      }
    }
  }

  // 5. Live commentary (latest first, up to 12 items)
  const commentary: LiveMatchCommentaryItem[] = [];
  for (const entry of asArray(raw.commentary)) {
    if (!isRecord(entry)) continue;
    const text = asString(entry.text);
    if (!text) continue;
    const timeObj = isRecord(entry.time) ? entry.time : null;
    const min = asString(timeObj?.displayValue) ?? '';
    commentary.push({ minute: min, text });
  }
  const latestCommentary = commentary.slice(-12).reverse();

  return {
    source: 'espn',
    fetchedAt,
    stale,
    minute,
    status,
    scoreHome,
    scoreAway,
    events: eventsList.length ? { match_id: detail.id, events: eventsList } : null,
    stats,
    lineups,
    commentary: latestCommentary,
  };
}

/**
 * Resolves a PitchAPI `MatchDetail` to its live event ID on LiveScore (primary) or ESPN (fallback).
 */
export async function resolveLiveMatchRef(
  detail: MatchDetail,
  timeZone: string,
  now = new Date(),
  automatic = true,
): Promise<ResolvedLiveMatchRef | null> {
  const leagueIds = detail.league?.id ? [detail.league.id] : [];
  const espnSlug = detail.league?.id ? espnSlugForLeague(detail.league.id) : null;

  // 1. Check currently-running matches on LiveScore first (1 lightweight ~8 KB call).
  try {
    const live = await loadLiveNow({ leagueIds, timeZone, now, automatic, source: 'livescore' });
    const hit = matchLiveFixture(detail, live.matches);
    if (hit) {
      const eventId = extractSourceEventId(hit);
      if (eventId && NUMERIC_ID.test(eventId)) {
        return { source: 'livescore', eventId, leagueSlug: espnSlug, liveMatch: hit };
      }
    }
  } catch {
    /* continue to day sheet / ESPN */
  }

  // 2. Check today's LiveScore day sheet (covers HT / just-finished / just-starting fixtures).
  try {
    const day = await loadLiveDay({ leagueIds, timeZone, now, automatic });
    const hit = matchLiveFixture(detail, day.matches);
    if (hit) {
      const eventId = extractSourceEventId(hit);
      if (eventId && (hit.source !== 'livescore' || NUMERIC_ID.test(eventId))) {
        return {
          source: hit.source,
          eventId,
          leagueSlug: hit.source === 'espn' ? (espnSlug ?? 'all') : espnSlug,
          liveMatch: hit,
        };
      }
    }
  } catch {
    /* continue to ESPN */
  }

  // 3. Explicit ESPN fallback if LiveScore did not match the fixture.
  if (leagueIds.length > 0 && espnSlug) {
    try {
      const espn = await loadLiveNow({ leagueIds, timeZone, now, automatic, source: 'espn' });
      const hit = matchLiveFixture(detail, espn.matches);
      if (hit) {
        const eventId = extractSourceEventId(hit);
        if (eventId) {
          return { source: 'espn', eventId, leagueSlug: espnSlug, liveMatch: hit };
        }
      }
    } catch {
      /* no live provider available */
    }
  }

  return null;
}

/**
 * Fetches live match details (score, minute, events, stats, lineups, commentary) from
 * LiveScore (primary) or ESPN summary (fallback).
 */
export async function fetchLiveMatchSnapshot(
  detail: MatchDetail,
  ref: ResolvedLiveMatchRef,
  options: { automatic?: boolean; includeLineups?: boolean; includeStats?: boolean } = {},
): Promise<LiveMatchSnapshot | null> {
  const automatic = options.automatic ?? true;

  if (ref.source === 'livescore' && NUMERIC_ID.test(ref.eventId)) {
    const [sbRes, incRes, statRes, luRes] = await Promise.allSettled([
      api('livescore', `scoreboard/soccer/${ref.eventId}`, { automatic }),
      api('livescore', `incidents/soccer/${ref.eventId}`, { automatic }),
      options.includeStats !== false
        ? api('livescore', `statistics/soccer/${ref.eventId}`, { automatic })
        : Promise.resolve(null),
      options.includeLineups !== false
        ? api('livescore', `lineups/soccer/${ref.eventId}`, { automatic })
        : Promise.resolve(null),
    ]);

    const sbReply = sbRes.status === 'fulfilled' ? sbRes.value : null;
    const incReply = incRes.status === 'fulfilled' ? incRes.value : null;
    const statReply = statRes.status === 'fulfilled' ? statRes.value : null;
    const luReply = luRes.status === 'fulfilled' ? luRes.value : null;

    const sb = sbReply ? parseLiveScoreScoreboard(sbReply.payload) : null;
    const events = incReply ? parseLiveScoreIncidents(incReply.payload, detail) : null;
    const stats = statReply ? parseLiveScoreStats(statReply.payload, detail) : null;
    const lineups = luReply ? parseLiveScoreLineups(luReply.payload, detail) : null;

    if (sb || events || stats || lineups) {
      const fetchedAt =
        sbReply?.fetchedAt ??
        incReply?.fetchedAt ??
        statReply?.fetchedAt ??
        luReply?.fetchedAt ??
        null;
      const stale = Boolean((sbReply?.stale ?? false) || (incReply?.stale ?? false));
      return {
        source: 'livescore',
        fetchedAt,
        stale,
        minute: sb?.minute ?? ref.liveMatch.minute,
        status: sb?.status ?? ref.liveMatch.state,
        scoreHome: sb?.scoreHome ?? ref.liveMatch.score.home,
        scoreAway: sb?.scoreAway ?? ref.liveMatch.score.away,
        events,
        stats,
        lineups,
        commentary: [],
      };
    }
  }

  if (ref.source === 'espn') {
    const slug = ref.leagueSlug ?? 'all';
    const reply = await api('espn', `${slug}/summary?event=${encodeURIComponent(ref.eventId)}`, {
      automatic,
    });
    return parseEspnMatchSummary(reply.payload, detail, reply.fetchedAt ?? null, reply.stale);
  }

  return null;
}
