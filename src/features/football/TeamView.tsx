import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  MapPin,
  Star,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { ClubPlayers } from './ClubPlayers';
import TeamBadge from '../../components/TeamBadge';
import { LoadingBlock, EmptyBlock } from '../../components/StateViews';
import type { MatchSummary } from './types';
import { formatDate, formatDateTime, getUserTimezone, normalizeName } from './storage';
import type { TeamCatalogueEntry, UseFootballResult } from './useFootballData';
import { useFavorites } from './FavoritesProvider';
import {
  fetchHeadToHead,
  fetchTeamHistory,
  h2hSummary,
  pointsProgression,
  teamForm,
  type HistoryMatch,
} from './history';

interface TeamViewProps {
  teamId: string | null;
  data: UseFootballResult;
  onSelectTeam: (id: string) => void;
  onOpenMatch: (id: string) => void;
}

type FormResult = 'W' | 'D' | 'L';

interface TeamHistory {
  played: MatchSummary[];
  upcoming: MatchSummary[];
  form: FormResult[];
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

function outcomeForTeam(match: MatchSummary, teamId: string, teamName: string): FormResult | null {
  if (match.status !== 'finished') return null;
  if (match.score_home == null || match.score_away == null) return null;
  const isHome =
    match.home_team.id === teamId ||
    (!teamId && normalizeName(match.home_team.name) === normalizeName(teamName));
  const isAway =
    match.away_team.id === teamId ||
    (!teamId && normalizeName(match.away_team.name) === normalizeName(teamName));
  if (!isHome && !isAway) return null;
  const own = isHome ? match.score_home : match.score_away;
  const opp = isHome ? match.score_away : match.score_home;
  if (own > opp) return 'W';
  if (own < opp) return 'L';
  return 'D';
}

function involvesTeam(match: MatchSummary, teamId: string, teamName: string): boolean {
  if (match.home_team.id === teamId || match.away_team.id === teamId) return true;
  const n = normalizeName(teamName);
  return normalizeName(match.home_team.name) === n || normalizeName(match.away_team.name) === n;
}

function computeHistory(matches: MatchSummary[], teamId: string, teamName: string): TeamHistory {
  const played: MatchSummary[] = [];
  const upcoming: MatchSummary[] = [];
  const now = Date.now();
  for (const m of matches) {
    if (!m || !involvesTeam(m, teamId, teamName)) continue;
    const t = m.time_utc
      ? new Date(m.time_utc).getTime()
      : m.date
        ? new Date(m.date).getTime()
        : NaN;
    if (m.status === 'finished') played.push(m);
    else if (Number.isNaN(t) || t >= now - 1000 * 60 * 180) upcoming.push(m);
  }
  played.sort(
    (a, b) =>
      new Date(b.time_utc ?? b.date ?? 0).getTime() - new Date(a.time_utc ?? a.date ?? 0).getTime(),
  );
  upcoming.sort(
    (a, b) =>
      new Date(a.time_utc ?? a.date ?? 0).getTime() - new Date(b.time_utc ?? b.date ?? 0).getTime(),
  );

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  const form: FormResult[] = [];
  for (const m of played) {
    const outcome = outcomeForTeam(m, teamId, teamName);
    if (!outcome) continue;
    const isHome = m.home_team.id === teamId;
    const gf = (isHome ? m.score_home : m.score_away) ?? 0;
    const ga = (isHome ? m.score_away : m.score_home) ?? 0;
    goalsFor += gf;
    goalsAgainst += ga;
    if (outcome === 'W') wins += 1;
    else if (outcome === 'L') losses += 1;
    else draws += 1;
    if (form.length < 5) form.push(outcome);
  }
  return { played, upcoming, form, wins, draws, losses, goalsFor, goalsAgainst };
}

function pickLatestPlayed(
  allMatches: MatchSummary[],
  teamId: string,
  teamName: string,
): MatchSummary | null {
  let best: MatchSummary | null = null;
  let bestTime = -Infinity;
  for (const m of allMatches) {
    if (m.status !== 'finished') continue;
    if (!involvesTeam(m, teamId, teamName)) continue;
    const t = new Date(m.time_utc ?? m.date ?? 0).getTime();
    if (Number.isFinite(t) && t > bestTime) {
      bestTime = t;
      best = m;
    }
  }
  return best;
}

export function TeamView({ teamId, data, onSelectTeam, onOpenMatch }: TeamViewProps) {
  const timezone = getUserTimezone();
  const { isTeamFavorite, toggleTeam, seedFromCatalogue } = useFavorites();
  useEffect(() => {
    seedFromCatalogue(data.teams);
  }, [data.teams, seedFromCatalogue]);

  const catalogueTeam: TeamCatalogueEntry | null = useMemo(
    () => data.teams.find((t) => t.id === teamId) ?? null,
    [data.teams, teamId],
  );

  const teamName = catalogueTeam?.name ?? '';
  const teamImage = catalogueTeam?.image_url ?? null;

  const history: TeamHistory = useMemo(() => {
    if (!teamId)
      return {
        played: [],
        upcoming: [],
        form: [],
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      };
    return computeHistory(data.allMatches, teamId, teamName);
  }, [data.allMatches, teamId, teamName]);

  const latestPlayed = useMemo(
    () => (teamId ? pickLatestPlayed(data.allMatches, teamId, teamName) : null),
    [data.allMatches, teamId, teamName],
  );

  // Team picker options: grouped by league.
  const groupedTeams = useMemo(() => {
    const map = new Map<string, TeamCatalogueEntry[]>();
    for (const t of data.teams) {
      const list = map.get(t.leagueName) ?? [];
      list.push(t);
      map.set(t.leagueName, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [data.teams]);

  const favorite = teamId ? isTeamFavorite(teamId) : false;
  const playedCount = history.played.length;
  const record = `${history.wins}–${history.draws}–${history.losses}`;

  const renderMatchRow = (match: MatchSummary, kind: 'played' | 'upcoming') => {
    const isHome = match.home_team.id === teamId;
    const scoreHome = match.score_home;
    const scoreAway = match.score_away;
    const outcome = outcomeForTeam(match, teamId ?? '', teamName);
    return (
      <li key={match.id + kind}>
        <button className="team-match-row" onClick={() => onOpenMatch(match.id)}>
          <span className="team-match-date muted small">
            {match.status === 'finished'
              ? formatDate(match.time_utc ?? match.date, timezone)
              : formatDateTime(match.time_utc, timezone)}
          </span>
          <span className="team-match-op muted small">{isHome ? 'Д' : 'Г'}</span>
          <span className="team-match-teams">
            <span className="truncate">
              <TeamBadge
                name={match.home_team.name}
                imageUrl={match.home_team.image_url}
                size={18}
              />{' '}
              {match.home_team.name}
            </span>
            <span className="muted">—</span>
            <span className="truncate right">
              {match.away_team.name}{' '}
              <TeamBadge
                name={match.away_team.name}
                imageUrl={match.away_team.image_url}
                size={18}
              />
            </span>
          </span>
          <span className="team-match-score">
            {match.status === 'finished' ? `${scoreHome ?? '—'} : ${scoreAway ?? '—'}` : '— : —'}
          </span>
          <span className="team-match-status">
            {outcome ? (
              <span className={`wdl wdl-${outcome.toLowerCase()}`}>{outcome}</span>
            ) : (
              <span className="chip">Запланирован</span>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="team-view">
      <div className="md-topbar">
        <div className="muted small">
          <Users size={14} /> Клуб
        </div>
      </div>

      <div className="panel team-header">
        <TeamBadge name={teamName || 'Клуб'} imageUrl={teamImage} size={56} />
        <div className="team-header-body">
          <h1>{catalogueTeam?.name ?? 'Клуб не выбран'}</h1>
          {catalogueTeam && (
            <p className="muted small">
              {catalogueTeam.leagueName}
              {data.fetchedAt
                ? ` · обновлено ${new Date(data.fetchedAt).toLocaleString('ru-RU')}`
                : ''}
            </p>
          )}
          <div className="team-header-actions">
            {teamId && (
              <button
                className={favorite ? 'ghost-btn active' : 'ghost-btn'}
                onClick={() => toggleTeam(teamId)}
                title={favorite ? 'Убрать из избранного' : 'В избранное'}
              >
                <Star size={14} /> {favorite ? 'В избранном' : 'В избранное'}
              </button>
            )}
            {teamId && latestPlayed && (
              <button className="ghost-btn" onClick={() => onOpenMatch(latestPlayed.id)}>
                Последний матч <ArrowRight size={14} />
              </button>
            )}
          </div>
          <div className="team-picker">
            <label htmlFor="team-picker-select" className="muted small">
              Выбрать клуб из каталога
            </label>
            <select
              id="team-picker-select"
              value={teamId ?? ''}
              onChange={(e) => {
                if (e.target.value) onSelectTeam(e.target.value);
              }}
            >
              <option value="">— выберите клуб —</option>
              {groupedTeams.map(([league, list]) => (
                <optgroup key={league} label={league}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!teamId && (
        <EmptyBlock
          title="Клуб не выбран"
          message="Выберите клуб из списка выше. Каталог собран из реальных расписаний Premier League, LaLiga и MLS."
        />
      )}

      {teamId && !catalogueTeam && (
        <EmptyBlock
          title="Клуб не сопоставлен"
          message="Этот клуб не найден в загруженных расписаниях. Выберите другой клуб."
        />
      )}

      {teamId && catalogueTeam && (
        <>
          <section className="panel team-record">
            <div className="team-record-grid">
              <div className="team-record-cell">
                <span className="muted small">Форма (5 последних)</span>
                <div className="wdl-strip">
                  {history.form.length === 0 && (
                    <span className="muted small">Нет завершённых матчей</span>
                  )}
                  {history.form.map((r, i) => (
                    <span
                      key={i}
                      className={`wdl wdl-${r.toLowerCase()}`}
                      title={r === 'W' ? 'Победа' : r === 'D' ? 'Ничья' : 'Поражение'}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
              <div className="team-record-cell">
                <span className="muted small">Баланс побед</span>
                <strong className="team-record-big">
                  {teamId && playedCount > 0 ? record : '—'}
                </strong>
                <span className="muted tiny">В–Н–П по завершённым</span>
              </div>
              <div className="team-record-cell">
                <span className="muted small">Голы</span>
                <strong className="team-record-big">
                  {teamId && playedCount > 0
                    ? `${history.goalsFor} : ${history.goalsAgainst}`
                    : '—'}
                </strong>
                <span className="muted tiny">забито : пропущено</span>
              </div>
              <div className="team-record-cell">
                <span className="muted small">Матчи</span>
                <strong className="team-record-big">{playedCount}</strong>
                <span className="muted tiny">завершено в загруженных лигах</span>
              </div>
            </div>
          </section>

          {teamId && (
            <SeasonAnalytics teamId={teamId} teamName={catalogueTeam.name} teams={data.teams} />
          )}

          <div className="team-cols">
            <section className="panel team-schedule">
              <div className="section-title">
                <h2>
                  <CalendarDays size={14} /> Расписание
                </h2>
                <span className="muted small">{history.upcoming.length} предстоящих</span>
              </div>
              {history.upcoming.length === 0 ? (
                <p className="muted small">
                  В загруженных расписаниях нет будущих матчей этой команды.
                </p>
              ) : (
                <ul className="team-match-list">
                  {history.upcoming.map((m) => renderMatchRow(m, 'upcoming'))}
                </ul>
              )}
            </section>

            <section className="panel team-schedule">
              <div className="section-title">
                <h2>
                  <Target size={14} /> История
                </h2>
                <span className="muted small">{history.played.length} завершённых</span>
              </div>
              {history.played.length === 0 ? (
                <p className="muted small">
                  Завершённых матчей этой команды в загруженных лигах не найдено.
                </p>
              ) : (
                <ul className="team-match-list">
                  {history.played.slice(0, 30).map((m) => renderMatchRow(m, 'played'))}
                </ul>
              )}
            </section>
          </div>

          {catalogueTeam && (
            <ClubPlayers
              key={teamId}
              team={catalogueTeam}
              matches={data.allMatches}
              onOpenMatch={onOpenMatch}
            />
          )}

          <div className="source-foot muted small">
            <MapPin size={12} /> Расписание и составы: PitchAPI. Форма и счёт основаны только на
            завершённых матчах из загруженных лиг.
          </div>
        </>
      )}

      {!teamId && (
        <div className="source-foot muted small">
          <AlertTriangle size={12} /> Выберите клуб, чтобы увидеть расписание, форму и состав по
          последнему матчу.
        </div>
      )}
    </div>
  );
}

/**
 * №5: локальная аналитика из истории SQLite — ход очков сезона (график),
 * полная форма и head-to-head с любым соперником из каталога.
 */
function SeasonAnalytics({
  teamId,
  teamName,
  teams,
}: {
  teamId: string;
  teamName: string;
  teams: TeamCatalogueEntry[];
}) {
  const [matches, setMatches] = useState<HistoryMatch[] | null>(null);
  const [rivalId, setRivalId] = useState<string>('');
  const [h2h, setH2h] = useState<HistoryMatch[] | null>(null);

  useEffect(() => {
    let active = true;
    setMatches(null);
    setH2h(null);
    fetchTeamHistory(teamId, true).then((m) => {
      if (active) setMatches(m);
    });
    return () => {
      active = false;
    };
  }, [teamId]);

  useEffect(() => {
    if (!rivalId) {
      setH2h(null);
      return;
    }
    let active = true;
    setH2h(null);
    fetchHeadToHead(teamId, rivalId).then((m) => {
      if (active) setH2h(m);
    });
    return () => {
      active = false;
    };
  }, [teamId, rivalId]);

  const form = useMemo(() => (matches ? teamForm(matches, teamId) : []), [matches, teamId]);
  const progression = useMemo(
    () => (matches ? pointsProgression(matches, teamId) : []),
    [matches, teamId],
  );
  const summary = useMemo(
    () => (h2h && rivalId ? h2hSummary(h2h, teamId, rivalId) : null),
    [h2h, teamId, rivalId],
  );
  const rivals = teams.filter((t) => t.id !== teamId);

  if (matches !== null && matches.length === 0) return null; // история ещё не накоплена

  return (
    <section className="panel season-analytics">
      <div className="section-title">
        <h2>
          <TrendingUp size={15} /> Сезонная аналитика (из локальной истории)
        </h2>
        <span className="muted small">
          {matches ? `${matches.length} матчей в базе` : 'загружаем…'}
        </span>
      </div>

      {matches === null && <LoadingBlock label="Читаем локальную историю сезона…" rows={2} />}

      {matches !== null && (
        <>
          <div className="sa-row">
            <div className="sa-form">
              <span className="muted small">Форма (новые слева)</span>
              <div className="wdl-strip">
                {form
                  .slice(0, 10)
                  .reverse()
                  .map((r, i) => (
                    <span key={i} className={`wdl wdl-${r.toLowerCase()}`}>
                      {r}
                    </span>
                  ))}
                {form.length === 0 && <span className="muted small">Нет завершённых матчей</span>}
              </div>
            </div>

            <div className="sa-h2h">
              <span className="muted small">Head-to-head</span>
              <select
                value={rivalId}
                onChange={(e) => setRivalId(e.target.value)}
                aria-label="Соперник для head-to-head"
              >
                <option value="">Выберите соперника</option>
                {rivals.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {summary && (
                <div className="sa-h2h-summary">
                  <span>
                    <b>{summary.aWins}</b> — <b>{summary.draws}</b> — <b>{summary.bWins}</b>
                  </span>
                  <span className="muted small">
                    {summary.played} матчей · голы {summary.aGoals}:{summary.bGoals}
                  </span>
                </div>
              )}
              {h2h !== null && h2h.length === 0 && rivalId && (
                <span className="muted small">Личных матчей в истории пока нет.</span>
              )}
            </div>
          </div>

          {h2h && h2h.length > 0 && (
            <ul className="team-match-list sa-h2h-list">
              {h2h.slice(0, 8).map((m) => (
                <li key={m.id} className="team-match-row-static">
                  <span className="muted small">{m.date}</span>
                  <span className="truncate">
                    {m.homeName} — {m.awayName}
                  </span>
                  <b className="team-match-score-static">
                    {m.homeScore} : {m.awayScore}
                  </b>
                  <span className="muted small">{m.season}</span>
                </li>
              ))}
            </ul>
          )}

          {progression.length > 1 && (
            <div className="sa-chart">
              <span className="muted small">Ход очков в сезоне</span>
              <div className="sa-sparkline" role="img" aria-label="График накопленных очков">
                {(() => {
                  const max = progression[progression.length - 1]!.points || 1;
                  return progression.map((p, i) => (
                    <i
                      key={i}
                      style={{ height: `${Math.max(4, (p.points / max) * 100)}%` }}
                      title={`${p.round}: ${p.points} очк.`}
                    />
                  ));
                })()}
              </div>
              <span className="muted small">
                {progression[progression.length - 1]!.points} очков после {progression.length}{' '}
                матчей
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
