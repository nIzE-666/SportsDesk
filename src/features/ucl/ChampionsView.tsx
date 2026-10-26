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
import { ModeHero } from '../../components/ModeHero';
import TeamBadge from '../../components/TeamBadge';
import { MatchRow } from '../../components/MatchRow';
import { ErrorBlock, LoadingBlock, EmptyBlock } from '../../components/StateViews';
import { FavoritesProvider } from '../football/FavoritesProvider';
import { MatchDetailView } from '../football/MatchDetailView';
import {
  formatDateTime,
  getUserTimezone,
  getString,
  setString,
  normalizeName,
} from '../football/storage';
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
  useEffect(() => {
    if (!selectedPlayer) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedPlayer(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selectedPlayer]);
  const matches = data?.matches ?? [];
  const played = matches.filter((m) => m.status === 'finished');
  const totalGoals = played.reduce((n, m) => n + (m.score_home ?? 0) + (m.score_away ?? 0), 0);
  const teams = useMemo(() => {
    const map = new Map<string, MatchSummary['home_team']>();
    for (const m of matches) {
      map.set(m.home_team.id, m.home_team);
      map.set(m.away_team.id, m.away_team);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const upcoming = matches
    .filter(
      (m) =>
        m.status !== 'finished' &&
        new Date(m.time_utc ?? m.date ?? '').getTime() > Date.now() - 7200000,
    )
    .sort((a, b) => (a.time_utc ?? '').localeCompare(b.time_utc ?? ''));
  const filtered = matches
    .filter((m) => {
      if (status === 'finished' && m.status !== 'finished') return false;
      if (status === 'upcoming' && m.status === 'finished') return false;
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
          <h2>
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
          <button className="ghost-btn" disabled={loading} onClick={() => setRefresh((x) => x + 1)}>
            Обновить
          </button>
        </div>
      </div>
      {tab === 'overview' && (
        <>
          <ModeHero
            mode="ucl"
            eyebrow="THE NIGHTS WE LIVE FOR"
            title={
              <>
                Здесь рождаются
                <br />
                <em>легенды.</em>
              </>
            }
            description="Лучшие клубы Европы. Один трофей. Весь турнир — от первого свистка до главного финала."
          >
            <button className="primary-btn" onClick={() => chooseTab('bracket')}>
              Турнирная сетка <GitBranch size={15} />
            </button>
            <button
              className="hero-secondary"
              onClick={() => {
                setStatus('upcoming');
                chooseTab('matches');
              }}
            >
              Ближайшие матчи <ChevronRight size={12} />
            </button>
          </ModeHero>
          <div className="insights-row ucl-insights">
            <div>
              <Trophy size={18} />
              <span>
                <strong>{teams.length || '—'}</strong>
                <small>команд в розыгрыше</small>
              </span>
            </div>
            <div>
              <CalendarDays size={18} />
              <span>
                <strong>{played.length}</strong>
                <small>сыгранных матчей</small>
              </span>
            </div>
            <div>
              <span className="metric-star">✦</span>
              <span>
                <strong>{totalGoals}</strong>
                <small>голов в завершённых матчах</small>
              </span>
            </div>
          </div>
        </>
      )}
      {loading && <LoadingBlock label="Загружаем европейский футбол…" rows={4} />}
      {error && (
        <ErrorBlock
          title="Турнир временно недоступен"
          message={error}
          onRetry={() => setRefresh((x) => x + 1)}
        />
      )}
      {data?.stale && (
        <span className="chip stale-chip">Сохранённые данные · обновление временно недоступно</span>
      )}
      {tab === 'overview' && data && (
        <>
          <div className="editorial-grid">
            <section className="panel">
              <div className="section-title">
                <h2>
                  <CalendarDays size={16} /> Ближайшие противостояния
                </h2>
                <button className="text-link" onClick={() => chooseTab('matches')}>
                  Все матчи <ChevronRight size={13} />
                </button>
              </div>
              {upcoming.slice(0, 6).map((m) => (
                <MatchRow key={m.id} match={m} onClick={() => openMatch(m.id)} />
              ))}
              {!upcoming.length && (
                <EmptyBlock
                  title="Розыгрыш завершён"
                  message="Выберите другой сезон или посмотрите результаты матчей."
                />
              )}
            </section>
            <section className="panel">
              <div className="section-title">
                <h2>
                  <Trophy size={16} /> На вершине таблицы
                </h2>
                <button className="text-link" onClick={() => chooseTab('table')}>
                  Все команды <ChevronRight size={13} />
                </button>
              </div>
              {season === current ? (
                <>
                  <Table rows={rows.slice(0, 7)} compact onTeam={teamMatches} />
                  {tableError && <p className="muted small">{tableError}</p>}
                </>
              ) : (
                <p className="muted small">
                  Общая таблица доступна для текущего розыгрыша. Матчи и сетка выбранного сезона
                  сохранены в своих разделах.
                </p>
              )}
            </section>
          </div>
          <section className="ucl-teams panel">
            <div className="section-title">
              <h2>Клубы этого сезона</h2>
              <span className="muted small">Нажмите на эмблему, чтобы найти матчи команды</span>
            </div>
            <div className="ucl-logo-wall">
              {teams.map((t) => (
                <button key={t.id} onClick={() => teamMatches(t.name)} title={t.name}>
                  <TeamBadge name={t.name} imageUrl={t.image_url} size={31} />
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      {tab === 'table' && (
        <section className="panel">
          {season !== current ? (
            <EmptyBlock
              title="Архивная таблица не предоставлена"
              message="Этот источник возвращает таблицу текущего сезона. Сетка и результаты выбранного сезона доступны отдельно."
            />
          ) : tableError ? (
            <ErrorBlock
              title="Таблица недоступна"
              message={tableError}
              onRetry={() => setRefresh((x) => x + 1)}
            />
          ) : rows.length ? (
            <>
              <div className="table-legend">
                <span>
                  <i />
                  Места 1–8
                </span>
                <span>
                  <i />
                  Места 9–24
                </span>
                <small>
                  Положение в текущей таблице; итоговые участники плей-офф определятся после
                  завершения этапа.
                </small>
              </div>
              <Table rows={rows} onTeam={teamMatches} />
            </>
          ) : (
            <LoadingBlock label="Загрузка общей таблицы…" rows={8} />
          )}
        </section>
      )}
      {tab === 'matches' && data && (
        <>
          <div className="panel filters-bar">
            <div className="segmented">
              {(['all', 'upcoming', 'finished'] as const).map((s) => (
                <button
                  key={s}
                  className={status === s ? 'active' : ''}
                  onClick={() => setStatus(s)}
                >
                  {s === 'all' ? 'Все матчи' : s === 'upcoming' ? 'Предстоящие' : 'Результаты'}
                </button>
              ))}
            </div>
            <div className="input-wrap grow">
              <Search size={15} />
              <input
                aria-label="Поиск матчей Лиги чемпионов"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти свою команду"
              />
              {query && (
                <button
                  className="icon-button"
                  onClick={() => setQuery('')}
                  aria-label="Очистить поиск"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="muted small">{filtered.length} матчей</span>
          </div>
          <section className="panel ucl-match-list">
            {filtered.map((m) => (
              <MatchRow key={m.id} match={m} onClick={() => openMatch(m.id)} />
            ))}
            {!filtered.length && (
              <EmptyBlock title="Совпадений нет" message="Измените команду или статус матча." />
            )}
          </section>
        </>
      )}
      {tab === 'bracket' && (
        <>
          <div className="bracket-intro">
            <GitBranch size={19} />
            <p>
              Каждое противостояние — ещё один шаг к финалу.
              <small>Откройте пару, чтобы посмотреть матчи и подробную статистику.</small>
            </p>
            <span className="chip">{season}</span>
          </div>
          {bracketBusy && (
            <LoadingBlock
              label={`Собираем подтверждённые пары${progress[1] ? `: ${progress[0]} / ${progress[1]}` : ''}…`}
              rows={3}
            />
          )}{' '}
          {bracketError && (
            <ErrorBlock
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
                          <div className="tie-placeholder">
                            <Trophy size={18} />
                            <strong>Пары ещё не определены</strong>
                            <small>Появятся после жеребьёвки и публикации расписания.</small>
                          </div>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
              {bracket.missingDetails > 0 && (
                <p className="muted small">
                  Часть данных о стадиях не получена ({bracket.missingDetails}). Показаны
                  подтверждённые пары.
                </p>
              )}
            </>
          )}
        </>
      )}
      {tab === 'stats' && data && (
        <>
          <div className="ucl-stat-summary">
            <div className="panel">
              <small>Матчей сыграно</small>
              <strong>{played.length}</strong>
            </div>
            <div className="panel">
              <small>Голов забито</small>
              <strong>{totalGoals}</strong>
            </div>
            <div className="panel">
              <small>Голов за матч</small>
              <strong>{played.length ? (totalGoals / played.length).toFixed(2) : '—'}</strong>
            </div>
            <div className="panel">
              <small>Участников</small>
              <strong>{teams.length}</strong>
            </div>
          </div>
          <section className="panel">
            <div className="section-title">
              <h2>Главные действующие лица</h2>
              <div className="segmented">
                <button
                  className={ranking === 'goals' ? 'active' : ''}
                  onClick={() => setRanking('goals')}
                >
                  Бомбардиры
                </button>
                <button
                  className={ranking === 'assists' ? 'active' : ''}
                  onClick={() => setRanking('assists')}
                >
                  Ассистенты
                </button>
              </div>
            </div>
            {season !== current ? (
              <p className="muted small">
                Рейтинг игроков доступен только для текущего розыгрыша. Подробные показатели за
                архивный сезон можно открыть в каждом матче.
              </p>
            ) : scorerError ? (
              <ErrorBlock
                title="Рейтинг недоступен"
                message={scorerError}
                onRetry={() => setRefresh((x) => x + 1)}
              />
            ) : scorers.length ? (
              <div className="scorer-grid">
                {scorers.map((p) => (
                  <button
                    key={p.slug ?? p.name}
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
                  </button>
                ))}
              </div>
            ) : (
              <LoadingBlock label="Загружаем рейтинг игроков…" rows={4} />
            )}
          </section>
        </>
      )}
      <div className="source-foot">
        Матчи: PitchAPI · Таблицы и рейтинги:{' '}
        <a href="https://sportscore.com" target="_blank" rel="noreferrer">
          Powered by SportScore
        </a>
        {data?.fetchedAt ? ` · ${formatDateTime(data.fetchedAt, getUserTimezone())}` : ''}
      </div>
      {selectedPlayer && (
        <div className="player-modal-scrim" onClick={() => setSelectedPlayer(null)}>
          <section
            className="panel ucl-player-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Статистика ${selectedPlayer.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              autoFocus
              onClick={() => setSelectedPlayer(null)}
              aria-label="Закрыть профиль игрока"
            >
              <X size={20} />
            </button>
            <span className="eyebrow">CHAMPIONS LEAGUE / {current}</span>
            <TeamBadge
              name={selectedPlayer.name}
              imageUrl={selectedPlayer.photo || selectedPlayer.teamLogo}
              size={90}
            />
            <h2>{selectedPlayer.name}</h2>
            <p className="muted">{selectedPlayer.team}</p>
            <div className="ucl-player-metrics">
              {[
                { label: 'Голы', value: selectedPlayer.goals },
                { label: 'Ассисты', value: selectedPlayer.assists },
                { label: 'Матчи', value: selectedPlayer.matches },
                { label: 'Минуты', value: selectedPlayer.minutes },
              ].map((s) => (
                <div key={s.label}>
                  <strong>{s.value ?? '—'}</strong>
                  <small>{s.label}</small>
                </div>
              ))}
            </div>
            {playerInfo && typeof playerInfo.nationality === 'string' && (
              <p className="muted small">{playerInfo.nationality}</p>
            )}
            <p className="muted small">
              Подробные передачи, удары и действия игрока доступны в статистике конкретного матча.
            </p>
            <button
              className="primary-btn"
              onClick={() => {
                const name = selectedPlayer.team;
                setSelectedPlayer(null);
                teamMatches(name);
              }}
            >
              Матчи команды <ChevronRight size={14} />
            </button>
            {selectedPlayer.slug && (
              <button
                className="text-link"
                onClick={() =>
                  openExternal(`https://sportscore.com/football/player/${selectedPlayer.slug}/`)
                }
              >
                Профиль SportScore <ArrowUpRight size={14} />
              </button>
            )}
          </section>
        </div>
      )}
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
    <div className="ucl-table-scroll">
      <table className={`ucl-table ${compact ? 'compact' : ''}`}>
        <thead>
          <tr>
            <th>#</th>
            <th>Команда</th>
            <th>И</th>
            {!compact && (
              <>
                <th>В</th>
                <th>Н</th>
                <th>П</th>
                <th>ЗМ</th>
                <th>ПМ</th>
                <th>РМ</th>
              </>
            )}
            <th>О</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              className={r.position <= 8 ? 'direct' : r.position <= 24 ? 'playoff' : ''}
              key={r.slug ?? r.position}
            >
              <td>
                <span>{r.position}</span>
              </td>
              <td>
                <button onClick={() => onTeam(r.team)}>
                  <TeamBadge name={r.team} imageUrl={r.logo} size={23} />
                  <strong>{r.team}</strong>
                </button>
              </td>
              <td>{r.played ?? '—'}</td>
              {!compact && (
                <>
                  <td>{r.wins ?? '—'}</td>
                  <td>{r.draws ?? '—'}</td>
                  <td>{r.losses ?? '—'}</td>
                  <td>{r.gf ?? '—'}</td>
                  <td>{r.ga ?? '—'}</td>
                  <td>{r.gd != null ? (r.gd > 0 ? `+${r.gd}` : r.gd) : '—'}</td>
                </>
              )}
              <td>
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
  return (
    <div className={`bracket-tie ${t.round === 'final' ? 'final-tie' : ''}`}>
      <button className="tie-main" aria-expanded={open} onClick={() => setOpen(!open)}>
        <small>
          {t.legs.length === 1 ? 'Один матч' : `${t.legs.length} матча`}
          <ChevronRight size={12} />
        </small>
        {[
          { team: t.home, score: t.aggregateHome },
          { team: t.away, score: t.aggregateAway },
        ].map(({ team, score }) => (
          <span key={team.id} className={t.winnerId === team.id ? 'tie-winner' : ''}>
            <TeamBadge name={team.name} imageUrl={team.image_url} size={24} />
            <strong>{team.name}</strong>
            <b>{score ?? '—'}</b>
          </span>
        ))}
        {t.complete && !t.winnerId && <em>Итоговый победитель не указан источником</em>}
      </button>
      {open && (
        <div className="tie-legs">
          {t.legs.map((l, i) => (
            <button key={l.id} onClick={() => onOpen(l.id)}>
              <span>
                Матч {i + 1}
                <small>{formatDateTime(l.date, getUserTimezone())}</small>
              </span>
              <b>
                {l.homeScore ?? '—'} : {l.awayScore ?? '—'}
              </b>
              <ChevronRight size={12} />
            </button>
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
