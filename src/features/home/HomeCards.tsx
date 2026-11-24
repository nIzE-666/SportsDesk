import { useState } from 'react';
import { Star } from 'lucide-react';
import {
  Button,
  Countdown,
  MatchRow,
  ShowcaseHero,
  ShowcaseMatchCard,
  ShowcaseUpcomingCard,
} from '../../kit';
import { WatchEventButton } from '../../lib/watchIntent';
import { viewState } from '../../lib/viewState';
import { scoreText } from '../spoilers/spoilerStore';
import { footballPlannerId } from '../planner/plannerData';
import { HomeActions, type HomeActionsState } from './HomeActions';
import type { HomeSession } from './homeF1';
import {
  extractGoals,
  homeInterest,
  matchTitle,
  scoreValue,
  toShowcaseTeam,
  type HomeLiveMatch,
  type HomeMatch,
} from './homeModel';
import { spoilerSafe } from './interest';

export type OpenMatch = (matchId: string, leagueId?: string) => void;

export interface MatchOpening {
  open: OpenMatch;
  isFavorite: (match: HomeMatch) => boolean;
  isHidden: (match: HomeMatch) => boolean;
  hideInterest: boolean;
}

const weekdayFmtCache = new Map<string, Intl.DateTimeFormat>();
const dateFmtCache = new Map<string, Intl.DateTimeFormat>();
const clockFmtCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let fmt = cache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: timezone });
    cache.set(timezone, fmt);
  }
  return fmt;
}

export const shortWeekday = (start: number, timezone: string) =>
  getFormatter(weekdayFmtCache, timezone, { weekday: 'short' }).format(start);
export const shortDate = (start: number, timezone: string) =>
  getFormatter(dateFmtCache, timezone, { weekday: 'short', day: 'numeric', month: 'short' }).format(
    start,
  );
const localClock = (start: number, timezone: string) =>
  getFormatter(clockFmtCache, timezone, { hour: '2-digit', minute: '2-digit' }).format(start);

function titleOf(match: HomeMatch): string {
  return matchTitle(match.summary.home_team.name, match.summary.away_team.name);
}

function footballReminder(match: HomeMatch) {
  return {
    key: footballPlannerId(match.summary.id),
    start: match.start,
    fixture: { id: match.summary.id, leagueId: match.leagueId },
  };
}

function openAnalysis(match: HomeMatch, open: OpenMatch) {
  viewState.write(`match.${match.summary.id}.tab`, 'analysis');
  open(match.summary.id, match.leagueId);
}

function FavoriteMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="home-favorite"
      role={compact ? 'img' : undefined}
      aria-label={compact ? 'Избранное' : undefined}
      title={compact ? 'Избранное' : undefined}
    >
      <Star size={13} aria-hidden />
      {!compact && 'Избранное'}
    </span>
  );
}

export function FinishedTile({
  match,
  opening,
  timezone,
}: {
  match: HomeMatch;
  opening: MatchOpening;
  timezone: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const hidden = opening.isHidden(match) && !revealed;
  const rating = match.finished && hidden ? spoilerSafe(match.finished) : match.finished;
  const goals = hidden ? [] : extractGoals(match);
  return (
    <div className="home-tile">
      <ShowcaseMatchCard
        competition={match.competition}
        day={shortWeekday(match.start, timezone)}
        home={{
          ...toShowcaseTeam(match.summary.home_team),
          score: hidden ? null : scoreValue(match.summary.score_home),
        }}
        away={{
          ...toShowcaseTeam(match.summary.away_team),
          score: hidden ? null : scoreValue(match.summary.score_away),
        }}
        interest={hidden && opening.hideInterest ? null : homeInterest(match)}
        reasons={rating?.reasons.slice(0, 3).map((reason) => reason.text)}
        goals={goals.length ? goals : undefined}
        length={goals.some((goal) => (goal.minute ?? 0) > 90) ? 120 : 90}
        onOpen={() => opening.open(match.summary.id, match.leagueId)}
      />
      <div className="home-tile-actions">
        {opening.isFavorite(match) && <FavoriteMark />}
        {hidden && (
          <Button
            small
            variant="quiet"
            aria-label={`Показать счёт, ${titleOf(match)}`}
            onClick={() => setRevealed(true)}
          >
            Показать счёт
          </Button>
        )}
      </div>
    </div>
  );
}

export function UpcomingTile({
  match,
  session,
  timezone,
  actions,
  onOpen,
  favorite = false,
}: {
  match?: HomeMatch;
  session?: HomeSession;
  timezone: string;
  actions: HomeActionsState;
  onOpen: () => void;
  favorite?: boolean;
}) {
  const start = match?.start ?? session?.start;
  if (start === undefined) return null;
  const reminder = match ? footballReminder(match) : { key: session!.key, start };
  return (
    <div className="home-tile">
      <ShowcaseUpcomingCard
        kicker={match?.upcoming?.reasons[0]?.text ?? (session ? 'Формула 1' : undefined)}
        home={match ? toShowcaseTeam(match.summary.home_team) : undefined}
        away={match ? toShowcaseTeam(match.summary.away_team) : undefined}
        race={session?.title}
        session={session?.label}
        meta={
          <>
            {match?.competition}
            <Countdown target={new Date(start).toISOString()} endedLabel="Время начала наступило" />
          </>
        }
        time={localClock(start, timezone)}
        date={shortDate(start, timezone)}
        onOpen={onOpen}
      />
      <div className="home-tile-actions">
        {favorite && <FavoriteMark compact />}
        <HomeActions
          title={match ? titleOf(match) : `${session!.title} · ${session!.label}`}
          plannerId={match ? reminder.key : session!.plannerId}
          reminder={reminder}
          actions={actions}
          quiet
        />
      </div>
    </div>
  );
}

export function FixtureHero({
  match,
  opening,
  actions,
  timezone,
}: {
  match: HomeMatch;
  opening: MatchOpening;
  actions: HomeActionsState;
  timezone: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const hidden = opening.isHidden(match) && !revealed;
  const rating = match.finished && hidden ? spoilerSafe(match.finished) : match.finished;
  const reasons = (rating?.reasons ?? match.upcoming?.reasons)
    ?.slice(0, 3)
    .map((reason) => reason.text);
  const { home_team, away_team, score_home, score_away } = match.summary;
  const reminder = footballReminder(match);
  return (
    <ShowcaseHero
      kicker="Главный матч"
      home={toShowcaseTeam(home_team)}
      away={toShowcaseTeam(away_team)}
      meta={
        <>
          {match.competition} · {shortDate(match.start, timezone)} ·{' '}
          {localClock(match.start, timezone)}
          {opening.isFavorite(match) && <FavoriteMark />}
        </>
      }
      reasons={reasons}
      clock={
        match.upcoming ? (
          <Countdown target={match.iso} variant="board" endedLabel="Время начала наступило" />
        ) : (
          <span className="home-score">
            {scoreText(scoreValue(score_home), scoreValue(score_away), hidden, '—')}
          </span>
        )
      }
      actions={
        <>
          {match.upcoming && (
            <HomeActions
              title={titleOf(match)}
              plannerId={reminder.key}
              reminder={reminder}
              actions={actions}
            />
          )}
          {hidden && <Button onClick={() => setRevealed(true)}>Показать счёт</Button>}
          <Button
            variant={match.finished && !hidden ? 'primary' : 'default'}
            onClick={() =>
              match.finished
                ? openAnalysis(match, opening.open)
                : opening.open(match.summary.id, match.leagueId)
            }
          >
            {match.finished ? 'Разбор' : 'Открыть матч'}
          </Button>
        </>
      }
    />
  );
}

export function LiveCard({
  entry,
  opening,
  hiddenUnmatched,
  hero = false,
}: {
  entry: HomeLiveMatch;
  opening: MatchOpening;
  hiddenUnmatched: boolean;
  hero?: boolean;
}) {
  const { match, live, competition, minute } = entry;
  const home = match ? toShowcaseTeam(match.summary.home_team) : { name: live.home.name };
  const away = match ? toShowcaseTeam(match.summary.away_team) : { name: live.away.name };
  const hidden = match ? opening.isHidden(match) : hiddenUnmatched;
  const favorite = match && opening.isFavorite(match);
  const score = { home: scoreValue(live.score.home), away: scoreValue(live.score.away) };
  const actions = (
    <>
      <WatchEventButton
        intent={{
          sport: 'football',
          key: match?.summary.id ?? live.id,
          title: matchTitle(home.name, away.name),
        }}
      />
      {match && (
        <Button small onClick={() => opening.open(match.summary.id, match.leagueId)}>
          Открыть матч
        </Button>
      )}
    </>
  );
  if (hero)
    return (
      <ShowcaseHero
        kicker={<span className="home-live-tag">Главный матч · идёт</span>}
        home={home}
        away={away}
        meta={
          <>
            {competition}
            {minute && ` · ${minute}`}
            {favorite && <FavoriteMark />}
          </>
        }
        clock={<span className="home-score">{scoreText(score.home, score.away, hidden, '—')}</span>}
        actions={actions}
      />
    );
  return (
    <MatchRow
      className="home-live-row"
      status="live"
      size="compact"
      home={home}
      away={away}
      score={score}
      hideScore={hidden}
      minute={minute}
      competition={competition}
      badge={favorite ? <FavoriteMark /> : undefined}
      actions={actions}
    />
  );
}
