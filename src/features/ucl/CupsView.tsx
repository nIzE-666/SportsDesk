import { useViewState } from '../../lib/useViewState';
import { usePageScroll } from '../../lib/usePageScroll';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronRight, GitBranch, Search, Trophy, X } from 'lucide-react';
import { useInterfaceDesign } from '../../lib/interfaceDesign';
import { FeaturedMatchCover, selectFeaturedMatch } from '../football/FeaturedMatchCover';
import TeamBadge from '../../components/TeamBadge';
import { MatchRow } from '../../components/MatchRow';
import { ErrorBlock, LoadingBlock, EmptyBlock } from '../../components/StateViews';
import { MatchDetailView } from '../football/MatchDetailView';
import { useDataRecovery } from '../../lib/useDataRecovery';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import {
  formatDateTime,
  getUserTimezone,
  getString,
  setString,
  normalizeName,
} from '../football/storage';
import {
  CUP_COMPETITIONS,
  fetchCupSeason,
  fetchCupStandings,
  currentSeasonFor,
  type CupCompetition,
  type CupTableRow,
} from './cups';
import { fetchBracketFor } from './bracket';
import type { BracketData, BracketTie, UclKnockoutRound } from './bracket';
import type { MatchSummary } from '../football/types';
import './ucl.css';

/**
 * Универсальный интерфейс кубкового турнира: Лига Европы, Лига конференций,
 * Чемпионат мира. Данные — только живые провайдеры (PitchAPI/SportScore).
 */

export type CupTab = 'overview' | 'table' | 'bracket' | 'matches';

const ROUNDS: { id: UclKnockoutRound; label: string; caption: string }[] = [
  { id: 'playoff', label: 'Стыковые матчи', caption: 'ПУТЬ В 1/8' },
  { id: 'r16', label: '1/8 финала', caption: '16 КОМАНД' },
  { id: 'quarter', label: '1/4 финала', caption: '8 КОМАНД' },
  { id: 'semi', label: 'Полуфиналы', caption: '4 КОМАНДЫ' },
  { id: 'final', label: 'Финал', caption: 'ГЛАВНЫЙ ВЕЧЕР' },
];

const TITLES: Record<CupTab, string> = {
  overview: 'Турнир',
  table: 'Таблица',
  bracket: 'Путь к трофею',
  matches: 'Все матчи',
};

function normalizeTeam(s: string) {
  return normalizeName(s)
    .replace(/\b(fc|cf|afc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function Inner({
  competition,
  tab,
  onTabChange,
}: {
  competition: CupCompetition;
  tab: CupTab;
  onTabChange: (tab: CupTab) => void;
}) {
  const storageKey = `sportsdesk.cup.${competition.id}.season`;
  const broadcast = useInterfaceDesign() === 'broadcast';
  const [season, setSeason] = useState<string>(() => getString(storageKey) || '');
  const [currentSeason, setCurrentSeason] = useState('');
  const rounds =
    competition.bracketFormat === 'single-leg'
      ? [
          ...(Number(season) >= 2026
            ? [{ id: 'playoff' as const, label: '1/16 финала', caption: '32 КОМАНДЫ' }]
            : []),
          ...ROUNDS.filter((r) => r.id !== 'playoff' && r.id !== 'final'),
          { id: 'third' as const, label: 'Матч за третье место', caption: 'БРОНЗОВЫЕ МЕДАЛИ' },
          { id: 'final' as const, label: 'Финал', caption: 'ГЛАВНЫЙ ВЕЧЕР' },
        ]
      : ROUNDS;
  const [seasons, setSeasons] = useState<string[]>([]);
  const [data, setData] = useState<{
    matches: MatchSummary[];
    fetchedAt: string;
    stale: boolean;
    season: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useDataRecovery(
    (key) =>
      key === 'pitch:leagues' ||
      key.startsWith(`pitch:leagues/${competition.id}/`) ||
      (key.startsWith('sportscore:') &&
        !!competition.sportscoreSlug &&
        key.includes(`slug=${competition.sportscoreSlug}`)),
    () => setRefresh((n) => n + 1),
  );
  const [rows, setRows] = useState<CupTableRow[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [bracket, setBracket] = useState<BracketData | null>(null);
  const [bracketBusy, setBracketBusy] = useState(false);
  const [bracketError, setBracketError] = useState<string | null>(null);
  const viewScope = `cup.${competition.id}`;
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

  // Resolve the catalogue first; a single loader handles initial and later seasons.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const current = (await currentSeasonFor(competition.id)) ?? '';
        if (!current) throw new Error('Источник пока не предоставил сезоны турнира.');
        if (!active) return;
        setCurrentSeason(current);
        setSeason((previous) => previous || current);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось загрузить турнир.');
      } finally {
        if (active && !currentSeason) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [competition.id, storageKey, refresh]);

  // Season switch.
  useEffect(() => {
    if (!season || !currentSeason) return;
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    setBracket(null);
    setString(storageKey, season);
    void (async () => {
      try {
        const result = await fetchCupSeason(competition.id, season);
        if (!active) return;
        setSeasons(result.seasons);
        setData({
          matches: result.matches,
          fetchedAt: result.fetchedAt,
          stale: result.stale,
          season: result.season,
        });
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось загрузить турнир.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [season, currentSeason, competition.id, storageKey, refresh]);

  // Standings (SportScore, current season only).
  useEffect(() => {
    if (!competition.sportscoreSlug || tab !== 'table' || season !== currentSeason) return;
    let active = true;
    setTableError(null);
    setRows([]);
    fetchCupStandings(competition.sportscoreSlug!)
      .then((d) => {
        if (active) setRows(d.rows);
      })
      .catch((e) => {
        if (active) setTableError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [competition.sportscoreSlug, tab, season, currentSeason, refresh]);

  // Bracket.
  useEffect(() => {
    if (tab !== 'bracket' || !data || data.season !== season) return;
    let active = true;
    setBracketBusy(true);
    setBracketError(null);
    fetchBracketFor(data.matches, season, undefined, competition.bracketFormat)
      .then((d) => {
        if (active) setBracket(d);
      })
      .catch((e) => {
        if (active) setBracketError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setBracketBusy(false);
      });
    return () => {
      active = false;
    };
  }, [tab, data, season, competition.bracketFormat]);

  usePageScroll(`${viewScope}.${season}.${selectedMatch ? `match.${selectedMatch}` : tab}`);
  const previousContext = useRef(`${tab}.${season}`);
  useEffect(() => {
    const context = `${tab}.${season}`;
    if (previousContext.current !== context) setSelectedMatch(null);
    previousContext.current = context;
  }, [tab, season]);

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
  const chooseTab = (t: CupTab) => {
    setSelectedMatch(null);
    onTabChange(t);
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

  return (
    <div className="ucl-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{competition.eyebrow}</span>
          <h1>
            {competition.title}
            <span className="heading-dot">.</span>
          </h1>
        </div>
        <div className="ucl-season">
          <label htmlFor={`cup-season-${competition.id}`}>СЕЗОН</label>
          <select
            id={`cup-season-${competition.id}`}
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            {(seasons.length > 0 ? seasons : [season].filter(Boolean)).map((s) => (
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
          {broadcast && (
            <FeaturedMatchCover
              sport="ucl"
              match={selectFeaturedMatch(matches)}
              league={competition.title}
              season={season}
              loading={loading}
              onOpenMatch={openMatch}
              onSeeAllMatches={() => chooseTab('matches')}
            />
          )}
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

      {loading && <LoadingBlock label="Загружаем турнир…" rows={4} />}
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
                  message="Выберите другой сезон или посмотрите результаты."
                />
              )}
            </section>
            <section className="panel">
              <div className="section-title">
                <h2>Клубы турнира</h2>
                <span className="muted small">Нажмите на эмблему</span>
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
          </div>
        </>
      )}

      {tab === 'table' && (
        <section className="panel">
          {season && currentSeason && season !== currentSeason ? (
            <EmptyBlock
              title="Архивная таблица недоступна"
              message="Источник предоставляет таблицу только текущего сезона. Матчи выбранного сезона и сетка доступны в соседних разделах."
            />
          ) : !competition.sportscoreSlug ? (
            <EmptyBlock
              title="Таблица не предоставлена"
              message="Для этого турнира источник таблицы недоступен; матчи и сетка — в своих разделах."
            />
          ) : tableError ? (
            <ErrorBlock
              title="Таблица недоступна"
              message={tableError}
              onRetry={() => setRefresh((x) => x + 1)}
            />
          ) : rows.length ? (
            <CupTable rows={rows} onTeam={teamMatches} />
          ) : (
            <LoadingBlock label="Загрузка таблицы…" rows={8} />
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
                aria-label="Поиск матчей"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти команду"
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
          {bracketBusy && <LoadingBlock label="Собираем подтверждённые пары…" rows={3} />}
          {bracketError && (
            <ErrorBlock
              title="Не удалось загрузить сетку"
              message={bracketError}
              onRetry={() => setRefresh((x) => x + 1)}
            />
          )}
          {!bracketBusy && bracket && (
            <>
              <div className="knockout-scroll">
                <div
                  className="knockout-board"
                  style={{ gridTemplateColumns: `repeat(${rounds.length},minmax(220px,1fr))` }}
                >
                  {rounds.map((r, index) => (
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
                            <CupTieCard key={t.id} tie={t} onOpen={openMatch} />
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

      <div className="source-foot">
        Матчи: PitchAPI{competition.sportscoreSlug ? ' · Таблицы: Powered by SportScore' : ''}
        {data?.fetchedAt ? ` · ${formatDateTime(data.fetchedAt, getUserTimezone())}` : ''}
      </div>
    </div>
  );
}

function CupTable({ rows, onTeam }: { rows: CupTableRow[]; onTeam: (name: string) => void }) {
  return (
    <div className="ucl-table-scroll">
      <table className="ucl-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Команда</th>
            <th>И</th>
            <th>В</th>
            <th>Н</th>
            <th>П</th>
            <th>ЗМ</th>
            <th>ПМ</th>
            <th>РМ</th>
            <th>О</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug ?? r.position}>
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
              <td>{r.wins ?? '—'}</td>
              <td>{r.draws ?? '—'}</td>
              <td>{r.losses ?? '—'}</td>
              <td>{r.gf ?? '—'}</td>
              <td>{r.ga ?? '—'}</td>
              <td>{r.gd != null ? (r.gd > 0 ? `+${r.gd}` : r.gd) : '—'}</td>
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

function CupTieCard({ tie: t, onOpen }: { tie: BracketTie; onOpen: (id: string) => void }) {
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

export function CupsView({
  competitionId,
  tab,
  onTabChange,
}: {
  competitionId: string;
  tab: CupTab;
  onTabChange: (tab: CupTab) => void;
}) {
  const competition = CUP_COMPETITIONS.find((c) => c.id === competitionId) ?? CUP_COMPETITIONS[0]!;
  return <Inner competition={competition} tab={tab} onTabChange={onTabChange} />;
}

export default CupsView;
