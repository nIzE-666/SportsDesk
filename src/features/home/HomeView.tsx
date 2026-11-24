import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import { SourceLine } from '../../components/SourceLine';
import { SegmentedControl, ShowcaseShelf } from '../../kit';
import { isCompetitionVisibleWith, useModules } from '../../lib/modules';
import { teamMatchesFavorite } from '../../lib/sportsIdentity';
import { useNow } from '../../lib/useNow';
import { useViewState } from '../../lib/useViewState';
import { useFavorites } from '../football/FavoritesProvider';
import { useLiveMatches } from '../football/liveData';
import { formatShortDate, getString, getUserTimezone, STORAGE_KEYS } from '../football/storage';
import {
  readNotificationsEnabled,
  resolveFavoriteTeamNames,
  resolveFavoriteTeams,
} from '../football/usePoller';
import { readPolicy } from '../settings/notificationPolicy';
import { spoilerKey, useSpoilerSet } from '../spoilers/spoilerStore';
import { usePlannerPriorities } from '../today/todayData';
import {
  FinishedTile,
  FixtureHero,
  LiveCard,
  UpcomingTile,
  type MatchOpening,
  type OpenMatch,
} from './HomeCards';
import { HomeRaceBand } from './HomeRaceBand';
import { HomeTrack, type OpenWeekend } from './HomeTrack';
import { useHomeF1 } from './homeF1';
import {
  collectHomeMatches,
  DAY_MS,
  mondayOf,
  selectBest,
  selectLiveMatches,
  selectUpcoming,
} from './homeModel';
import {
  HIDE_HOME_INTEREST_KEY,
  HOME_REMINDERS_KEY,
  readHomeReminders,
  toggleHomeReminder,
} from './homePreferences';
import { useHomeWeek } from './useHomeWeek';
import {
  earlierFetchedAt,
  FOLLOWED_COMPETITION_IDS,
  localDayKey,
  localMidnightUtc,
  shiftDayKey,
} from './weekData';
import './home.css';

const FILTERS = [
  { id: 'all', label: 'Всё' },
  { id: 'football', label: 'Футбол' },
  { id: 'f1', label: 'Формула 1' },
] as const;
type Filter = (typeof FILTERS)[number]['id'];
const isFilter = (value: unknown): value is Filter => FILTERS.some(({ id }) => id === value);

export function HomeView({
  onOpenMatch,
  onOpenWeekend,
}: {
  onOpenMatch: OpenMatch;
  onOpenWeekend: OpenWeekend;
}) {
  const now = useNow();
  const timezone = getUserTimezone();
  const today = localDayKey(now, timezone);
  const [filter, setFilter] = useViewState<Filter>('home.sport', 'all', isFilter);
  const [offset, setOffset] = useState(0);
  const [reminders, setReminders] = useState(readHomeReminders);
  const [planned, togglePlan] = usePlannerPriorities();
  useEffect(() => {
    const sync = (event: Event) => {
      const key =
        event instanceof StorageEvent
          ? event.key
          : (event as CustomEvent<{ key?: string }>).detail?.key;
      if (
        key &&
        !key.startsWith('sportsdesk.notifications') &&
        key !== HOME_REMINDERS_KEY &&
        key !== STORAGE_KEYS.favoritesTeams &&
        key !== STORAGE_KEYS.catalogue
      )
        return;
      setReminders(readHomeReminders());
    };
    window.addEventListener('storage', sync);
    window.addEventListener('sportsdesk-storage-changed', sync);
    window.addEventListener('sportsdesk-favorites-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('sportsdesk-storage-changed', sync);
      window.removeEventListener('sportsdesk-favorites-changed', sync);
    };
  }, []);
  const showFootball = filter !== 'f1';
  const showF1 = filter !== 'football';
  const weekStart = shiftDayKey(mondayOf(today), offset * 7);
  const week = useHomeWeek(now, weekStart, showFootball);
  const modules = useModules();
  const leagueIds = useMemo(
    () =>
      showFootball
        ? FOLLOWED_COMPETITION_IDS.filter((id) => isCompetitionVisibleWith(id, modules))
        : [],
    [modules, showFootball],
  );
  const liveData = useLiveMatches({ leagueIds });
  const f1 = useHomeF1(now, timezone, showF1);
  const { teamIds, favoriteTeamNames } = useFavorites();
  const spoilerIds = useSpoilerSet();
  const finishedLive = useRef(new Set<string>());
  useEffect(() => {
    if (liveData.stale || liveData.error || !showFootball || !leagueIds.length) return;
    let needsRefresh = false;
    for (const item of liveData.matches) {
      if (item.state === 'live') finishedLive.current.add(item.id);
      if (item.state === 'finished' && finishedLive.current.delete(item.id)) needsRefresh = true;
    }
    if (needsRefresh) week.reload();
  }, [
    liveData.matches,
    liveData.stale,
    liveData.error,
    week.reload,
    leagueIds.length,
    showFootball,
  ]);

  const opening: MatchOpening = {
    open: onOpenMatch,
    hideInterest: getString(HIDE_HOME_INTEREST_KEY) === '1',
    isHidden: (match) => spoilerIds.has(spoilerKey('football', match.summary.id)),
    isFavorite: ({ summary }) =>
      [summary.home_team, summary.away_team].some(
        (team) => teamIds.includes(team.id) || teamMatchesFavorite(team.name, favoriteTeamNames),
      ),
  };
  const matches = useMemo(
    () => collectHomeMatches(week),
    [week.days, week.events, week.seasonMatches],
  );
  const notificationsEnabled = readNotificationsEnabled();
  const notificationPolicy = readPolicy();
  const notifiedTeams = resolveFavoriteTeams();
  const unresolvedNames = resolveFavoriteTeamNames().filter(
    (name) => !notifiedTeams.some((team) => teamMatchesFavorite(team.name, [name])),
  );
  const matchById = useMemo(
    () => new Map(matches.map((match) => [match.summary.id, match])),
    [matches],
  );
  const isReminderDeliverable = (item: (typeof reminders)[number]): boolean => {
    if (!notificationsEnabled || !notificationPolicy.events.reminder) return false;
    if (!item.fixture) return true;
    const target = matchById.get(item.fixture.id);
    if (!target) return true;
    const teams = [target.summary.home_team, target.summary.away_team];
    const applicableTeams = [
      ...notifiedTeams.filter(({ id }) => teams.some((team) => team.id === id)).map(({ id }) => id),
      ...unresolvedNames.filter((name) =>
        teams.some((team) => teamMatchesFavorite(team.name, [name])),
      ),
    ];
    return (
      applicableTeams.length === 0 ||
      applicableTeams.some((id) => {
        const teamPolicy = notificationPolicy.teams[id];
        return !teamPolicy || (teamPolicy.enabled !== false && teamPolicy.reminder !== false);
      })
    );
  };
  const actions = {
    planned,
    reminders,
    togglePlan,
    toggleReminder: (item: (typeof reminders)[number]) =>
      setReminders(toggleHomeReminder(item, now)),
    isReminderDeliverable,
  };
  const visibleMatches = useMemo(
    () => matches.filter(({ leagueId }) => leagueIds.includes(leagueId)),
    [matches, leagueIds],
  );
  const live = useMemo(
    () =>
      showFootball
        ? selectLiveMatches(
            liveData.matches.filter(({ leagueId }) => leagueId && leagueIds.includes(leagueId)),
            visibleMatches,
          )
        : [],
    [showFootball, liveData.matches, leagueIds, visibleMatches],
  );
  const hiddenUnmatched = useMemo(
    () => [...spoilerIds].some((key) => key.startsWith('football:')),
    [spoilerIds],
  );
  const from = localMidnightUtc(shiftDayKey(today, -7), timezone);
  const through = localMidnightUtc(shiftDayKey(today, 8), timezone);
  const best = useMemo(
    () => selectBest(visibleMatches, from, now).slice(0, 12),
    [visibleMatches, from, now],
  );
  const upcoming = useMemo(
    () => selectUpcoming(visibleMatches, now, through),
    [visibleMatches, now, through],
  );
  const upcomingSessions = f1.sessions.filter(
    (session) =>
      session.start > now &&
      session.start < through &&
      ['qualifying', 'sprint', 'race'].includes(session.id),
  );
  const footballHero = upcoming.find((match) => match.start < now + 3 * DAY_MS) ?? best[0];
  const firstLive = live[0];
  const liveHero = firstLive && (firstLive.points >= 4 || !footballHero) ? firstLive : null;
  const hero = liveHero ? null : footballHero;
  const nextMatch = upcoming.reduce<number | null>(
    (next, match) => (next === null ? match.start : Math.min(next, match.start)),
    null,
  );
  const dateShown =
    nextMatch === null ? null : formatShortDate(new Date(nextMatch).toISOString(), timezone);
  const someData = Boolean(visibleMatches.length || live.length || f1.sessions.length || f1.latest);
  const loading = (showFootball && week.loading) || (showF1 && f1.loading);
  const hasError =
    (showFootball && week.errors.some((error) => error.scope !== 'events')) || (showF1 && f1.error);
  const fetchedAt = [
    ...(showFootball ? [week.fetchedAt, liveData.fetchedAt] : []),
    ...(showF1 ? f1.fetchedAt : []),
  ].reduce<string | null>(earlierFetchedAt, null);
  const sources = [
    ...(showFootball && week.fetchedAt ? ['pitch'] : []),
    ...(showFootball && liveData.fetchedAt && liveData.source ? [liveData.source] : []),
    ...(showF1 && f1.fetchedAt.some(Boolean) ? ['jolpica'] : []),
  ];
  const stale =
    (showFootball && (week.stale || liveData.stale || (live.length > 0 && !!liveData.error))) ||
    (showF1 && f1.stale);
  const reload = () => {
    if (showFootball && leagueIds.length) {
      week.reload();
      liveData.refresh();
    }
    if (showF1) f1.reload();
  };

  return (
    <div className="showcase home-screen">
      <div className="home-controls">
        <SegmentedControl
          ariaLabel="Вид спорта"
          items={FILTERS}
          value={filter}
          onChange={(value) => {
            if (isFilter(value)) setFilter(value);
          }}
        />
      </div>
      {liveHero ? (
        <LiveCard
          key={liveHero.live.id}
          entry={liveHero}
          opening={opening}
          hiddenUnmatched={hiddenUnmatched}
          hero
        />
      ) : hero ? (
        <FixtureHero
          key={hero.summary.id}
          match={hero}
          opening={opening}
          actions={actions}
          timezone={timezone}
        />
      ) : showFootball && !loading && !hasError && dateShown ? (
        <EmptyBlock title="Главный матч" message={`Ближайшие матчи — ${dateShown}.`} />
      ) : null}
      {!someData && loading && <LoadingBlock label="Загружаем расписание…" rows={2} />}
      {!someData && !loading && hasError && (
        <ErrorBlock
          title="Расписание недоступно"
          message="Проверьте связь и попробуйте снова."
          onRetry={reload}
        />
      )}
      <HomeTrack
        weekStart={weekStart}
        now={now}
        timezone={timezone}
        matches={visibleMatches}
        live={live}
        sessions={showF1 ? f1.sessions : []}
        featuredId={hero?.summary.id ?? liveHero?.match?.summary.id}
        opening={opening}
        onOpenWeekend={onOpenWeekend}
        offset={offset}
        onShift={setOffset}
      />
      {showFootball && (
        <ShowcaseShelf
          title="Лучшее за неделю"
          headingLevel={2}
          emptyText={week.loading ? 'Ищем завершённые матчи…' : 'Завершённых матчей пока нет.'}
        >
          {best.map((match) => (
            <FinishedTile
              key={match.summary.id}
              match={match}
              opening={opening}
              timezone={timezone}
            />
          ))}
        </ShowcaseShelf>
      )}
      <ShowcaseShelf
        title="Главное впереди"
        headingLevel={2}
        emptyText={loading ? 'Загружаем расписание…' : 'Ближайших событий пока нет.'}
      >
        {upcoming.slice(0, 9).map((match) => (
          <UpcomingTile
            key={match.summary.id}
            match={match}
            timezone={timezone}
            actions={actions}
            favorite={opening.isFavorite(match)}
            onOpen={() => onOpenMatch(match.summary.id, match.leagueId)}
          />
        ))}
        {upcomingSessions.map((session) => (
          <UpcomingTile
            key={session.key}
            session={session}
            timezone={timezone}
            actions={actions}
            onOpen={() => onOpenWeekend(session.race.season, session.race.round)}
          />
        ))}
      </ShowcaseShelf>
      {live.length > 0 && (
        <section className="home-live" aria-labelledby="home-live-heading">
          <h2 id="home-live-heading" className="ui-showcase-shelf__title">
            Сейчас идут
          </h2>
          <ul className="home-live-list">
            {live.map((entry) => (
              <li key={entry.live.id}>
                <LiveCard entry={entry} opening={opening} hiddenUnmatched={hiddenUnmatched} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {showF1 && <HomeRaceBand data={f1} onOpenWeekend={onOpenWeekend} />}
      <SourceLine
        sources={sources}
        fetchedAt={fetchedAt}
        stale={stale}
        oldest
        timezone={timezone}
      />
    </div>
  );
}
