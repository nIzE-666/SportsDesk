import { classifyMatchStatus, matchStateLabel } from '../../lib/sportsIdentity';
import { Filter, Search, Star } from 'lucide-react';
import { useMemo } from 'react';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import TeamBadge from '../../components/TeamBadge';
import { useViewState } from '../../lib/useViewState';
import { viewState } from '../../lib/viewState';
import { useFavorites } from './FavoritesProvider';
import { formatDateTime, getUserTimezone, normalizeName } from './storage';
import type { MatchSummary } from './types';
import { SPOILER_MASK, isResultHidden } from '../spoilers/spoilerStore';
import type { UseFootballResult } from './useFootballData';

type StatusFilter = 'all' | 'upcoming' | 'finished';

export interface MatchesViewProps {
  data: UseFootballResult;
  onOpenMatch: (id: string) => void;
}

export function MatchesView({ data, onOpenMatch }: MatchesViewProps) {
  const timezone = getUserTimezone();
  const { isTeamFavorite, toggleTeam } = useFavorites();
  const scope = `football.matches.${data.selectedLeagueId}.${data.season ?? 'current'}`;
  const [status, setStatus] = useViewState<StatusFilter>(`${scope}.status`, 'all', (v) =>
    ['all', 'upcoming', 'finished'].includes(String(v)),
  );
  const [query, setQuery] = useViewState(`${scope}.query`, '');
  const [teamFilter, setTeamFilter] = useViewState(`${scope}.team`, '');
  const filtered = useMemo(() => {
    const q = normalizeName(query);
    return data.matches
      .filter((m) => {
        if (!m || !m.home_team || !m.away_team) return false;
        if (status === 'upcoming' && !['scheduled', 'live'].includes(classifyMatchStatus(m.status)))
          return false;
        if (status === 'finished' && classifyMatchStatus(m.status) !== 'finished') return false;
        if (teamFilter && m.home_team.id !== teamFilter && m.away_team.id !== teamFilter)
          return false;
        if (q) {
          const hay = normalizeName(`${m.home_team.name} ${m.away_team.name}`);
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ta = new Date(a.time_utc ?? a.date ?? 0).getTime(),
          tb = new Date(b.time_utc ?? b.date ?? 0).getTime();
        return status === 'upcoming'
          ? ta - tb
          : status === 'finished'
            ? tb - ta
            : Math.abs(ta - Date.now()) - Math.abs(tb - Date.now());
      });
  }, [data.matches, status, teamFilter, query]);

  const seasons = data.seasonsForLeague(data.selectedLeagueId);

  return (
    <div className="matches-view">
      <div className="dashboard-head">
        <div>
          <h1>Матчи</h1>
          <p className="muted small">
            {data.leagueName(data.selectedLeagueId)} · сезон {data.season ?? '—'} ·{' '}
            {data.matches.length} матчей · {timezone}
          </p>
        </div>
        <div className="dashboard-head-actions">
          <button className="ghost-btn" onClick={data.reload} disabled={data.matchesLoading}>
            {data.matchesLoading ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="filters-bar panel">
        <div className="filter-group">
          <label htmlFor="league-select" className="muted small">
            Лига
          </label>
          <select
            id="league-select"
            value={data.selectedLeagueId}
            onChange={(e) => data.setSelectedLeague(e.target.value)}
          >
            {data.leagues.map((l) => {
              const s =
                seasons.length > 0 && l.id === data.selectedLeagueId
                  ? (data.season ?? l.season)
                  : l.season;
              return (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {s ? ` · ${s}` : ''}
                </option>
              );
            })}
          </select>
        </div>
        <div className="filter-group">
          <label htmlFor="football-season" className="muted small">
            Сезон
          </label>
          <select
            id="football-season"
            value={data.season ?? ''}
            onChange={(e) => data.setSelectedSeason(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label htmlFor="team-select" className="muted small">
            Команда
          </label>
          <select
            id="team-select"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
          >
            <option value="">Все</option>
            {data.leagueTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <span className="muted small">Статус</span>
          <div className="segmented">
            {(['all', 'upcoming', 'finished'] as const).map((s) => (
              <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
                {s === 'all' ? 'Все' : s === 'upcoming' ? 'Предстоящие' : 'Завершённые'}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group grow">
          <label htmlFor="match-search" className="muted small">
            Поиск
          </label>
          <div className="input-wrap">
            <Search size={14} />
            <input
              id="match-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название команды"
            />
          </div>
        </div>
      </div>

      {data.matchesLoading && data.matches.length === 0 && (
        <LoadingBlock label="Загрузка матчей…" rows={5} />
      )}
      {data.matchesError && (
        <ErrorBlock title="Матчи недоступны" message={data.matchesError} onRetry={data.reload} />
      )}
      {!data.matchesLoading && !data.matchesError && filtered.length === 0 && (
        <EmptyBlock
          title="Нет матчей по фильтрам"
          message="Измените фильтр или выберите другую лигу."
        />
      )}

      {filtered.length > 0 && (
        <div className="match-table panel">
          <div className="mt-head">
            <span>Дата</span>
            <span>Матч</span>
            <span>Счёт</span>
            <span className="ta-right">Статус</span>
          </div>
          {filtered.map((m) => (
            <MatchRow
              key={m.id}
              match={m}
              timezone={timezone}
              onOpen={() => {
                viewState.write(`match.${m.id}.tab`, 'stats');
                onOpenMatch(m.id);
              }}
              favorite={isTeamFavorite(m.home_team.id) || isTeamFavorite(m.away_team.id)}
              homeFavorite={isTeamFavorite(m.home_team.id)}
              awayFavorite={isTeamFavorite(m.away_team.id)}
              onToggleHome={() => toggleTeam(m.home_team.id)}
              onToggleAway={() => toggleTeam(m.away_team.id)}
            />
          ))}
        </div>
      )}
      <div className="source-foot muted small">
        <Filter size={12} /> Нажмите на строку, команду или счёт — откроется статистика этого матча.
        Звёздочка отслеживает команду. Данные расписания: PitchAPI.
        {data.stale && (
          <span className="chip stale-chip">
            Сохранённые данные могут быть устаревшими
            {data.fetchedAt ? ` · обновлено ${formatDateTime(data.fetchedAt, timezone)}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function MatchRow({
  match,
  timezone,
  onOpen,
  favorite,
  homeFavorite,
  awayFavorite,
  onToggleHome,
  onToggleAway,
}: {
  match: MatchSummary;
  timezone: string;
  onOpen: () => void;
  favorite: boolean;
  homeFavorite: boolean;
  awayFavorite: boolean;
  onToggleHome: () => void;
  onToggleAway: () => void;
}) {
  return (
    <div
      className={favorite ? 'mt-row favorite' : 'mt-row'}
      role="group"
      data-match-id={match.id}
      aria-label={`Матч: ${match.home_team.name} — ${match.away_team.name}, ${formatDateTime(match.time_utc ?? match.date, timezone)}`}
      onClick={(event) => {
        if (!(event.target as Element).closest('button')) onOpen();
      }}
    >
      <span className="mt-date muted small">
        {formatDateTime(match.time_utc ?? match.date, timezone)}
      </span>
      <div className="fixture-teams">
        {[
          { team: match.home_team, saved: homeFavorite, toggle: onToggleHome, side: 'Хозяева' },
          { team: match.away_team, saved: awayFavorite, toggle: onToggleAway, side: 'Гости' },
        ].map(({ team, saved, toggle, side }) => (
          <div className="fixture-team" key={side}>
            <button
              className="fixture-club"
              onClick={onOpen}
              title="Открыть статистику этого матча"
              aria-label={`Статистика матча ${match.home_team.name} — ${match.away_team.name}: ${team.name}`}
            >
              <TeamBadge name={team.name} imageUrl={team.image_url} size={24} />
              <span>
                <small>{side}</small>
                <strong>{team.name}</strong>
              </span>
            </button>
            <button
              className={`row-star ${saved ? 'active' : ''}`}
              onClick={toggle}
              aria-pressed={saved}
              aria-label={`${saved ? 'Убрать из отслеживаемых' : 'Отслеживать'}: ${team.name}`}
            >
              <Star size={14} fill={saved ? 'currentColor' : 'none'} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="mt-score fixture-score"
        onClick={onOpen}
        aria-label={`Разбор матча: ${match.home_team.name} — ${match.away_team.name}`}
      >
        {(match.score_home != null || match.score_away != null) &&
        isResultHidden('football', match.id)
          ? SPOILER_MASK
          : match.score_home != null || match.score_away != null
            ? `${match.score_home ?? '—'} : ${match.score_away ?? '—'}`
            : '— : —'}
      </button>
      <span className="ta-right">
        <span className={classifyMatchStatus(match.status) === 'live' ? 'chip live-chip' : 'chip'}>
          {matchStateLabel(match.status)}
        </span>
        <button className="link-btn" onClick={onOpen}>
          Разбор →
        </button>
      </span>
    </div>
  );
}
