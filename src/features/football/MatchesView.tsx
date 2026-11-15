import { CalendarPlus, MoreHorizontal, RefreshCw, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SourceLine } from '../../components/SourceLine';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  MatchRow,
  Panel,
  SearchSelect,
  SegmentedControl,
  Skeleton,
  type MatchRowStatus,
} from '../../kit';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import { isMatchesFilter, MATCHES_FILTER_VIEW_KEY, type MatchesFilter } from '../../lib/navigation';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { useViewState } from '../../lib/useViewState';
import { viewState } from '../../lib/viewState';
import { useResultHidden } from '../spoilers/spoilerStore';
import {
  buildCalendar,
  fixtureCalendarTime,
  savedCalendarMessage,
  selectCalendarMatches,
} from './calendar';
import { matchInvolvesFavorite, useFavorites } from './FavoritesProvider';
import { getUserTimezone } from './storage';
import type { MatchSummary } from './types';
import type { UseFootballResult } from './useFootballData';
import { LivePanel, minuteLabel } from './LivePanel';
import { MatchList } from './MatchList';
import type { PitchMatchReference } from './liveData';

const FILTER_ITEMS = [
  { id: 'mine', label: 'Мои' },
  { id: 'all', label: 'Все' },
  { id: 'live', label: 'Сейчас идут' },
] as const;

const ROUND_LABELS: Record<string, string> = {
  final: 'Финал',
  '1/2': 'Полуфинал',
  '1/4': 'Четвертьфинал',
  '1/8': '1/8 финала',
  '1/16': 'Стыковые матчи',
};

function roundLabel(value: string): string {
  const known = ROUND_LABELS[value.toLowerCase()];
  if (known) return known;
  return /^\d+$/u.test(value) ? `Тур ${value}` : value;
}

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function clockTime(value: string | null, timezone: string): string | null {
  if (!value || value.length === 10) return null;
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatter.format(date);
}

function rowStatus(match: MatchSummary): MatchRowStatus {
  const state = classifyMatchStatus(match.status, match.status_text);
  if (state === 'live') return 'live';
  if (state === 'finished') return 'finished';
  if (state === 'postponed') return 'postponed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'unknown') return 'unknown';
  return 'scheduled';
}

function rowTime(match: MatchSummary, timezone: string): string | null {
  const state = classifyMatchStatus(match.status, match.status_text);
  if (state === 'finished' || state === 'scheduled')
    return clockTime(fixtureCalendarTime(match), timezone);
  return null;
}

function roundSortValue(value: string): [number, string] {
  return /^\d+$/u.test(value) ? [Number(value), value] : [Number.POSITIVE_INFINITY, value];
}

export interface MatchesViewProps {
  data: UseFootballResult;
  onOpenMatch: (id: string) => void;
  /** PitchAPI fixtures already loaded, for live rows that can open a match page. */
  pitchMatches?: readonly PitchMatchReference[];
  /** A migrated «Сейчас идут» tab opens this screen with the live filter. */
  initialFilter?: MatchesFilter;
}

export function MatchesView({
  data,
  onOpenMatch,
  pitchMatches = [],
  initialFilter,
}: MatchesViewProps) {
  const timezone = getUserTimezone();
  const { isTeamFavorite, toggleTeam, favoriteTeamNames } = useFavorites();
  const [filter, setFilter] = useViewState<MatchesFilter>(
    MATCHES_FILTER_VIEW_KEY,
    initialFilter ?? 'all',
    isMatchesFilter,
  );
  const scope = `football.matches.${data.selectedLeagueId}.${data.season ?? 'current'}`;
  const [round, setRound] = useViewState(`${scope}.round`, '');
  const [team, setTeam] = useViewState(`${scope}.team`, '');
  const [menuOpen, setMenuOpen] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);

  const isFavoriteMatch = useCallback(
    (match: MatchSummary) =>
      isTeamFavorite(match.home_team.id) ||
      isTeamFavorite(match.away_team.id) ||
      matchInvolvesFavorite(match.home_team.name, match.away_team.name, favoriteTeamNames),
    [favoriteTeamNames, isTeamFavorite],
  );

  const rounds = useMemo(() => {
    const values = new Set<string>();
    for (const match of data.matches) {
      const value = match.round_name?.trim();
      if (value) values.add(value);
    }
    return [...values].sort((first, second) => {
      const [firstNumber, firstText] = roundSortValue(first);
      const [secondNumber, secondText] = roundSortValue(second);
      return firstNumber - secondNumber || firstText.localeCompare(secondText, 'ru');
    });
  }, [data.matches]);

  useEffect(() => {
    if (round && !rounds.includes(round)) setRound('');
  }, [round, rounds, setRound]);

  const teams = data.leagueTeams;
  useEffect(() => {
    if (team && !teams.some((entry) => entry.id === team)) setTeam('');
  }, [team, teams, setTeam]);

  const seasonOptions = useMemo(() => {
    const seasons = data.seasonsForLeague(data.selectedLeagueId);
    const list = seasons.length > 0 ? seasons : data.season ? [data.season] : [];
    return list.map((season) => ({ value: season, label: season }));
  }, [data]);

  const roundOptions = useMemo(
    () => [
      { value: '', label: 'Все туры' },
      ...rounds.map((value) => ({ value, label: roundLabel(value) })),
    ],
    [rounds],
  );

  const teamOptions = useMemo(
    () => [
      { value: '', label: 'Все команды' },
      ...teams.map((entry) => ({ value: entry.id, label: entry.name })),
    ],
    [teams],
  );

  const visibleMatches = useMemo(() => {
    return data.matches.filter((match) => {
      if (!match || !match.home_team || !match.away_team) return false;
      if (round && match.round_name !== round) return false;
      if (team && match.home_team.id !== team && match.away_team.id !== team) return false;
      if (filter === 'mine' && !isFavoriteMatch(match)) return false;
      return true;
    });
  }, [data.matches, filter, isFavoriteMatch, round, team]);

  const subtitle =
    filter === 'live'
      ? 'Матчи ваших клубов и турниров.'
      : `${data.leagueName(data.selectedLeagueId)} · сезон ${data.season ?? '—'}`;

  const resetFilters = () => {
    setRound('');
    setTeam('');
  };

  const exportCalendar = async () => {
    setCalendarBusy(true);
    setCalendarMessage(null);
    try {
      const favorites = data.allMatches.filter(isFavoriteMatch);
      const { events, skipped, fallback, skippedFavorites } = selectCalendarMatches(
        favorites,
        data.matches,
      );
      if (!events.length) {
        setCalendarMessage(
          skipped ? 'Нет будущих матчей с известной датой.' : 'Нет будущих матчей для календаря.',
        );
        return;
      }
      if (isTauriRuntime()) {
        const dialog = await import('@tauri-apps/plugin-dialog');
        const path = await dialog.save({
          title: 'Сохранить календарь матчей',
          defaultPath: 'sportsdesk-matches.ics',
          filters: [{ name: 'Календарь iCal', extensions: ['ics'] }],
        });
        if (!path) return;
        await rpc('export_calendar', {
          matches: events,
          path,
          reminderMinutes: 15,
        });
      } else {
        const blob = new Blob([buildCalendar(events)], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'sportsdesk-matches.ics';
        link.click();
        URL.revokeObjectURL(url);
      }
      const notes: string[] = [];
      if (skipped) notes.push(`без даты: ${skipped}`);
      if (fallback) notes.push('матчи выбранной лиги');
      if (skippedFavorites) notes.push(`избранных без даты: ${skippedFavorites}`);
      setCalendarMessage(savedCalendarMessage(events, notes));
    } catch {
      setCalendarMessage('Не удалось сохранить календарь.');
    } finally {
      setCalendarBusy(false);
    }
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setCalendarMessage(null);
  };

  return (
    <div className="matches-view">
      <div className="dashboard-head">
        <div>
          <h2 className="screen-title">Матчи</h2>
          <p className="muted small">{subtitle}</p>
        </div>
        <div className="dashboard-head-actions">
          {filter !== 'live' && (
            <Button
              variant="quiet"
              onClick={data.reload}
              busy={data.matchesLoading}
              icon={<RefreshCw size={14} aria-hidden="true" />}
            >
              Обновить
            </Button>
          )}
          <Button
            variant="quiet"
            icon={<MoreHorizontal size={16} aria-hidden="true" />}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            Меню
          </Button>
        </div>
      </div>

      <Panel className="matches-toolbar" aria-label="Параметры матчей">
        <div className="matches-toolbar__filter">
          <span className="matches-toolbar__label">Показать</span>
          <SegmentedControl
            ariaLabel="Фильтр матчей"
            value={filter}
            onChange={(id) => setFilter(id as MatchesFilter)}
            items={FILTER_ITEMS}
          />
        </div>
        {filter !== 'live' && (
          <div className="matches-toolbar__fields">
            {seasonOptions.length > 1 && (
              <div className="matches-toolbar__field">
                <span className="matches-toolbar__label">Сезон</span>
                <SearchSelect
                  ariaLabel="Сезон"
                  value={data.season ?? ''}
                  options={seasonOptions}
                  onChange={data.setSelectedSeason}
                  clearable={false}
                />
              </div>
            )}
            {rounds.length > 1 && (
              <div className="matches-toolbar__field">
                <span className="matches-toolbar__label">Тур</span>
                <SearchSelect
                  ariaLabel="Тур"
                  value={round}
                  options={roundOptions}
                  onChange={setRound}
                  placeholder="Все туры"
                />
              </div>
            )}
            {teams.length > 0 && (
              <div className="matches-toolbar__field">
                <span className="matches-toolbar__label">Команда</span>
                <SearchSelect
                  ariaLabel="Команда"
                  value={team}
                  options={teamOptions}
                  onChange={setTeam}
                  placeholder="Все команды"
                />
              </div>
            )}
          </div>
        )}
      </Panel>

      {filter === 'live' ? (
        <LivePanel pitchMatches={pitchMatches} onOpenMatch={onOpenMatch} />
      ) : (
        <>
          {data.matchesLoading && data.matches.length === 0 && (
            <div className="matches-loading" role="status" aria-label="Загрузка матчей">
              <Skeleton className="matches-loading__row" />
              <Skeleton className="matches-loading__row" />
              <Skeleton className="matches-loading__row" />
            </div>
          )}
          {data.matchesError && (
            <EmptyState
              tone="error"
              title="Матчи недоступны"
              message={data.matchesError}
              action={
                <Button variant="quiet" onClick={data.reload}>
                  Повторить
                </Button>
              }
            />
          )}
          {!data.matchesLoading && !data.matchesError && visibleMatches.length === 0 && (
            <EmptyState
              title={filter === 'mine' ? 'Нет матчей избранных клубов' : 'Нет матчей по фильтрам'}
              message={
                filter === 'mine'
                  ? 'Добавьте клуб звёздочкой в строке матча.'
                  : 'Измените тур, команду или сезон.'
              }
              action={
                <Button
                  variant="quiet"
                  onClick={() => {
                    if (filter === 'mine') setFilter('all');
                    else resetFilters();
                  }}
                >
                  {filter === 'mine' ? 'Показать все матчи' : 'Сбросить фильтры'}
                </Button>
              }
            />
          )}
          {visibleMatches.length > 0 && (
            <MatchList
              items={visibleMatches}
              getKey={(match) => match.id}
              getTime={(match) => fixtureCalendarTime(match)}
              timezone={timezone}
              renderRow={(match) => (
                <div className="match-list__fixture" data-match-id={match.id}>
                  <FixtureRow
                    match={match}
                    timezone={timezone}
                    favorite={isFavoriteMatch(match)}
                    homeFavorite={isTeamFavorite(match.home_team.id)}
                    awayFavorite={isTeamFavorite(match.away_team.id)}
                    onToggleHome={() => toggleTeam(match.home_team.id)}
                    onToggleAway={() => toggleTeam(match.away_team.id)}
                    onOpen={() => {
                      viewState.write(`match.${match.id}.tab`, 'stats');
                      onOpenMatch(match.id);
                    }}
                  />
                </div>
              )}
            />
          )}
          <SourceLine
            sources={['pitch']}
            fetchedAt={data.fetchedAt}
            stale={data.stale}
            timezone={timezone}
          />
        </>
      )}

      <Dialog
        open={menuOpen}
        onClose={closeMenu}
        title="Матчи"
        footer={
          <>
            <Button onClick={closeMenu}>Закрыть</Button>
            <Button
              variant="primary"
              busy={calendarBusy}
              icon={<CalendarPlus size={15} aria-hidden="true" />}
              onClick={() => void exportCalendar()}
            >
              Скачать .ics
            </Button>
          </>
        }
      >
        <p>Будущие матчи избранных клубов или выбранной лиги.</p>
        {calendarMessage && <p role="status">{calendarMessage}</p>}
      </Dialog>
    </div>
  );
}

function FixtureRow({
  match,
  timezone,
  favorite,
  homeFavorite,
  awayFavorite,
  onToggleHome,
  onToggleAway,
  onOpen,
}: {
  match: MatchSummary;
  timezone: string;
  favorite: boolean;
  homeFavorite: boolean;
  awayFavorite: boolean;
  onToggleHome: () => void;
  onToggleAway: () => void;
  onOpen: () => void;
}) {
  const hidden = useResultHidden('football', match.id);
  const state = classifyMatchStatus(match.status, match.status_text);
  const label = `${match.home_team.name} — ${match.away_team.name}`;
  return (
    <MatchRow
      home={{
        name: match.home_team.name,
        imageUrl: match.home_team.image_url,
        action: (
          <IconButton
            small
            className={homeFavorite ? 'is-active' : undefined}
            onClick={onToggleHome}
            aria-pressed={homeFavorite}
            title={`${homeFavorite ? 'Убрать из отслеживаемых' : 'Отслеживать'}: ${match.home_team.name}`}
            aria-label={`${homeFavorite ? 'Убрать из отслеживаемых' : 'Отслеживать'}: ${match.home_team.name}`}
            icon={<Star size={14} fill={homeFavorite ? 'currentColor' : 'none'} />}
          />
        ),
      }}
      away={{
        name: match.away_team.name,
        imageUrl: match.away_team.image_url,
        action: (
          <IconButton
            small
            className={awayFavorite ? 'is-active' : undefined}
            onClick={onToggleAway}
            aria-pressed={awayFavorite}
            title={`${awayFavorite ? 'Убрать из отслеживаемых' : 'Отслеживать'}: ${match.away_team.name}`}
            aria-label={`${awayFavorite ? 'Убрать из отслеживаемых' : 'Отслеживать'}: ${match.away_team.name}`}
            icon={<Star size={14} fill={awayFavorite ? 'currentColor' : 'none'} />}
          />
        ),
      }}
      time={rowTime(match, timezone)}
      status={rowStatus(match)}
      minute={state === 'live' ? minuteLabel(match.status_text ?? null) : null}
      score={{ home: match.score_home, away: match.score_away }}
      hideScore={hidden}
      badge={favorite ? <Badge>Избранное</Badge> : undefined}
      actions={
        <Button
          variant="quiet"
          small
          className="mt-open"
          onClick={onOpen}
          aria-label={`Разбор матча: ${label}`}
        >
          Разбор
        </Button>
      }
    />
  );
}
