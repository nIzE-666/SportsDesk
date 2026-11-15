import { useViewState } from '../../lib/useViewState';
import { usePageScroll } from '../../lib/usePageScroll';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  GitBranch,
  Search,
  Trophy,
  X,
} from 'lucide-react';
import { FeaturedMatchCover, selectFeaturedMatch } from '../football/FeaturedMatchCover';
import TeamBadge from '../../components/TeamBadge';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  SegmentedControl,
  StatTile,
} from '../../kit';
import { SourceLine } from '../../components/SourceLine';
import { CompetitionInsights, statSummaryTiles, type StatTileId } from './CompetitionInsights';
const STAT_CAPTIONS: Record<StatTileId, string> = {
  played: 'Матчей сыграно',
  goals: 'Голов забито',
  average: 'Голов за матч',
  teams: 'Участников',
};
import { FavoritesProvider } from '../football/FavoritesProvider';
import { MatchDetailView } from '../football/MatchDetailView';
import { formatHumanDateTime } from '../../lib/humanDate';
import { countRu, MATCHES } from '../../lib/plural';
import { getUserTimezone, getString, setString, normalizeName } from '../football/storage';
import {
  currentUclSeason,
  fetchUclSeason,
  fetchUclStandings,
  fetchUclScorers,
  fetchUclPlayer,
} from './data';
import type { UclSeasonData, UclTableRow, UclScorer } from './data';
import { fetchUclBracket } from './bracket';
import type { BracketData, BracketTie, UclKnockoutRound } from './bracket';
import type { MatchSummary } from '../football/types';
import { openExternal } from '../../lib/bridge';
import { useDataRecovery } from '../../lib/useDataRecovery';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { UclError, UclLoading } from './uclStates';
import { UclMatchRow } from './UclMatchRow';
import './ucl.css';

export type UclTab = 'overview' | 'table' | 'bracket' | 'matches' | 'stats';
const ROUNDS: { id: UclKnockoutRound; label: string; caption: string }[] = [
  { id: 'playoff', label: 'Стыковые матчи', caption: 'ПУТЬ В 1/8' },
  { id: 'r16', label: '1/8 финала', caption: '16 КОМАНД' },
  { id: 'quarter', label: '1/4 финала', caption: '8 КОМАНД' },
  { id: 'semi', label: 'Полуфиналы', caption: '4 КОМАНДЫ' },
  { id: 'final', label: 'Финал', caption: 'ГЛАВНЫЙ ВЕЧЕР' },
];
const TITLES: Record<UclTab, string> = {
  overview: 'Европейский вечер',
  table: 'Общая таблица',
  bracket: 'Путь к трофею',
  matches: 'Все матчи',
  stats: 'Герои этого сезона',
};
function normalizeTeam(s: string) {
  return normalizeName(s)
    .replace(/\b(fc|cf|afc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function Inner({ tab, onTabChange }: { tab: UclTab; onTabChange: (tab: UclTab) => void }) {
  const current = currentUclSeason();
  const [season, setSeason] = useState(() => getString('sportsdesk.ucl.season') || current);
  const [data, setData] = useState<UclSeasonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useDataRecovery(
    (key) =>
      key.startsWith('pitch:leagues/l_0bfbkO/') ||
      key === 'pitch:leagues' ||
      (key.startsWith('sportscore:') && key.includes('slug=uefa-champions-league')),
    () => setRefresh((n) => n + 1),
  );
  const [rows, setRows] = useState<UclTableRow[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [scorers, setScorers] = useState<UclScorer[]>([]);
  const [scorerError, setScorerError] = useState<string | null>(null);
  const [ranking, setRanking] = useViewState<'goals' | 'assists'>(
    'ucl.ranking',
    'goals',
    (v) => v === 'goals' || v === 'assists',
  );
  const [bracket, setBracket] = useState<BracketData | null>(null);
  const [bracketBusy, setBracketBusy] = useState(false);
  const [bracketError, setBracketError] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const viewScope = 'ucl';
  const [selectedMatch, setSelectedMatch] = useViewState<string | null>(
    `${viewScope}.match`,
    null,
    (v) => v === null || typeof v === 'string',
  );
  const [query, setQuery] = useViewState(`${viewScope}.query`, '');
  const [status, setStatus] = useViewState<'all' | 'finished' | 'upcoming'>(
    `${viewScope}.status`,
    'all',
    (v) => ['all', 'finished', 'upcoming'].includes(String(v)),
  );
  const [selectedPlayer, setSelectedPlayer] = useState<UclScorer | null>(null);
  const [playerInfo, setPlayerInfo] = useState<Record<string, unknown> | null>(null);
  usePageScroll(`${viewScope}.${season}.${selectedMatch ? `match.${selectedMatch}` : tab}`);
  const previousContext = useRef(`${tab}.${season}`);
  useEffect(() => {
    const context = `${tab}.${season}`;
    if (previousContext.current !== context) setSelectedMatch(null);
    previousContext.current = context;
  }, [tab, season]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    setBracket(null);
    setString('sportsdesk.ucl.season', season);
    fetchUclSeason(season)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось загрузить турнир.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [season, refresh]);
  useEffect(() => {
    if (season !== current || !['table', 'overview'].includes(tab)) return;
    let active = true;
    setTableError(null);
    fetchUclStandings()
      .then((d) => {
        if (active) setRows(d.rows);
      })
      .catch((e) => {
        if (active) setTableError(e.message);
      });
    return () => {
      active = false;
    };
  }, [season, current, tab, refresh]);
  useEffect(() => {
    if (season !== current || !['stats', 'overview'].includes(tab)) return;
    let active = true;
    setScorerError(null);
    setScorers([]);
    fetchUclScorers(ranking)
      .then((d) => {
        if (active) setScorers(d.players);
      })
      .catch((e) => {
        if (active) setScorerError(e.message);
      });
    return () => {
      active = false;
    };
  }, [season, current, tab, ranking, refresh]);
  useEffect(() => {
    if (tab !== 'bracket' || !data || data.season !== season) return;
    let active = true;
    setBracketBusy(true);
    setBracketError(null);
    setProgress([0, 0]);
    fetchUclBracket(data.matches, season, (done, total) => {
      if (active) setProgress([done, total]);
    })
      .then((d) => {
        if (active) setBracket(d);
      })
      .catch((e) => {
        if (active) setBracketError(e.message);
      })
      .finally(() => {
        if (active) setBracketBusy(false);
      });
    return () => {
      active = false;
    };
  }, [tab, data, season]);
  useEffect(() => {
    let active = true;
    setPlayerInfo(null);
    if (selectedPlayer?.slug)
      fetchUclPlayer(selectedPlayer.slug)
        .then((d) => {
          if (active) setPlayerInfo(d);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedPlayer]);
  const matches = data?.matches ?? [];
  const played = matches.filter((m) => classifyMatchStatus(m.status, m.status_text) === 'finished');
  const totalGoals = played.reduce((n, m) => n + (m.score_home ?? 0) + (m.score_away ?? 0), 0);
  const teams = useMemo(() => {
    const map = new Map<string, MatchSummary['home_team']>();
    for (const m of matches) {
      map.set(m.home_team.id, m.home_team);
      map.set(m.away_team.id, m.away_team);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const statTiles = statSummaryTiles({
    teams: teams.length,
    played: played.length,
    goals: totalGoals,
  });
  const upcoming = matches
    .filter(
      (m) =>
        ['scheduled', 'live'].includes(classifyMatchStatus(m.status, m.status_text)) &&
        new Date(m.time_utc ?? m.date ?? '').getTime() > Date.now() - 7200000,
    )
    .sort((a, b) => (a.time_utc ?? '').localeCompare(b.time_utc ?? ''));
  const filtered = matches
    .filter((m) => {
      const state = classifyMatchStatus(m.status, m.status_text);
      if (status === 'finished' && state !== 'finished') return false;
      if (status === 'upcoming' && !['scheduled', 'live'].includes(state)) return false;
      const q = normalizeTeam(query);
      return !q || normalizeTeam(`${m.home_team.name} ${m.away_team.name}`).includes(q);
    })
    .sort((a, b) =>
      status === 'upcoming'
        ? (a.time_utc ?? '').localeCompare(b.time_utc ?? '')
        : (b.time_utc ?? '').localeCompare(a.time_utc ?? ''),
    );
  const teamMatches = (name: string) => {
    const exact = teams.find((t) => normalizeTeam(t.name) === normalizeTeam(name));
    setQuery(exact?.name ?? name);
    setStatus('all');
    onTabChange('matches');
  };
  const openMatch = (id: string) => setSelectedMatch(id);
  const chooseTab = (t: UclTab) => {
    setSelectedMatch(null);
    onTabChange(t);
  };
  if (selectedMatch)
    return (
      <MatchDetailView
        key={selectedMatch}
        matchId={selectedMatch}
        seasonMatches={matches}
        onOpenMatch={openMatch}
        onBack={() => setSelectedMatch(null)}
      />
    );
  return (
    <div className="ucl-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CHAMPIONS LEAGUE / EUROPE</span>
          <h2 className="screen-title">
            {TITLES[tab]}
            <span className="heading-dot">.</span>
          </h2>
        </div>
        <div className="ucl-season">
          <label htmlFor="ucl-season">СЕЗОН</label>
          <select
            id="ucl-season"
            value={season}
            onChange={(e) => {
              setSeason(e.target.value);
              setQuery('');
            }}
          >
            {(data?.seasons ?? [season]).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Button small disabled={loading} onClick={() => setRefresh((x) => x + 1)}>
            Обновить
          </Button>
        </div>
      </div>
      {tab === 'overview' && (
        <>
          <FeaturedMatchCover
            sport="ucl"
            match={selectFeaturedMatch(matches)}
            league="Лига чемпионов"
            season={season}
            loading={loading}
            onOpenMatch={openMatch}
            onSeeAllMatches={() => chooseTab('matches')}
          />
          <CompetitionInsights teams={teams.length} played={played.length} goals={totalGoals} />
        </>
      )}
      {loading && <UclLoading label="Загружаем европейский футбол…" rows={4} />}
      {error && (
        <UclError
          title="Турнир временно недоступен"
          message={error}
          onRetry={() => setRefresh((x) => x + 1)}
        />
      )}
      {data?.stale && (
        <Badge variant="warning">Сохранённые данные · обновление временно недоступно</Badge>
      )}
      {tab === 'overview' && data && (
        <>
          <div className="editorial-grid">
            <section className="panel ucl-match-list">
              <div className="section-title">
                <h2>
                  <CalendarDays size={16} aria-hidden="true" /> Ближайшие противостояния
                </h2>
                <Button variant="quiet" small onClick={() => chooseTab('matches')}>
                  Все матчи <ChevronRight size={13} aria-hidden="true" />
                </Button>
              </div>
              {upcoming.slice(0, 6).map((m) => (
                <UclMatchRow key={m.id} match={m} onClick={() => openMatch(m.id)} />
              ))}
              {!upcoming.length && (
                <EmptyState message="Розыгрыш завершён. Результаты — в разделе «Все матчи»." />
              )}
            </section>
            <section className="panel">
              <div className="section-title">
                <h2>
                  <Trophy size={16} aria-hidden="true" /> На вершине таблицы
                </h2>
                <Button variant="quiet" small onClick={() => chooseTab('table')}>
                  Все команды <ChevronRight size={13} aria-hidden="true" />
                </Button>
              </div>
              {season === current ? (
                <>
                  <Table rows={rows.slice(0, 7)} compact onTeam={teamMatches} />
                  {tableError && <p className="muted small">{tableError}</p>}
                </>
              ) : (
                <p className="muted small">Таблица есть только для текущего розыгрыша.</p>
              )}
            </section>
          </div>
          <section className="panel ucl-teams">
            <div className="section-title">
              <h2>Клубы этого сезона</h2>
              <span className="muted small">Эмблема открывает матчи команды</span>
            </div>
            <div className="ucl-logo-wall">
              {teams.map((t) => (
                <Button
                  key={t.id}
                  variant="quiet"
                  className="ucl-team-chip"
                  onClick={() => teamMatches(t.name)}
                  title={t.name}
                >
                  <TeamBadge name={t.name} imageUrl={t.image_url} size={31} />
                  <span>{t.name}</span>
                </Button>
              ))}
            </div>
          </section>
        </>
      )}
      {tab === 'table' && (
        <section className="panel">
          {season !== current ? (
            <EmptyState message="Архивная таблица не предоставлена. Таблица есть только для текущего сезона." />
          ) : tableError ? (
            <UclError
              title="Таблица недоступна"
              message={tableError}
              onRetry={() => setRefresh((x) => x + 1)}
            />
          ) : rows.length ? (
            <>
              <div className="table-legend">
                <span>
                  <i className="ucl-standings__dot ucl-standings__dot--direct" />
                  Места 1–8
                </span>
                <span>
                  <i className="ucl-standings__dot ucl-standings__dot--playoff" />
                  Места 9–24
                </span>
                <small>Участники плей-офф определятся после завершения этапа.</small>
              </div>
              <Table rows={rows} onTeam={teamMatches} />
            </>
          ) : (
            <UclLoading label="Загрузка общей таблицы…" rows={8} />
          )}
        </section>
      )}
      {tab === 'matches' && data && (
        <>
          <div className="panel filters-bar">
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
                aria-label="Поиск матчей Лиги чемпионов"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти свою команду"
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
          </div>
          <section className="panel ucl-match-list">
            {filtered.map((m) => (
              <UclMatchRow key={m.id} match={m} onClick={() => openMatch(m.id)} />
            ))}
            {!filtered.length && (
              <EmptyState message="Совпадений нет. Измените команду или статус матча." />
            )}
          </section>
        </>
      )}
      {tab === 'bracket' && (
        <>
          <div className="bracket-intro">
            <GitBranch size={19} aria-hidden="true" />
            <p>Откройте пару, чтобы увидеть её матчи.</p>
            <Badge>{season}</Badge>
          </div>
          {bracketBusy && (
            <UclLoading
              label={`Собираем подтверждённые пары${progress[1] ? `: ${progress[0]} / ${progress[1]}` : ''}…`}
              rows={3}
            />
          )}{' '}
          {bracketError && (
            <UclError
              title="Не удалось загрузить сетку"
              message={bracketError}
              onRetry={() => setRefresh((x) => x + 1)}
            />
          )}{' '}
          {!bracketBusy && bracket && (
            <>
              <div className="knockout-scroll">
                <div className="knockout-board">
                  {ROUNDS.map((r, index) => (
                    <section className={`knockout-stage stage-${r.id}`} key={r.id}>
                      <div className="stage-heading">
                        <small>{r.caption}</small>
                        <h3>{r.label}</h3>
                        <span>0{index + 1}</span>
                      </div>
                      <div className="stage-ties">
                        {bracket.ties
                          .filter((t) => t.round === r.id)
                          .map((t) => (
                            <TieCard key={t.id} tie={t} onOpen={openMatch} />
                          ))}
                        {!bracket.ties.some((t) => t.round === r.id) && (
                          <EmptyState
                            className="ucl-stage-empty"
                            icon={<Trophy size={20} aria-hidden="true" />}
                            message="Пары ещё не определены. Появятся после жеребьёвки."
                          />
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
              {bracket.missingDetails > 0 && (
                <p className="muted small">
                  Неполные данные: часть стадий не получена ({bracket.missingDetails}).
                </p>
              )}
            </>
          )}
        </>
      )}
      {tab === 'stats' && data && (
        <>
          {statTiles.length > 0 && (
            <div className="ucl-stat-summary">
              {statTiles.map(({ id, value }) => (
                <StatTile key={id} label={STAT_CAPTIONS[id]} value={value} />
              ))}
            </div>
          )}
          <section className="panel">
            <div className="section-title">
              <h2>Главные действующие лица</h2>
              <SegmentedControl
                ariaLabel="Рейтинг игроков"
                value={ranking}
                onChange={(id) => setRanking(id as 'goals' | 'assists')}
                items={[
                  { id: 'goals', label: 'Бомбардиры' },
                  { id: 'assists', label: 'Ассистенты' },
                ]}
              />
            </div>
            {season !== current ? (
              <p className="muted small">Рейтинг игроков есть только для текущего розыгрыша.</p>
            ) : scorerError ? (
              <UclError
                title="Рейтинг недоступен"
                message={scorerError}
                onRetry={() => setRefresh((x) => x + 1)}
              />
            ) : scorers.length ? (
              <div className="scorer-grid">
                {scorers.map((p) => (
                  <Button
                    key={p.slug ?? p.name}
                    variant="quiet"
                    className="scorer-card"
                    onClick={() => setSelectedPlayer(p)}
                  >
                    <span className="scorer-rank">{String(p.rank).padStart(2, '0')}</span>
                    <span className="scorer-photo">
                      <TeamBadge name={p.name} imageUrl={p.photo || p.teamLogo} size={48} />
                    </span>
                    <strong>{p.name}</strong>
                    <small>{p.team}</small>
                    <span className="scorer-value">
                      {ranking === 'goals' ? (p.goals ?? '—') : (p.assists ?? '—')}
                      <small>{ranking === 'goals' ? 'голов' : 'ассистов'}</small>
                    </span>
                  </Button>
                ))}
              </div>
            ) : (
              <UclLoading label="Загружаем рейтинг игроков…" rows={4} />
            )}
          </section>
        </>
      )}
      <SourceLine sources={['pitch', 'sportscore']} fetchedAt={data?.fetchedAt} />
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
            <span className="eyebrow">CHAMPIONS LEAGUE / {current}</span>
            <div className="ucl-player__badge">
              <TeamBadge
                name={selectedPlayer.name}
                imageUrl={selectedPlayer.photo || selectedPlayer.teamLogo}
                size={90}
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

function Table({
  rows,
  onTeam,
  compact = false,
}: {
  rows: UclTableRow[];
  onTeam: (name: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="ui-table-scroll">
      <table className={`ui-table ucl-standings${compact ? ' ucl-standings--compact' : ''}`}>
        <thead>
          <tr>
            <th className="ui-table__num">#</th>
            <th>Команда</th>
            <th className="ui-table__num">И</th>
            {!compact && (
              <>
                <th className="ui-table__num">В</th>
                <th className="ui-table__num">Н</th>
                <th className="ui-table__num">П</th>
                <th className="ui-table__num">ЗМ</th>
                <th className="ui-table__num">ПМ</th>
                <th className="ui-table__num">РМ</th>
              </>
            )}
            <th className="ui-table__num">О</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              className={
                r.position <= 8
                  ? 'ucl-standings__direct'
                  : r.position <= 24
                    ? 'ucl-standings__playoff'
                    : ''
              }
              key={r.slug ?? r.position}
            >
              <td className="ui-table__num">
                <span className="ucl-standings__position">{r.position}</span>
              </td>
              <td>
                <Button
                  variant="quiet"
                  small
                  className="ucl-team-button"
                  onClick={() => onTeam(r.team)}
                >
                  <TeamBadge name={r.team} imageUrl={r.logo} size={23} />
                  <strong>{r.team}</strong>
                </Button>
              </td>
              <td className="ui-table__num">{r.played ?? '—'}</td>
              {!compact && (
                <>
                  <td className="ui-table__num">{r.wins ?? '—'}</td>
                  <td className="ui-table__num">{r.draws ?? '—'}</td>
                  <td className="ui-table__num">{r.losses ?? '—'}</td>
                  <td className="ui-table__num">{r.gf ?? '—'}</td>
                  <td className="ui-table__num">{r.ga ?? '—'}</td>
                  <td className="ui-table__num">
                    {r.gd != null ? (r.gd > 0 ? `+${r.gd}` : r.gd) : '—'}
                  </td>
                </>
              )}
              <td className="ui-table__num">
                <b>{r.points ?? '—'}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function TieCard({ tie: t, onOpen }: { tie: BracketTie; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const legCount = t.legs.length === 1 ? 'Один матч' : `${t.legs.length} матча`;
  return (
    <div className={`bracket-tie${t.round === 'final' ? ' final-tie' : ''}`}>
      <UclMatchRow
        size="compact"
        match={{
          id: t.id,
          status: t.complete ? 'finished' : 'scheduled',
          home_team: { id: t.home.id, name: t.home.name, image_url: t.home.image_url ?? undefined },
          away_team: { id: t.away.id, name: t.away.name, image_url: t.away.image_url ?? undefined },
          score_home: t.aggregateHome,
          score_away: t.aggregateAway,
        }}
        time={null}
        competition={legCount}
        onClick={() => setOpen(!open)}
      />
      {t.complete && !t.winnerId && (
        <em className="bracket-tie__note">Итоговый победитель не указан источником</em>
      )}
      {open && (
        <div className="bracket-tie__legs">
          {t.legs.map((l, i) => (
            <UclMatchRow
              key={l.id}
              size="compact"
              match={{
                id: l.id,
                status: l.status,
                time_utc: l.date,
                home_team: {
                  id: l.realHome.id,
                  name: l.realHome.name,
                  image_url: l.realHome.image_url ?? undefined,
                },
                away_team: {
                  id: l.realAway.id,
                  name: l.realAway.name,
                  image_url: l.realAway.image_url ?? undefined,
                },
                score_home: l.realHomeScore,
                score_away: l.realAwayScore,
              }}
              time={formatHumanDateTime(l.date, getUserTimezone())}
              competition={`Матч ${i + 1}`}
              onClick={() => onOpen(l.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChampionsView(props: { tab: UclTab; onTabChange: (tab: UclTab) => void }) {
  return (
    <FavoritesProvider>
      <Inner {...props} />
    </FavoritesProvider>
  );
}
