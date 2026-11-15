import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, GitBranch, Search, X } from 'lucide-react';
import { useViewState } from '../../lib/useViewState';
import { usePageScroll } from '../../lib/usePageScroll';
import { FeaturedMatchCover, selectFeaturedMatch } from '../football/FeaturedMatchCover';
import TeamBadge from '../../components/TeamBadge';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Panel,
  PanelHeader,
  SegmentedControl,
  StatTile,
} from '../../kit';
import { SourceLine } from '../../components/SourceLine';
import { MatchDetailView } from '../football/MatchDetailView';
import { MatchList } from '../football/MatchList';
import {
  StandingsTable,
  type StandingsTableRow,
  type StandingsZone,
} from '../football/StandingsView';
import { CompetitionInsights, statSummaryTiles, type StatTileId } from './CompetitionInsights';
import { TournamentBracket } from './TournamentBracket';
import { countRu, MATCHES } from '../../lib/plural';
import { formatHumanTime } from '../../lib/humanDate';
import { getString, getUserTimezone, setString, normalizeName } from '../football/storage';
import {
  currentUclSeason,
  fetchUclSeason,
  fetchUclStandings,
  fetchUclPlayer,
  fetchUclScorers,
} from './data';
import type { UclSeasonData, UclScorer, UclTableRow } from './data';
import { fetchBracketFor, fetchUclBracket } from './bracket';
import type { BracketData, BracketFormat } from './bracket';
import {
  CUP_COMPETITIONS,
  currentSeasonFor,
  fetchCupSeason,
  fetchCupStandings,
  type CupTableRow,
} from './cups';
import type { MatchSummary } from '../football/types';
import { openExternal } from '../../lib/bridge';
import { useDataRecovery } from '../../lib/useDataRecovery';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { CHAMPIONS_LEAGUE_ID } from '../../lib/navigation';
import { UclError, UclLoading } from './uclStates';
import { UclMatchRow } from './UclMatchRow';
import './ucl.css';

export type TournamentTab = 'matches' | 'table' | 'bracket' | 'clubs' | 'players';
export type UclTab = TournamentTab;
export type CupTab = 'matches' | 'table' | 'bracket';

export const UCL_ZONES: StandingsZone[] = [
  { from: 1, to: 8, tone: 'direct' },
  { from: 9, to: 24, tone: 'playoff' },
];

const STAT_CAPTIONS: Record<StatTileId, string> = {
  played: 'Матчей сыграно',
  goals: 'Голов забито',
  average: 'Голов за матч',
  teams: 'Участников',
};

function normalizeTeam(s: string) {
  return normalizeName(s)
    .replace(/\b(fc|cf|afc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableRow(row: UclTableRow | CupTableRow): StandingsTableRow {
  return {
    position: row.position,
    team: row.team,
    logo: row.logo,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    goalsFor: row.gf,
    goalsAgainst: row.ga,
    goalDifference: row.gd,
    points: row.points,
  };
}

type TableGroup = { name?: string; rows: StandingsTableRow[] };

/**
 * One screen for a tournament: matches, the shared table, the knockout board,
 * the season's clubs and the player statistics. The Champions League and the
 * cups differ only by the data layer and by which tabs they have.
 */
export function TournamentView({
  competitionId,
  tab,
  onTabChange,
}: {
  competitionId: string;
  tab: TournamentTab;
  onTabChange: (tab: TournamentTab) => void;
}) {
  const isUcl = competitionId === CHAMPIONS_LEAGUE_ID;
  const cup = isUcl
    ? undefined
    : CUP_COMPETITIONS.find((competition) => competition.id === competitionId);
  const title = isUcl ? 'Лига чемпионов' : (cup?.title ?? 'Турнир');
  const sportscoreSlug = isUcl ? 'uefa-champions-league' : cup?.sportscoreSlug;
  const bracketFormat: BracketFormat = isUcl ? 'two-leg' : (cup?.bracketFormat ?? 'two-leg');
  const seasonKey = isUcl ? 'sportsdesk.ucl.season' : `sportsdesk.cup.${competitionId}.season`;

  const [currentSeason, setCurrentSeason] = useState(() => (isUcl ? currentUclSeason() : ''));
  const [season, setSeason] = useState(() =>
    isUcl ? getString(seasonKey) || currentUclSeason() : getString(seasonKey) || '',
  );
  const [seasons, setSeasons] = useState<string[]>([]);
  const [data, setData] = useState<{
    matches: MatchSummary[];
    fetchedAt: string;
    stale: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useDataRecovery(
    (key) =>
      key === 'pitch:leagues' ||
      key.startsWith(`pitch:leagues/${competitionId}/`) ||
      (key.startsWith('sportscore:') && !!sportscoreSlug && key.includes(`slug=${sportscoreSlug}`)),
    () => setRefresh((value) => value + 1),
  );

  const [tableGroups, setTableGroups] = useState<TableGroup[] | null>(null);
  const [tableBusy, setTableBusy] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [bracket, setBracket] = useState<BracketData | null>(null);
  const [bracketBusy, setBracketBusy] = useState(false);
  const [bracketError, setBracketError] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [scorers, setScorers] = useState<UclScorer[]>([]);
  const [scorerError, setScorerError] = useState<string | null>(null);
  const [scorersBusy, setScorersBusy] = useState(false);
  const [ranking, setRanking] = useViewState<'goals' | 'assists'>(
    'ucl.ranking',
    'goals',
    (value) => value === 'goals' || value === 'assists',
  );
  const viewScope = isUcl ? 'ucl' : `cup.${competitionId}`;
  const [selectedMatch, setSelectedMatch] = useViewState<string | null>(
    `${viewScope}.match`,
    null,
    (value) => value === null || typeof value === 'string',
  );
  const [query, setQuery] = useViewState(`${viewScope}.query`, '');
  const [status, setStatus] = useViewState<'all' | 'finished' | 'upcoming'>(
    `${viewScope}.status`,
    'all',
    (value) => ['all', 'finished', 'upcoming'].includes(String(value)),
  );
  const [selectedPlayer, setSelectedPlayer] = useState<UclScorer | null>(null);
  const [playerInfo, setPlayerInfo] = useState<Record<string, unknown> | null>(null);

  usePageScroll(`${viewScope}.${season}.${selectedMatch ? `match.${selectedMatch}` : tab}`);
  const previousContext = useRef(`${tab}.${season}`);
  useEffect(() => {
    const context = `${tab}.${season}`;
    if (previousContext.current !== context) setSelectedMatch(null);
    previousContext.current = context;
  }, [tab, season, setSelectedMatch]);

  // The cup catalogue resolves the current season asynchronously.
  useEffect(() => {
    if (isUcl) return;
    let active = true;
    currentSeasonFor(competitionId)
      .then((value) => {
        if (!active) return;
        if (!value) {
          setError('Сезоны турнира недоступны.');
          setLoading(false);
          return;
        }
        setCurrentSeason(value);
        setSeason((previous) => previous || value);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить турнир.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isUcl, competitionId, refresh]);

  useEffect(() => {
    if (!season || !currentSeason) return;
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    setBracket(null);
    setTableGroups(null);
    setString(seasonKey, season);
    const request: Promise<UclSeasonData> = isUcl
      ? fetchUclSeason(season)
      : fetchCupSeason(competitionId, season);
    request
      .then((result) => {
        if (!active) return;
        setData({
          matches: result.matches,
          fetchedAt: result.fetchedAt,
          stale: result.stale,
        });
        setSeasons(result.seasons);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Не удалось загрузить турнир.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [season, currentSeason, competitionId, isUcl, seasonKey, refresh]);

  useEffect(() => {
    if (tab !== 'table' || !sportscoreSlug) return;
    if (season !== currentSeason) {
      setTableGroups(null);
      setTableError(null);
      return;
    }
    let active = true;
    setTableBusy(true);
    setTableError(null);
    const request = isUcl ? fetchUclStandings() : fetchCupStandings(sportscoreSlug);
    request
      .then((result) => {
        if (!active) return;
        setTableGroups(
          result.groups.map((group) => ({
            name: group.name,
            rows: group.rows.map(tableRow),
          })),
        );
      })
      .catch((reason) => {
        if (active)
          setTableError(reason instanceof Error ? reason.message : 'Не удалось загрузить таблицу.');
      })
      .finally(() => {
        if (active) setTableBusy(false);
      });
    return () => {
      active = false;
    };
  }, [tab, sportscoreSlug, season, currentSeason, isUcl, refresh]);

  useEffect(() => {
    if (tab !== 'players' || !isUcl || season !== currentSeason) return;
    let active = true;
    setScorers([]);
    setScorerError(null);
    setScorersBusy(true);
    fetchUclScorers(ranking)
      .then((result) => {
        if (active) setScorers(result.players);
      })
      .catch((reason) => {
        if (active)
          setScorerError(
            reason instanceof Error ? reason.message : 'Не удалось загрузить рейтинг.',
          );
      })
      .finally(() => {
        if (active) setScorersBusy(false);
      });
    return () => {
      active = false;
    };
  }, [tab, isUcl, season, currentSeason, ranking, refresh]);

  useEffect(() => {
    if (tab !== 'bracket' || !data || !season) return;
    let active = true;
    setBracketBusy(true);
    setBracketError(null);
    setProgress([0, 0]);
    const onProgress = (done: number, total: number) => {
      if (active) setProgress([done, total]);
    };
    const request = isUcl
      ? fetchUclBracket(data.matches, season, onProgress)
      : fetchBracketFor(data.matches, season, onProgress, bracketFormat);
    request
      .then((result) => {
        if (active) setBracket(result);
      })
      .catch((reason) => {
        if (active)
          setBracketError(reason instanceof Error ? reason.message : 'Не удалось загрузить сетку.');
      })
      .finally(() => {
        if (active) setBracketBusy(false);
      });
    return () => {
      active = false;
    };
  }, [tab, data, season, isUcl, bracketFormat]);

  useEffect(() => {
    let active = true;
    setPlayerInfo(null);
    if (selectedPlayer?.slug)
      fetchUclPlayer(selectedPlayer.slug)
        .then((result) => {
          if (active) setPlayerInfo(result);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedPlayer]);

  const timezone = getUserTimezone();
  const matches = data?.matches ?? [];
  const played = matches.filter(
    (match) => classifyMatchStatus(match.status, match.status_text) === 'finished',
  );
  const totalGoals = played.reduce(
    (sum, match) => sum + (match.score_home ?? 0) + (match.score_away ?? 0),
    0,
  );
  const teams = useMemo(() => {
    const map = new Map<string, MatchSummary['home_team']>();
    for (const match of matches) {
      map.set(match.home_team.id, match.home_team);
      map.set(match.away_team.id, match.away_team);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const statTiles = statSummaryTiles({
    teams: teams.length,
    played: played.length,
    goals: totalGoals,
  });
  const filtered = matches
    .filter((match) => {
      const state = classifyMatchStatus(match.status, match.status_text);
      if (status === 'finished' && state !== 'finished') return false;
      if (status === 'upcoming' && !['scheduled', 'live'].includes(state)) return false;
      const team = normalizeTeam(query);
      return (
        !team || normalizeTeam(`${match.home_team.name} ${match.away_team.name}`).includes(team)
      );
    })
    .sort((a, b) =>
      status === 'upcoming'
        ? (a.time_utc ?? '').localeCompare(b.time_utc ?? '')
        : (b.time_utc ?? '').localeCompare(a.time_utc ?? ''),
    );

  const teamMatches = (name: string) => {
    const exact = teams.find((team) => normalizeTeam(team.name) === normalizeTeam(name));
    setQuery(exact?.name ?? name);
    setStatus('all');
    setSelectedMatch(null);
    onTabChange('matches');
  };
  const openMatch = (id: string) => setSelectedMatch(id);
  const chooseTab = (nextTab: TournamentTab) => {
    setSelectedMatch(null);
    onTabChange(nextTab);
  };

  if (selectedMatch) {
    return (
      <MatchDetailView
        key={selectedMatch}
        matchId={selectedMatch}
        seasonMatches={matches}
        onOpenMatch={openMatch}
        onBack={() => setSelectedMatch(null)}
      />
    );
  }

  const hasTableRows = tableGroups?.some((group) => group.rows.length > 0) ?? false;
  const singleSeason = seasons.length === 1 ? seasons[0] : null;
  const featured = selectFeaturedMatch(matches);
  // The cover keeps the date and the score; the round is already on the bracket,
  // so the provider's round label is not repeated here.
  const coverMatch = featured ? { ...featured, round_name: undefined } : undefined;

  return (
    <div className="ucl-view">
      <div className="ucl-toolbar">
        {singleSeason ? (
          <span className="ucl-season__value">Сезон {singleSeason}</span>
        ) : seasons.length > 1 ? (
          <div className="ucl-season">
            <label htmlFor="tournament-season">Сезон</label>
            <select
              id="tournament-season"
              value={season}
              onChange={(event) => {
                setSeason(event.target.value);
                setQuery('');
              }}
            >
              {seasons.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
        ) : null}
        <Button small onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
          Обновить
        </Button>
      </div>

      {loading && <UclLoading label="Загружаем турнир…" rows={4} />}
      {error && !loading && (
        <UclError
          title="Турнир временно недоступен"
          message={error}
          onRetry={() => setRefresh((value) => value + 1)}
        />
      )}
      {data?.stale && (
        <Badge variant="warning">Сохранённые данные · обновление временно недоступно</Badge>
      )}

      {!loading && !error && data && tab === 'matches' && (
        <>
          {matches.length === 0 ? (
            <EmptyState message="Матчи появятся после жеребьёвки." />
          ) : (
            <>
              <FeaturedMatchCover
                sport="ucl"
                match={coverMatch}
                league={title}
                season={season}
                onOpenMatch={openMatch}
                onSeeAllMatches={() => chooseTab('matches')}
              />
              <CompetitionInsights teams={teams.length} played={played.length} goals={totalGoals} />
              <Panel className="filters-bar">
                <SegmentedControl
                  ariaLabel="Статус матчей"
                  value={status}
                  onChange={(id) => setStatus(id as 'all' | 'finished' | 'upcoming')}
                  items={[
                    { id: 'all', label: 'Все матчи' },
                    { id: 'upcoming', label: 'Предстоящие' },
                    { id: 'finished', label: 'Результаты' },
                  ]}
                />
                <div className="input-wrap grow">
                  <Search size={15} aria-hidden="true" />
                  <input
                    aria-label="Поиск матчей"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Найти команду"
                  />
                  {query && (
                    <IconButton
                      icon={<X size={14} aria-hidden="true" />}
                      onClick={() => setQuery('')}
                      aria-label="Очистить поиск"
                    />
                  )}
                </div>
                <span className="muted small">{countRu(filtered.length, MATCHES)}</span>
              </Panel>
              <div className="ucl-match-list">
                <h2 className="visually-hidden">Матчи</h2>
                <MatchList
                  items={filtered}
                  getKey={(match) => match.id}
                  getTime={(match) => match.time_utc ?? match.date}
                  timezone={timezone}
                  renderRow={(match) => (
                    <UclMatchRow
                      match={match}
                      time={formatHumanTime(match.time_utc ?? match.date, timezone)}
                      onClick={() => openMatch(match.id)}
                    />
                  )}
                />
                {!filtered.length && (
                  <EmptyState message="Совпадений нет — измените команду или статус." />
                )}
              </div>
              {!isUcl && teams.length > 0 && (
                <Panel>
                  <PanelHeader title="Клубы турнира" />
                  <div className="ucl-logo-wall">
                    {teams.map((team) => (
                      <Button
                        key={team.id}
                        variant="quiet"
                        className="ucl-team-chip"
                        onClick={() => teamMatches(team.name)}
                        title={team.name}
                      >
                        <TeamBadge name={team.name} imageUrl={team.image_url} size={31} />
                        <span>{team.name}</span>
                      </Button>
                    ))}
                  </div>
                </Panel>
              )}
            </>
          )}
        </>
      )}

      {!loading && !error && tab === 'table' && (
        <Panel>
          {season !== currentSeason ? (
            <EmptyState message="Архивная таблица недоступна — таблица есть только для текущего сезона." />
          ) : tableError ? (
            <UclError
              title="Таблица недоступна"
              message={tableError}
              onRetry={() => setRefresh((value) => value + 1)}
            />
          ) : tableBusy || tableGroups === null ? (
            <UclLoading label="Загрузка таблицы…" rows={8} />
          ) : hasTableRows ? (
            <>
              {isUcl && (
                <div className="standings-legend">
                  <span>
                    <i className="standings-legend__dot standings-legend__dot--direct" />
                    Места 1–8
                  </span>
                  <span>
                    <i className="standings-legend__dot standings-legend__dot--playoff" />
                    Места 9–24
                  </span>
                </div>
              )}
              <div className="ucl-table-groups">
                {tableGroups.map((group, index) => (
                  <div className="ucl-table-group" key={group.name ?? index}>
                    {group.name && <h2 className="ui-section-title">{group.name}</h2>}
                    <StandingsTable
                      ariaLabel={group.name ?? 'Турнирная таблица'}
                      rows={group.rows}
                      zones={isUcl ? UCL_ZONES : []}
                      onTeam={(row) => teamMatches(row.team)}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState message="Таблица пока пуста." />
          )}
        </Panel>
      )}

      {!loading && !error && tab === 'bracket' && (
        <>
          <div className="bracket-intro">
            <GitBranch size={19} aria-hidden="true" />
            <p>Откройте пару, чтобы увидеть матчи.</p>
            <Badge>{season}</Badge>
          </div>
          {bracketBusy && (
            <UclLoading
              label={`Собираем подтверждённые пары${
                progress[1] ? `: ${progress[0]} / ${progress[1]}` : ''
              }…`}
              rows={3}
            />
          )}
          {bracketError && (
            <UclError
              title="Не удалось загрузить сетку"
              message={bracketError}
              onRetry={() => setRefresh((value) => value + 1)}
            />
          )}
          {!bracketBusy && bracket && bracket.ties.length === 0 && (
            <EmptyState message="Сетка появится после жеребьёвки." />
          )}
          {!bracketBusy && bracket && bracket.ties.length > 0 && (
            <TournamentBracket
              bracket={bracket}
              format={bracketFormat}
              season={season}
              onOpenMatch={openMatch}
            />
          )}
        </>
      )}

      {!loading && !error && tab === 'clubs' && isUcl && (
        <Panel>
          {teams.length > 0 ? (
            <div className="ucl-logo-wall">
              {teams.map((team) => (
                <Button
                  key={team.id}
                  variant="quiet"
                  className="ucl-team-chip"
                  onClick={() => teamMatches(team.name)}
                  title={team.name}
                >
                  <TeamBadge name={team.name} imageUrl={team.image_url} size={31} />
                  <span>{team.name}</span>
                </Button>
              ))}
            </div>
          ) : (
            <EmptyState message="Клубы появятся после жеребьёвки." />
          )}
        </Panel>
      )}

      {!loading && !error && tab === 'players' && isUcl && (
        <>
          {statTiles.length > 0 && (
            <div className="ucl-stat-summary">
              {statTiles.map(({ id, value }) => (
                <StatTile key={id} label={STAT_CAPTIONS[id]} value={value} />
              ))}
            </div>
          )}
          <Panel>
            <PanelHeader
              title="Рейтинг игроков"
              action={
                <SegmentedControl
                  ariaLabel="Рейтинг игроков"
                  value={ranking}
                  onChange={(id) => setRanking(id as 'goals' | 'assists')}
                  items={[
                    { id: 'goals', label: 'Голы' },
                    { id: 'assists', label: 'Ассисты' },
                  ]}
                />
              }
            />
            {season !== currentSeason ? (
              <EmptyState message="Рейтинг игроков есть только для текущего розыгрыша." />
            ) : scorerError ? (
              <UclError
                title="Рейтинг недоступен"
                message={scorerError}
                onRetry={() => setRefresh((value) => value + 1)}
              />
            ) : scorersBusy ? (
              <UclLoading label="Загружаем рейтинг игроков…" rows={4} />
            ) : scorers.length ? (
              <div className="scorer-grid">
                {scorers.map((player) => (
                  <Button
                    key={player.slug ?? player.name}
                    variant="quiet"
                    className="scorer-card"
                    onClick={() => setSelectedPlayer(player)}
                  >
                    <span className="scorer-rank">{String(player.rank).padStart(2, '0')}</span>
                    <span className="scorer-photo">
                      <TeamBadge
                        name={player.name}
                        imageUrl={player.photo || player.teamLogo}
                        size={48}
                      />
                    </span>
                    <strong>{player.name}</strong>
                    <small>{player.team}</small>
                    <span className="scorer-value">
                      {ranking === 'goals' ? (player.goals ?? '—') : (player.assists ?? '—')}
                      <small>{ranking === 'goals' ? 'голов' : 'ассистов'}</small>
                    </span>
                  </Button>
                ))}
              </div>
            ) : (
              <EmptyState message="Рейтинг пока пуст." />
            )}
          </Panel>
        </>
      )}

      <SourceLine
        sources={sportscoreSlug ? ['pitch', 'sportscore'] : ['pitch']}
        fetchedAt={data?.fetchedAt}
      />

      <Dialog
        open={!!selectedPlayer}
        onClose={() => setSelectedPlayer(null)}
        title={selectedPlayer?.name ?? ''}
        closeLabel="Закрыть профиль игрока"
        footer={
          selectedPlayer ? (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  const name = selectedPlayer.team;
                  setSelectedPlayer(null);
                  teamMatches(name);
                }}
              >
                Матчи команды <ChevronRight size={14} aria-hidden="true" />
              </Button>
              {selectedPlayer.slug && (
                <Button
                  variant="quiet"
                  onClick={() =>
                    openExternal(`https://sportscore.com/football/player/${selectedPlayer.slug}/`)
                  }
                >
                  Профиль на сайте источника <ArrowUpRight size={14} aria-hidden="true" />
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {selectedPlayer && (
          <div className="ucl-player">
            <div className="ucl-player__badge">
              <TeamBadge
                name={selectedPlayer.name}
                imageUrl={selectedPlayer.photo || selectedPlayer.teamLogo}
                size={72}
              />
            </div>
            <p className="ucl-player__team">{selectedPlayer.team}</p>
            <div className="ucl-player__metrics">
              {[
                { label: 'Голы', value: selectedPlayer.goals },
                { label: 'Ассисты', value: selectedPlayer.assists },
                { label: 'Матчи', value: selectedPlayer.matches },
                { label: 'Минуты', value: selectedPlayer.minutes },
              ].map((metric) => (
                <StatTile
                  key={metric.label}
                  label={metric.label}
                  value={metric.value ?? undefined}
                />
              ))}
            </div>
            {playerInfo && typeof playerInfo.nationality === 'string' && (
              <p className="ucl-player__note">{playerInfo.nationality}</p>
            )}
            <p className="ucl-player__note">Подробности — в статистике матча.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
