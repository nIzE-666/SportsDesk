import { Radio, RefreshCw, Star } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import TeamBadge from '../../components/TeamBadge';
import { SourceLine } from '../../components/SourceLine';
import { isCompetitionVisible, useModules } from '../../lib/modules';
import { useViewState } from '../../lib/useViewState';
import { LEAGUES } from '../../lib/navigationMetadata';
import { CUP_COMPETITIONS } from '../ucl/cups';
import { clubKey } from './clubNames';
import { useFavorites } from './FavoritesProvider';
import { isFollowedCompetition } from './liveCompetitions';
import { findPitchMatchId, useLiveMatches, type PitchMatchReference } from './liveData';
import type { LiveMatch, LiveState } from './liveSources';
import { getUserTimezone } from './storage';

type LiveFilter = 'all' | 'live' | 'finished' | 'favorites';

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

function competitionLabel(match: LiveMatch): string {
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

function scoreValue(value: number | null): string {
  return value === null ? '—' : String(value);
}

export interface LivePanelProps {
  /** PitchAPI matches already loaded by the football view, for row links. */
  pitchMatches?: readonly PitchMatchReference[];
  onOpenMatch?: (matchId: string) => void;
}

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
  const [filter, setFilter] = useViewState<LiveFilter>('football.live.filter', 'all', (v) =>
    ['all', 'live', 'finished', 'favorites'].includes(String(v)),
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
  const isLive = useCallback((match: LiveMatch) => match.state === 'live', []);

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
  const liveCount = personalMatches.filter(isLive).length;

  const visible = useMemo(() => {
    if (filter === 'live') return personalMatches.filter(isLive);
    if (filter === 'finished') return personalMatches.filter((match) => match.state === 'finished');
    if (filter === 'favorites') return favoriteList;
    return personalMatches;
  }, [filter, personalMatches, favoriteList, isLive]);

  return (
    <div className="live-view">
      <div className="dashboard-head">
        <div>
          <h1>
            <Radio size={18} /> Счёт и события
          </h1>
          <p className="muted small">Ваши клубы и турниры.</p>
        </div>
        <div className="dashboard-head-actions">
          <button className="ghost-btn" onClick={refresh} disabled={refreshing || loading}>
            <RefreshCw size={14} /> {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="filters-bar panel">
        <div className="filter-group grow">
          <span className="muted small">Фильтр</span>
          <div className="segmented">
            {(['all', 'live', 'finished', 'favorites'] as const).map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f === 'all'
                  ? `Все (${personalMatches.length})`
                  : f === 'live'
                    ? `Live (${liveCount})`
                    : f === 'finished'
                      ? 'Завершённые'
                      : `Избранные (${favoriteList.length})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && matches.length === 0 && <LoadingBlock label="Загрузка матчей…" rows={4} />}
      {error && matches.length === 0 && (
        <ErrorBlock title="Матчи недоступны" message={error} onRetry={refresh} />
      )}
      {!loading && !error && visible.length === 0 && personalMatches.length === 0 && (
        <EmptyBlock title="Нет матчей ваших клубов и турниров" message="На сегодня матчей нет." />
      )}
      {!loading && !error && visible.length === 0 && personalMatches.length > 0 && (
        <EmptyBlock title="Нет матчей в выбранном фильтре" message="Попробуйте другой фильтр." />
      )}

      {visible.length > 0 && (
        <section className="panel">
          <ul className="live-flat-list">
            {visible.map((m) => {
              const favorite = isFavorite(m);
              const live = isLive(m);
              const clickableId =
                onOpenMatch && pitchMatches.length > 0 ? findPitchMatchId(m, pitchMatches) : null;
              const kickoff = m.state === 'scheduled' ? kickoffTime(m.kickoffUtc, timezone) : null;
              const minute = minuteLabel(m.minute);
              const row = (
                <>
                  <div className="live-flat-comp muted small">{competitionLabel(m)}</div>
                  <div className="live-flat-teams">
                    <span className="live-team">
                      <TeamBadge name={m.home.name} size={20} />
                      <span className="truncate">{m.home.name}</span>
                    </span>
                    <strong className="live-score">
                      {scoreValue(m.score.home)} : {scoreValue(m.score.away)}
                    </strong>
                    <span className="live-team right">
                      <span className="truncate">{m.away.name}</span>
                      <TeamBadge name={m.away.name} size={20} />
                    </span>
                  </div>
                  <div className="live-meta">
                    <span className={live ? 'chip live-chip' : 'chip'}>
                      {STATE_LABELS[m.state]}
                    </span>
                    {live && minute && <span className="chip live-chip">{minute}</span>}
                    {favorite && (
                      <span className="chip fav-chip">
                        <Star size={10} /> Избранное
                      </span>
                    )}
                    {kickoff && <span className="muted small">{kickoff}</span>}
                  </div>
                </>
              );
              const className = favorite ? 'live-flat favorite' : 'live-flat';
              return (
                <li key={m.id}>
                  {clickableId && onOpenMatch ? (
                    <button
                      type="button"
                      className={`${className} live-flat-button`}
                      onClick={() => onOpenMatch(clickableId)}
                      title="Открыть разбор матча"
                    >
                      {row}
                    </button>
                  ) : (
                    <div className={className}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
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
