import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Flag, LayoutGrid, Star } from 'lucide-react';
import TeamBadge from '../../components/TeamBadge';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import { SourceLine } from '../../components/SourceLine';
import { Button, MatchRow } from '../../kit';
import { formatHumanDate, formatHumanDateTime } from '../../lib/humanDate';
import { isCompetitionVisible, useModules } from '../../lib/modules';
import { teamMatchesFavorite } from '../../lib/sportsIdentity';
import type { TodayMode } from '../../lib/navigation';
import { WatchEventButton } from '../../lib/watchIntent';
import { CatchUpPanel } from '../events/CatchUpPanel';
import { useFavoriteTeams } from '../f1/useFavorites';
import { racePresentation } from '../f1/calendarModel';
import type { JolpicaRace } from '../f1/types';
import { useFavorites } from '../football/FavoritesProvider';
import { clubKey } from '../football/clubNames';
import { HomeLayoutEditor } from '../football/HomeLayoutEditor';
import { useHomeLayout, type HomeWidgetId } from '../football/homeLayout';
import { isFollowedCompetition } from '../football/liveCompetitions';
import { findPitchMatchId, useLiveMatches, type PitchMatchReference } from '../football/liveData';
import { competitionLabel, minuteLabel } from '../football/LivePanel';
import type { LiveMatch } from '../football/liveSources';
import type { TeamCatalogueEntry } from '../football/useFootballData';
import {
  calendarDaysBetween,
  groupViewingEventsByDay,
  inDaysLabel,
  viewingDayKey,
  type ViewingEvent,
} from '../planner/plannerData';
import { ViewingPlanner } from '../planner/ViewingPlanner';
import { useResultHidden } from '../spoilers/spoilerStore';
import { usePlannerPriorities, useTodayPlanData, type TodayPlanData } from './todayData';
import {
  buildLeagueTable,
  clubSnapshot,
  f1TeamName,
  opponentName,
  type LeagueTableEntry,
} from './todayModel';
import './today.css';

const LIVE_LEAGUE_IDS = [
  'l_4WFCIZ',
  'l_0ErfuF',
  'l_0ALvwF',
  'l_1Isor4',
  'l_3FJFUl',
  'l_0eg6C9',
  'l_0bfbkO',
  'l_38d9HA',
  'l_2WZ2tt',
  'l_1XLtP0',
] as const;

function shiftDay(day: string, days: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function eventTitle(event: ViewingEvent): string {
  return event.kind === 'f1'
    ? `${racePresentation(event.race).title} · ${event.sessionLabel}`
    : event.title;
}

function clock(timestamp: number, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(timestamp);
}

function EventRow({
  event,
  now,
  tz,
  league,
  watching,
  onToggle,
  onOpen,
}: {
  event: ViewingEvent;
  now: number;
  tz: string;
  league: string;
  watching: boolean;
  onToggle: (id: string) => void;
  onOpen: (event: ViewingEvent) => void;
}) {
  return (
    <li className="today-event">
      <span className="today-event-time">
        <strong>{clock(event.start, tz)}</strong>
        <small>{formatHumanDate(event.start, tz, now)}</small>
      </span>
      <span className="today-event-body">
        <Button variant="quiet" className="today-event-title" onClick={() => onOpen(event)}>
          {eventTitle(event)}
        </Button>
        <small className="muted">
          {event.kind === 'f1' ? 'Формула 1' : league}
          {event.liveExtended ? ' · окончание уточняется' : ''}
        </small>
      </span>
      <Button
        variant="quiet"
        small
        aria-pressed={watching}
        aria-label={`${watching ? 'Убрать из плана' : 'Буду смотреть'}: ${eventTitle(event)}`}
        icon={<Star size={14} fill={watching ? 'currentColor' : 'none'} />}
        onClick={() => onToggle(event.id)}
      >
        {watching ? 'В плане' : 'Буду смотреть'}
      </Button>
    </li>
  );
}

function useEventActions(
  data: TodayPlanData,
  onOpenMatch: (matchId: string, leagueId?: string) => void,
  onOpenWeekend: (race: JolpicaRace) => void,
) {
  return useMemo(() => {
    const leagueFor = (matchId: string) => {
      for (const league of data.football.leagues) {
        if (data.football.matchesForLeague(league.id).some((match) => match.id === matchId))
          return data.football.leagueName(league.id);
      }
      return 'Футбол';
    };
    return {
      leagueFor,
      open: (event: ViewingEvent) => {
        if (event.kind === 'f1') onOpenWeekend(event.race);
        else onOpenMatch(event.match.id, leagueFor(event.match.id));
      },
    };
  }, [data.football, onOpenMatch, onOpenWeekend]);
}

function UpcomingBlock({
  data,
  onOpenMatch,
  onOpenWeekend,
}: {
  data: TodayPlanData;
  onOpenMatch: (matchId: string, leagueId?: string) => void;
  onOpenWeekend: (race: JolpicaRace) => void;
}) {
  const [priorities, toggle] = usePlannerPriorities();
  const actions = useEventActions(data, onOpenMatch, onOpenWeekend);
  const tomorrow = shiftDay(data.today, 1);
  // «Сейчас» already shows running matches; «Ближайшее» lists only what is ahead.
  const upcoming = data.plan.events.filter((event) => event.state === 'upcoming');
  const todayAndTomorrow = upcoming.filter((event) => {
    const day = viewingDayKey(event.start, data.tz);
    return day === data.today || day === tomorrow;
  });
  const nextDay = todayAndTomorrow.length
    ? undefined
    : groupViewingEventsByDay(
        upcoming.filter((event) => event.start >= data.now),
        data.tz,
      )[0];
  const events = nextDay?.events ?? todayAndTomorrow;
  if (!events.length) return null;
  return (
    <section className="panel today-block" data-block="upcoming">
      <div className="today-block-heading">
        <h2>Ближайшее</h2>
      </div>
      {nextDay && (
        <p className="muted small today-next-note">
          Ближайшие события — {inDaysLabel(calendarDaysBetween(data.today, nextDay.date))}.
        </p>
      )}
      <ul className="today-events">
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            now={data.now}
            tz={data.tz}
            league={event.kind === 'football' ? actions.leagueFor(event.match.id) : 'Формула 1'}
            watching={priorities.includes(event.id)}
            onToggle={toggle}
            onOpen={actions.open}
          />
        ))}
      </ul>
    </section>
  );
}

function WeekView({
  data,
  onOpenMatch,
  onOpenWeekend,
}: {
  data: TodayPlanData;
  onOpenMatch: (matchId: string, leagueId?: string) => void;
  onOpenWeekend: (race: JolpicaRace) => void;
}) {
  const [priorities, toggle] = usePlannerPriorities();
  const actions = useEventActions(data, onOpenMatch, onOpenWeekend);
  const end = shiftDay(data.today, 7);
  const groups = useMemo(
    () =>
      groupViewingEventsByDay(
        data.plan.events.filter((event) => viewingDayKey(event.start, data.tz) < end),
        data.tz,
      ),
    [data.plan.events, data.tz, end],
  );
  return (
    <div className="today-week">
      {data.loading && !data.plan.events.length && (
        <LoadingBlock label="Загружаем расписание…" rows={3} />
      )}
      {!data.loading && !groups.length && (
        <EmptyBlock
          title="На этой неделе событий нет"
          message="Ближайшие матчи и заезды появятся, когда расписание обновится."
        />
      )}
      {groups.map((group) => (
        <section className="today-week-day" key={group.date}>
          <h2>{formatHumanDate(group.date, data.tz, data.now)}</h2>
          <ul className="today-events">
            {group.events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                now={data.now}
                tz={data.tz}
                league={event.kind === 'football' ? actions.leagueFor(event.match.id) : 'Формула 1'}
                watching={priorities.includes(event.id)}
                onToggle={toggle}
                onOpen={actions.open}
              />
            ))}
          </ul>
        </section>
      ))}
      <SourceLine
        sources={['pitch', ...(data.schedule.data ? ['jolpica'] : [])]}
        fetchedAt={data.fetchedAt}
        oldest
        stale={data.stale}
        timezone={data.tz}
      />
    </div>
  );
}

function LiveNowBlock({
  matches,
  pitchMatches,
  onOpenMatch,
}: {
  matches: readonly LiveMatch[];
  pitchMatches: readonly PitchMatchReference[];
  onOpenMatch: (matchId: string, leagueId?: string) => void;
}) {
  if (!matches.length) return null;
  return (
    <section className="panel today-block" data-block="live">
      <div className="today-block-heading">
        <h2>Сейчас</h2>
      </div>
      <ul className="today-live-list">
        {matches.map((match) => {
          const minute = minuteLabel(match.minute);
          const pitchMatchId = findPitchMatchId(match, pitchMatches);
          return (
            <li key={match.id}>
              <MatchRow
                size="compact"
                status="live"
                minute={minute}
                home={{ name: match.home.name }}
                away={{ name: match.away.name }}
                score={{ home: match.score.home, away: match.score.away }}
                competition={competitionLabel(match)}
                actions={
                  <>
                    {pitchMatchId && (
                      <Button
                        small
                        onClick={() => onOpenMatch(pitchMatchId, match.leagueId ?? undefined)}
                      >
                        Открыть
                      </Button>
                    )}
                    <WatchEventButton
                      intent={{
                        sport: 'football',
                        key: match.id,
                        title: `${match.home.name} — ${match.away.name}`,
                      }}
                    />
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ClubTile({
  team,
  table,
  matches,
  now,
  tz,
  onOpen,
}: {
  team: TeamCatalogueEntry;
  table: Map<string, LeagueTableEntry> | undefined;
  matches: TodayPlanData['football']['allMatches'];
  now: number;
  tz: string;
  onOpen: () => void;
}) {
  const snapshot = useMemo(() => clubSnapshot(matches, team.id, now), [matches, team.id, now]);
  const place = table?.get(team.id)?.position ?? null;
  const last = snapshot.last;
  const next = snapshot.next;
  const hidden = useResultHidden('football', last?.id);
  const lastScore =
    last && !hidden && last.score_home !== null && last.score_away !== null
      ? `${last.score_home}:${last.score_away}`
      : '? : ?';
  const lastText = last
    ? `${formatHumanDate(last.time_utc ?? last.date ?? null, tz, now)} · ${lastScore} · ${opponentName(last, team.id)}`
    : '—';
  const nextText = next
    ? `${formatHumanDateTime(next.time_utc ?? next.date ?? null, tz, now)} · ${opponentName(next, team.id)}`
    : '—';
  return (
    <Button
      variant="quiet"
      className="today-team-tile"
      onClick={onOpen}
      aria-label={`Открыть ${team.name}`}
    >
      <span className="today-team-logo">
        <TeamBadge name={team.name} imageUrl={team.image_url} size={34} />
      </span>
      <span className="today-team-name">{team.name}</span>
      <span className="today-team-place">{place ? `${place}-е` : '—'}</span>
      <span className="today-team-line">{lastText}</span>
      <span className="today-team-line muted">Далее · {nextText}</span>
    </Button>
  );
}

function MyTeamsBlock({
  data,
  onOpenTeam,
  onOpenF1,
}: {
  data: TodayPlanData;
  onOpenTeam: (teamId: string, teamName?: string, leagueId?: string) => void;
  onOpenF1: () => void;
}) {
  const { favoriteTeamNames } = useFavorites();
  const [f1TeamIds] = useFavoriteTeams();
  const favoriteClubs = useMemo(
    () => data.football.teams.filter((team) => teamMatchesFavorite(team.name, favoriteTeamNames)),
    [data.football.teams, favoriteTeamNames],
  );
  const tables = useMemo(
    () =>
      new Map(
        data.football.leagues.map((league) => [
          league.id,
          buildLeagueTable(data.football.matchesForLeague(league.id)),
        ]),
      ),
    [data.football],
  );
  if (!favoriteClubs.length && !f1TeamIds.length) return null;
  return (
    <section className="panel today-block" data-block="teams">
      <div className="today-block-heading">
        <h2>Мои команды</h2>
      </div>
      <div className="today-team-grid">
        {favoriteClubs.map((team) => (
          <ClubTile
            key={team.id}
            team={team}
            table={tables.get(team.leagueId)}
            matches={data.football.matchesForLeague(team.leagueId)}
            now={data.now}
            tz={data.tz}
            onOpen={() => onOpenTeam(team.id, team.name, team.leagueId)}
          />
        ))}
        {f1TeamIds.map((id) => (
          <Button
            variant="quiet"
            className="today-team-tile today-team-f1"
            key={`f1-${id}`}
            onClick={onOpenF1}
            aria-label={`Открыть ${f1TeamName(id)} в Формуле 1`}
          >
            <span className="today-team-logo">
              <Flag size={26} />
            </span>
            <span className="today-team-name">{f1TeamName(id)}</span>
            <span className="today-team-line muted">Формула 1</span>
          </Button>
        ))}
      </div>
    </section>
  );
}

function TodayOverview({
  data,
  onOpenMatch,
  onOpenTeam,
  onOpenWeekend,
  onOpenF1,
}: {
  data: TodayPlanData;
  onOpenMatch: (matchId: string, leagueId?: string) => void;
  onOpenTeam: (teamId: string, teamName?: string, leagueId?: string) => void;
  onOpenWeekend: (race: JolpicaRace) => void;
  onOpenF1: () => void;
}) {
  const modules = useModules();
  const visibleLeagueIds = useMemo(
    () => LIVE_LEAGUE_IDS.filter((id) => isCompetitionVisible(id)),
    [modules],
  );
  const live = useLiveMatches({ leagueIds: visibleLeagueIds });
  const { favoriteTeamNames } = useFavorites();
  const favoriteKeys = useMemo(
    () => new Set(favoriteTeamNames.map((name) => clubKey(name))),
    [favoriteTeamNames],
  );
  const followed = useMemo(() => new Set<string>(visibleLeagueIds), [visibleLeagueIds]);
  const liveMatches = live.matches.filter(
    (match) =>
      match.state === 'live' &&
      (match.leagueId === null || isCompetitionVisible(match.leagueId)) &&
      ((match.leagueId !== null && followed.has(match.leagueId)) ||
        isFollowedCompetition(match.competition) ||
        favoriteKeys.has(match.home.clubKey) ||
        favoriteKeys.has(match.away.clubKey)),
  );
  const pitchMatches = useMemo(
    () =>
      data.football.leagues.flatMap((league) =>
        data.football.matchesForLeague(league.id).map((match) => ({ leagueId: league.id, match })),
      ),
    [data.football],
  );
  const layout = useHomeLayout('classic', 'today');
  const [editing, setEditing] = useState(false);
  const blocks: Record<HomeWidgetId, ReactNode> = {
    catchup: <CatchUpPanel headingCount block />,
    live: (
      <LiveNowBlock matches={liveMatches} pitchMatches={pitchMatches} onOpenMatch={onOpenMatch} />
    ),
    upcoming: <UpcomingBlock data={data} onOpenMatch={onOpenMatch} onOpenWeekend={onOpenWeekend} />,
    teams: <MyTeamsBlock data={data} onOpenTeam={onOpenTeam} onOpenF1={onOpenF1} />,
    insights: null,
    calendar: null,
    clubs: null,
    editorial: null,
  };
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  const liveFetchedAt = live.fetchedAt;
  const fetchedAt = [data.fetchedAt, liveFetchedAt]
    .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const sources = [
    'pitch',
    ...(data.schedule.data ? ['jolpica'] : []),
    ...(live.source ? [live.source] : []),
  ];
  return (
    <div className="today-overview">
      <div className="today-toolbar today-toolbar-end">
        <Button
          variant="quiet"
          small
          icon={<LayoutGrid size={14} />}
          aria-expanded={editing}
          onClick={() => setEditing((value) => !value)}
        >
          Настроить
        </Button>
      </div>
      {editing && (
        <HomeLayoutEditor design="classic" scope="today" onClose={() => setEditing(false)} />
      )}
      {data.football.matchesLoading && !data.football.allMatches.length && (
        <LoadingBlock label="Собираем ваш спортивный день…" rows={3} />
      )}
      {data.football.matchesError && !data.football.allMatches.length && (
        <ErrorBlock
          title="Расписание временно недоступно"
          message={data.football.matchesError}
          onRetry={data.football.reload}
        />
      )}
      <div className="today-blocks">
        {visible.map((id) => (
          <Fragment key={id}>{blocks[id]}</Fragment>
        ))}
      </div>
      {!visible.length && (
        <EmptyBlock
          title="Все блоки скрыты"
          message="Нажмите «Настроить», чтобы вернуть нужные блоки."
        />
      )}
      <SourceLine
        sources={sources}
        fetchedAt={fetchedAt ?? null}
        oldest
        stale={data.stale || (live.stale && liveMatches.length > 0)}
        timezone={data.tz}
      />
    </div>
  );
}

export interface TodayViewProps {
  mode: TodayMode;
  onModeChange: (mode: TodayMode) => void;
  onOpenMatch: (matchId: string, leagueId?: string) => void;
  onOpenTeam: (teamId: string, teamName?: string, leagueId?: string) => void;
  onOpenWeekend: (race: JolpicaRace) => void;
  onOpenF1: () => void;
}

function TodayBoard({ mode, onOpenMatch, onOpenTeam, onOpenWeekend, onOpenF1 }: TodayViewProps) {
  const data = useTodayPlanData();
  return (
    <div className="today-view">
      {mode === 'week' ? (
        <WeekView data={data} onOpenMatch={onOpenMatch} onOpenWeekend={onOpenWeekend} />
      ) : (
        <TodayOverview
          data={data}
          onOpenMatch={onOpenMatch}
          onOpenTeam={onOpenTeam}
          onOpenWeekend={onOpenWeekend}
          onOpenF1={onOpenF1}
        />
      )}
    </div>
  );
}

/** «Сегодня» with three modes: today, the next seven days and the viewing planner. */
export function TodayView(props: TodayViewProps) {
  if (props.mode === 'plan')
    return (
      <div className="today-view">
        <ViewingPlanner
          onOpenMatch={props.onOpenMatch}
          onOpenWeekend={(race) => props.onOpenWeekend(race)}
        />
      </div>
    );
  return <TodayBoard {...props} />;
}
