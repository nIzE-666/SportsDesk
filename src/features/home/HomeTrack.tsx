import { ShowcaseCrest, WeekTrack, type WeekTrackEvent } from '../../kit';
import { scoreText } from '../spoilers/spoilerStore';
import type { HomeSession } from './homeF1';
import {
  homeInterest,
  liveInterest,
  matchTitle,
  scoreValue,
  toShowcaseTeam,
  TRACK_MARKS_PER_DAY,
  type HomeLiveMatch,
  type HomeMatch,
} from './homeModel';
import type { MatchOpening } from './HomeCards';
import { localDayKey, localMidnightUtc, shiftDayKey } from './weekData';

interface TrackEntry extends WeekTrackEvent {
  weight: number;
  match?: HomeMatch;
  live?: HomeLiveMatch;
  session?: HomeSession;
}

export type OpenWeekend = (season: string | number, round: string | number) => void;

export function HomeTrack({
  weekStart,
  now,
  timezone,
  matches,
  live,
  sessions,
  featuredId,
  opening,
  onOpenWeekend,
  offset,
  onShift,
}: {
  weekStart: string;
  now: number;
  timezone: string;
  matches: HomeMatch[];
  live: HomeLiveMatch[];
  sessions: HomeSession[];
  featuredId?: string;
  opening: MatchOpening;
  onOpenWeekend: OpenWeekend;
  offset: number;
  onShift: (offset: number) => void;
}) {
  const throughDay = shiftDayKey(weekStart, 7);
  const liveById = new Map(
    live.filter((entry) => entry.match).map((entry) => [entry.match!.summary.id, entry]),
  );
  const byDay = new Map<string, TrackEntry[]>();
  const add = (entry: TrackEntry, start: number) => {
    const day = localDayKey(start, timezone);
    if (day < weekStart || day >= throughDay) return;
    const entries = byDay.get(day) ?? [];
    entries.push(entry);
    byDay.set(day, entries);
  };
  for (const match of matches) {
    const current = liveById.get(match.summary.id);
    if (!match.finished && match.start <= now && !current) continue;
    const featured = featuredId === match.summary.id;
    const hidden = opening.isHidden(match);
    add(
      {
        id: `match-${match.summary.id}`,
        kind: 'match',
        label: matchTitle(match.summary.home_team.name, match.summary.away_team.name),
        start: match.iso,
        interest:
          hidden && opening.hideInterest
            ? null
            : current
              ? liveInterest(current)
              : homeInterest(match),
        mine: opening.isFavorite(match),
        featured,
        weight: featured
          ? 300
          : current
            ? 100 + current.points
            : (match.finished?.points ?? match.upcoming?.score ?? 0),
        match,
        live: current,
      },
      match.start,
    );
  }
  for (const session of sessions) {
    if (session.id !== 'race' && session.id !== 'sprint') continue;
    add(
      {
        id: `race-${session.key}`,
        kind: 'race',
        label: `${session.title} · ${session.label}`,
        start: session.iso,
        interest: null,
        weight: 200,
        session,
      },
      session.start,
    );
  }
  const markers = [...byDay.values()].flatMap((entries) =>
    entries
      .sort((a, b) => b.weight - a.weight || a.start.localeCompare(b.start))
      .slice(0, TRACK_MARKS_PER_DAY),
  );
  const byId = new Map(markers.map((marker) => [marker.id, marker]));
  return (
    <WeekTrack
      weekStart={new Date(localMidnightUtc(weekStart, timezone)).toISOString()}
      now={new Date(now).toISOString()}
      timezone={timezone}
      events={markers}
      onPrevWeek={() => onShift(offset - 1)}
      onNextWeek={() => onShift(offset + 1)}
      canPrevWeek={offset > -1}
      canNextWeek={offset < 1}
      onOpen={(id) => {
        const event = byId.get(id);
        if (event?.match) opening.open(event.match.summary.id, event.match.leagueId);
        if (event?.session) onOpenWeekend(event.session.race.season, event.session.race.round);
      }}
      renderPreview={(id) => {
        const entry = byId.get(id);
        const match = entry?.match;
        if (!match) return entry?.label;
        const { home_team, away_team, score_home, score_away } = match.summary;
        const home = entry.live ? entry.live.live.score.home : match.finished ? score_home : null;
        const away = entry.live ? entry.live.live.score.away : match.finished ? score_away : null;
        const result = scoreText(scoreValue(home), scoreValue(away), opening.isHidden(match), '');
        return (
          <div className="home-track-preview">
            <span>
              <ShowcaseCrest team={toShowcaseTeam(home_team)} size="tip" />
              {home_team.name}
            </span>
            <span>
              <ShowcaseCrest team={toShowcaseTeam(away_team)} size="tip" />
              {away_team.name}
            </span>
            {result && <strong>{result}</strong>}
            <small>{match.competition}</small>
          </div>
        );
      }}
    />
  );
}
