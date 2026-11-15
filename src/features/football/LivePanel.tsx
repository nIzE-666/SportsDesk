import { RefreshCw } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { SourceLine } from '../../components/SourceLine';
import {
  Badge,
  Button,
  EmptyState,
  MatchRow,
  SegmentedControl,
  Skeleton,
  type MatchRowStatus,
} from '../../kit';
import { isCompetitionVisible, useModules } from '../../lib/modules';
import { LEAGUES } from '../../lib/navigationMetadata';
import { useViewState } from '../../lib/useViewState';
import { useResultHidden } from '../spoilers/spoilerStore';
import { CUP_COMPETITIONS } from '../ucl/cups';
import { clubKey } from './clubNames';
import { useFavorites } from './FavoritesProvider';
import { isFollowedCompetition } from './liveCompetitions';
import { findPitchMatchId, useLiveMatches, type PitchMatchReference } from './liveData';
import type { LiveMatch, LiveState } from './liveSources';
import { getUserTimezone } from './storage';
import { MatchList } from './MatchList';

/** The same ten followed competitions the panel has always shown. */
const LEAGUE_IDS = [
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
const COMPETITION_LABELS = new Map<string, string>([
  ...LEAGUES.map((league) => [league.id, league.label] as const),
  ...CUP_COMPETITIONS.map((cup) => [cup.id, cup.title] as const),
]);

const NUMERIC_MINUTE = /^\d{1,3}(?:'\+\d{1,2}|\+\d{1,2}|)'$/;

/** `HT` reads as a word; an unfamiliar live label is left out instead of shown raw. */
export function minuteLabel(minute: string | null): string | null {
  if (!minute) return null;
  if (minute === 'HT') return 'Перерыв';
  return NUMERIC_MINUTE.test(minute) ? minute : null;
}

export function competitionLabel(match: LiveMatch): string {
  const known = match.leagueId ? COMPETITION_LABELS.get(match.leagueId) : undefined;
  return known ?? (match.competition || 'Футбол');
}

const STATE_LABELS: Record<LiveState, string> = {
  scheduled: 'Запланирован',
  live: 'В игре',
  finished: 'Завершён',
  postponed: 'Перенесён / приостановлен',
  cancelled: 'Отменён',
  unknown: 'Статус уточняется',
};

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function kickoffTime(iso: string | null, timezone: string): string | null {
  if (!iso) return null;
  let formatter = timeFormatterCache.get(timezone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
    timeFormatterCache.set(timezone, formatter);
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatter.format(date);
}

/** The kit row knows the live-source states; the time column stays honest for the rest. */
function rowStatus(state: LiveState): MatchRowStatus {
  if (state === 'live') return 'live';
  if (state === 'finished') return 'finished';
  if (state === 'postponed') return 'postponed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'unknown') return 'unknown';
  return 'scheduled';
}

export interface LivePanelProps {
  /** PitchAPI matches already loaded by the football view, for row links. */
  pitchMatches?: readonly PitchMatchReference[];
  onOpenMatch?: (matchId: string) => void;
}

type LiveFilter = 'all' | 'live' | 'finished' | 'favorites';

const LIVE_FILTERS: readonly string[] = ['all', 'live', 'finished', 'favorites'];

/**
 * «Сейчас идут» as the live filter of «Матчи»: today's matches of the followed
 * clubs and competitions, grouped by day, with the source line of the live feed.
 */
export function LivePanel({ pitchMatches = [], onOpenMatch }: LivePanelProps) {
  const timezone = getUserTimezone();
  const { favoriteTeamNames } = useFavorites();
  const modules = useModules();
  // Список турниров внутри экрана следует выключателям модулей.
  const visibleLeagueIds = useMemo(
    () => LEAGUE_IDS.filter((id) => isCompetitionVisible(id)),
    // modules is the value read from storage; isCompetitionVisible reads the same snapshot.
    [modules],
  );
  const leagueIdSet = useMemo(() => new Set<string>(visibleLeagueIds), [visibleLeagueIds]);
  const { matches, source, fetchedAt, stale, loading, refreshing, error, refresh } = useLiveMatches(
    { leagueIds: visibleLeagueIds },
  );
  const [filter, setFilter] = useViewState<LiveFilter>('football.live.filter', 'all', (value) =>
    LIVE_FILTERS.includes(String(value)),
  );

  const favoriteKeys = useMemo(
    () => new Set(favoriteTeamNames.map((name) => clubKey(name))),
    [favoriteTeamNames],
  );
  const isFavorite = useCallback(
    (match: LiveMatch) =>
      favoriteKeys.has(match.home.clubKey) || favoriteKeys.has(match.away.clubKey),
    [favoriteKeys],
  );

  const personalMatches = useMemo(
    () =>
      matches.filter(
        (match) =>
          (match.leagueId === null || isCompetitionVisible(match.leagueId)) &&
          ((match.leagueId !== null && leagueIdSet.has(match.leagueId)) ||
            isFollowedCompetition(match.competition) ||
            isFavorite(match)),
      ),
    [matches, isFavorite, leagueIdSet],
  );
  const favoriteList = useMemo(
    () => personalMatches.filter(isFavorite),
    [personalMatches, isFavorite],
  );
  const liveCount = personalMatches.filter((match) => match.state === 'live').length;
  const visible = useMemo(() => {
    if (filter === 'live') return personalMatches.filter((match) => match.state === 'live');
    if (filter === 'finished') return personalMatches.filter((match) => match.state === 'finished');
    if (filter === 'favorites') return favoriteList;
    return personalMatches;
  }, [filter, personalMatches, favoriteList]);

  return (
    <div className="live-panel">
      <div className="live-panel__toolbar">
        <SegmentedControl
          ariaLabel="Фильтр ленты"
          value={filter}
          onChange={(id) => setFilter(id as LiveFilter)}
          items={[
            { id: 'all', label: `Все (${personalMatches.length})` },
            { id: 'live', label: `Live (${liveCount})` },
            { id: 'finished', label: 'Завершённые' },
            { id: 'favorites', label: `Избранные (${favoriteList.length})` },
          ]}
        />
        <Button
          variant="quiet"
          small
          icon={<RefreshCw size={14} aria-hidden="true" />}
          onClick={refresh}
          busy={refreshing || loading}
        >
          Обновить
        </Button>
      </div>
      {loading && matches.length === 0 && (
        <div className="matches-loading" role="status" aria-label="Загрузка матчей">
          <Skeleton className="matches-loading__row" />
          <Skeleton className="matches-loading__row" />
          <Skeleton className="matches-loading__row" />
        </div>
      )}
      {error && matches.length === 0 && (
        <EmptyState tone="error" title="Матчи недоступны" message={error} />
      )}
      {error && matches.length > 0 && (
        <EmptyState tone="error" title="Матчи не обновились" message={error} />
      )}
      {!loading && !error && personalMatches.length === 0 && (
        <EmptyState title="Нет матчей ваших клубов и турниров" message="На сегодня матчей нет." />
      )}
      {!loading && !error && personalMatches.length > 0 && visible.length === 0 && (
        <EmptyState title="Нет матчей в выбранном фильтре" message="Попробуйте другой фильтр." />
      )}

      {visible.length > 0 && (
        <MatchList
          items={visible}
          getKey={(match) => match.id}
          getTime={(match) => match.kickoffUtc}
          timezone={timezone}
          dayOrder="nearest"
          renderRow={(match) => (
            <LiveRow
              match={match}
              timezone={timezone}
              favorite={isFavorite(match)}
              pitchMatches={pitchMatches}
              onOpenMatch={onOpenMatch}
            />
          )}
        />
      )}

      <SourceLine
        sources={source ? [source] : []}
        fetchedAt={fetchedAt}
        stale={stale && matches.length > 0}
        timezone={timezone}
      />
    </div>
  );
}

function LiveRow({
  match,
  timezone,
  favorite,
  pitchMatches,
  onOpenMatch,
}: {
  match: LiveMatch;
  timezone: string;
  favorite: boolean;
  pitchMatches: readonly PitchMatchReference[];
  onOpenMatch?: (matchId: string) => void;
}) {
  const clickableId =
    onOpenMatch && pitchMatches.length > 0 ? findPitchMatchId(match, pitchMatches) : null;
  const hidden = useResultHidden('football', clickableId ?? match.id);
  const kickoff = match.state === 'scheduled' ? kickoffTime(match.kickoffUtc, timezone) : null;
  const minute = minuteLabel(match.minute);
  return (
    <MatchRow
      size="compact"
      competition={competitionLabel(match)}
      badge={favorite ? <Badge>Избранное</Badge> : undefined}
      home={{ name: match.home.name }}
      away={{ name: match.away.name }}
      time={
        match.state === 'scheduled'
          ? kickoff
          : match.state === 'cancelled' || match.state === 'unknown'
            ? STATE_LABELS[match.state]
            : null
      }
      status={rowStatus(match.state)}
      minute={minute}
      score={{ home: match.score.home, away: match.score.away }}
      hideScore={hidden}
      onClick={clickableId && onOpenMatch ? () => onOpenMatch(clickableId) : undefined}
      ariaLabel={`Открыть разбор матча: ${match.home.name} — ${match.away.name}`}
    />
  );
}
