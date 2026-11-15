import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Star } from 'lucide-react';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import {
  Badge,
  Button,
  EmptyState,
  MatchRow,
  Panel,
  PanelHeader,
  SearchSelect,
  Skeleton,
  StatTile,
  Tabs,
  type MatchRowStatus,
} from '../../kit';
import TeamBadge from '../../components/TeamBadge';
import { SourceLine } from '../../components/SourceLine';
import { formatHumanDate } from '../../lib/humanDate';
import { migrateClubTab, type ClubTab } from '../../lib/navigation';
import { countRu, MATCHES, pluralRu } from '../../lib/plural';
import { useViewState } from '../../lib/useViewState';
import { viewState } from '../../lib/viewState';
import { spoilerKey, useResultHidden, useSpoilerSet } from '../spoilers/spoilerStore';
import { buildLeagueTable, clubSnapshot } from '../today/todayModel';
import { ClubPlayers } from './ClubPlayers';
import { fixtureCalendarTime, formatFixtureTime } from './calendar';
import { useFavorites } from './FavoritesProvider';
import {
  fetchHeadToHead,
  fetchHistorySeason,
  h2hSummary,
  pointsProgression,
  type HistoryMatch,
} from './history';
import { MatchList, matchDayKey } from './MatchList';
import { getUserTimezone, normalizeName } from './storage';
import type { MatchSummary } from './types';
import type { TeamCatalogueEntry, UseFootballResult } from './useFootballData';

interface TeamViewProps {
  teamId: string | null;
  data: UseFootballResult;
  onSelectTeam: (id: string) => void;
  onOpenMatch: (id: string) => void;
}

type FormResult = 'W' | 'D' | 'L';

interface TeamHistory {
  played: MatchSummary[];
  form: FormResult[];
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Finished matches with both scores known. */
  results: number;
}

const CLUB_TAB_LABELS: ReadonlyArray<[ClubTab, string]> = [
  ['overview', 'Обзор'],
  ['matches', 'Матчи'],
  ['squad', 'Состав'],
  ['h2h', 'Личные встречи'],
];

const COLLAPSED_MATCHES = 10;
const COLLAPSED_H2H = 6;

function outcomeForTeam(match: MatchSummary, teamId: string, teamName: string): FormResult | null {
  if (classifyMatchStatus(match.status) !== 'finished') return null;
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
  for (const m of matches) {
    if (!m || !involvesTeam(m, teamId, teamName)) continue;
    if (classifyMatchStatus(m.status) === 'finished') played.push(m);
  }
  played.sort(
    (a, b) =>
      new Date(b.time_utc ?? b.date ?? 0).getTime() - new Date(a.time_utc ?? a.date ?? 0).getTime(),
  );

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let results = 0;
  const form: FormResult[] = [];
  for (const m of played) {
    const outcome = outcomeForTeam(m, teamId, teamName);
    if (!outcome) continue;
    const isHome = m.home_team.id === teamId;
    const gf = (isHome ? m.score_home : m.score_away) ?? 0;
    const ga = (isHome ? m.score_away : m.score_home) ?? 0;
    goalsFor += gf;
    goalsAgainst += ga;
    results += 1;
    if (outcome === 'W') wins += 1;
    else if (outcome === 'L') losses += 1;
    else draws += 1;
    if (form.length < 10) form.push(outcome);
  }
  return { played, form, wins, draws, losses, goalsFor, goalsAgainst, results };
}

/** A finished season match in the shape used by the stored head-to-head history. */
function loadedMeeting(
  match: MatchSummary,
  leagueId: string,
  season: string | undefined,
  timezone: string,
): HistoryMatch | null {
  if (classifyMatchStatus(match.status, match.status_text) !== 'finished') return null;
  if (match.score_home == null || match.score_away == null) return null;
  const day = matchDayKey(fixtureCalendarTime(match), timezone);
  if (!day) return null;
  return {
    id: match.id,
    leagueId,
    season: season ?? '',
    homeId: match.home_team.id,
    homeName: match.home_team.name,
    awayId: match.away_team.id,
    awayName: match.away_team.name,
    homeScore: match.score_home,
    awayScore: match.score_away,
    status: 'finished',
    date: day,
    round: match.round_name ?? '',
  };
}

function sameTeamPair(first: HistoryMatch, second: HistoryMatch): boolean {
  const firstHome = first.homeId || normalizeName(first.homeName);
  const firstAway = first.awayId || normalizeName(first.awayName);
  const secondHome = second.homeId || normalizeName(second.homeName);
  const secondAway = second.awayId || normalizeName(second.awayName);
  return (
    (firstHome === secondHome && firstAway === secondAway) ||
    (firstHome === secondAway && firstAway === secondHome)
  );
}

function sameMeeting(first: HistoryMatch, second: HistoryMatch): boolean {
  if (first.id && second.id && first.id === second.id) return true;
  return first.date === second.date && sameTeamPair(first, second);
}

/**
 * The stored head-to-head plus the finished meetings of the loaded season.
 * A match with the same id, or else the same date and the same two teams,
 * appears once; newer matches come first.
 */
export function mergeHeadToHead(
  stored: readonly HistoryMatch[],
  loaded: readonly HistoryMatch[],
): HistoryMatch[] {
  const merged: HistoryMatch[] = [];
  for (const match of [...loaded, ...stored]) {
    if (!merged.some((known) => sameMeeting(known, match))) merged.push(match);
  }
  return merged.sort((first, second) => second.date.localeCompare(first.date));
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

function resultBadge(outcome: FormResult | null) {
  return outcome ? (
    <Badge variant={outcome === 'W' ? 'win' : outcome === 'D' ? 'draw' : 'loss'}>{outcome}</Badge>
  ) : undefined;
}

function FormStrip({ form }: { form: FormResult[] }) {
  return (
    <span className="wdl-strip">
      {form.map((result, index) => (
        <Badge key={index} variant={result === 'W' ? 'win' : result === 'D' ? 'draw' : 'loss'}>
          {result}
        </Badge>
      ))}
    </span>
  );
}

export function TeamView({ teamId, data, onSelectTeam, onOpenMatch }: TeamViewProps) {
  const timezone = getUserTimezone();
  const { isTeamFavorite, toggleTeam, seedFromCatalogue, teamIds } = useFavorites();
  useEffect(() => {
    seedFromCatalogue(data.teams);
  }, [data.teams, seedFromCatalogue]);

  const catalogueTeam: TeamCatalogueEntry | null = useMemo(
    () => data.teams.find((t) => t.id === teamId) ?? null,
    [data.teams, teamId],
  );

  if (!teamId) {
    return <ClubDirectory data={data} teamIds={teamIds} onSelectTeam={onSelectTeam} />;
  }

  if (!catalogueTeam) {
    return (
      <div className="team-view">
        <EmptyState
          title="Клуб не найден"
          message="Выберите другой клуб из каталога."
          action={
            <Button
              variant="quiet"
              onClick={() => {
                const first = data.teams[0];
                if (first) onSelectTeam(first.id);
              }}
              disabled={!data.teams.length}
            >
              Выбрать клуб
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <ClubPage
      team={catalogueTeam}
      data={data}
      timezone={timezone}
      favorite={isTeamFavorite(catalogueTeam.id)}
      onToggleFavorite={() => toggleTeam(catalogueTeam.id)}
      onSelectTeam={onSelectTeam}
      onOpenMatch={onOpenMatch}
    />
  );
}

function ClubDirectory({
  data,
  teamIds,
  onSelectTeam,
}: {
  data: UseFootballResult;
  teamIds: string[];
  onSelectTeam: (id: string) => void;
}) {
  const favoriteTeams = teamIds
    .map((id) => data.teams.find((team) => team.id === id))
    .filter((team): team is TeamCatalogueEntry => !!team);
  const loading = (data.matchesLoading || data.leaguesLoading) && !data.teams.length;
  const options = useMemo(
    () =>
      data.teams.map((team) => ({
        value: team.id,
        label: team.name,
        group: team.leagueName,
      })),
    [data.teams],
  );
  return (
    <div className="team-view">
      <div className="club-directory-head">
        <h2 className="ui-page-title">Клубы</h2>
      </div>

      {loading && (
        <div className="club-directory-loading" role="status" aria-label="Загрузка клубов">
          <Skeleton />
          <Skeleton />
        </div>
      )}

      {!loading && favoriteTeams.length > 0 && (
        <Panel className="team-favorites team-favorites-panel">
          <PanelHeader title="Мои команды" />
          <div className="team-favorites-list">
            {favoriteTeams.map((team) => (
              <Button key={team.id} small onClick={() => onSelectTeam(team.id)}>
                <TeamBadge name={team.name} imageUrl={team.image_url} size={24} /> {team.name}
              </Button>
            ))}
          </div>
        </Panel>
      )}

      {!loading && favoriteTeams.length === 0 && (
        <EmptyState
          title="Пока нет избранных клубов"
          message="Выберите клуб из каталога и добавьте его в избранное."
        />
      )}

      {!loading && options.length > 0 && (
        <Panel className="team-picker-panel">
          <PanelHeader title="Выбрать клуб" />
          <div className="team-picker">
            <SearchSelect
              ariaLabel="Клуб"
              value=""
              options={options}
              onChange={(id) => {
                if (id) onSelectTeam(id);
              }}
              placeholder="Найти клуб"
            />
          </div>
        </Panel>
      )}

      {!loading && options.length === 0 && (
        <EmptyState title="Каталог клубов пуст" message="Данные о клубах пока не загружены." />
      )}
    </div>
  );
}

function ClubPage({
  team,
  data,
  timezone,
  favorite,
  onToggleFavorite,
  onSelectTeam,
  onOpenMatch,
}: {
  team: TeamCatalogueEntry;
  data: UseFootballResult;
  timezone: string;
  favorite: boolean;
  onToggleFavorite: () => void;
  onSelectTeam: (id: string) => void;
  onOpenMatch: (id: string) => void;
}) {
  const [storedTab, setStoredTab] = useViewState<unknown>(
    `club.${team.id}.tab`,
    'overview',
    (value) => migrateClubTab(value) !== undefined,
  );
  const tab: ClubTab = migrateClubTab(storedTab) ?? 'overview';

  const seasonMatches = useMemo(() => data.matchesForLeague(team.leagueId), [data, team.leagueId]);
  const teamMatches = useMemo(
    () => seasonMatches.filter((match) => involvesTeam(match, team.id, team.name)),
    [seasonMatches, team.id, team.name],
  );
  const history = useMemo(
    () => computeHistory(teamMatches, team.id, team.name),
    [teamMatches, team.id, team.name],
  );
  const now = Date.now();
  const snapshot = useMemo(
    () => clubSnapshot(teamMatches, team.id, now),
    [teamMatches, team.id, now],
  );
  const position = useMemo(
    () => buildLeagueTable(seasonMatches).get(team.id)?.position ?? null,
    [seasonMatches, team.id],
  );
  const teamOptions = useMemo(
    () =>
      data.teams.map((entry) => ({
        value: entry.id,
        label: entry.name,
        group: entry.leagueName,
      })),
    [data.teams],
  );
  const tabs = CLUB_TAB_LABELS.map(([id, label]) => ({ id, label }));
  const panelId = 'club-tab-panel';
  const league = data.leagues.find((entry) => entry.id === team.leagueId);
  const season =
    team.leagueId === data.selectedLeagueId ? data.season : (league?.season ?? data.season);

  return (
    <div className="team-view">
      <Panel className="club-header">
        <div className="club-header__top">
          <TeamBadge name={team.name} imageUrl={team.image_url} size={56} />
          <div className="club-header__identity">
            <h2 className="ui-page-title">{team.name}</h2>
            <p className="muted small">
              {`${team.leagueName} · ${position ? `${position}-е место` : 'место —'}`}
            </p>
          </div>
          <div className="club-header__actions">
            <Button
              variant="quiet"
              aria-pressed={favorite}
              onClick={onToggleFavorite}
              title={favorite ? 'Убрать из избранного' : 'В избранное'}
            >
              <Star size={14} fill={favorite ? 'currentColor' : 'none'} />{' '}
              {favorite ? 'В избранном' : 'В избранное'}
            </Button>
            {teamOptions.length > 1 && (
              <div className="club-header__switch">
                <SearchSelect
                  ariaLabel="Сменить клуб"
                  value=""
                  options={teamOptions}
                  onChange={(id) => {
                    if (id) onSelectTeam(id);
                  }}
                  placeholder="Сменить клуб"
                />
              </div>
            )}
          </div>
        </div>
        <div className="club-header__snapshot">
          <ClubSnapshot
            label="Последний матч"
            match={snapshot.last}
            teamId={team.id}
            teamName={team.name}
            timezone={timezone}
            onOpenMatch={onOpenMatch}
          />
          <ClubSnapshot
            label="Следующий матч"
            match={snapshot.next}
            teamId={team.id}
            teamName={team.name}
            timezone={timezone}
            onOpenMatch={onOpenMatch}
          />
        </div>
      </Panel>

      <Tabs
        ariaLabel="Разделы клуба"
        active={tab}
        onChange={(id) => {
          const next = migrateClubTab(id);
          if (next) setStoredTab(next);
        }}
        items={tabs}
        panelId={panelId}
      />

      <div
        id={panelId}
        role="tabpanel"
        aria-label={CLUB_TAB_LABELS.find(([id]) => id === tab)?.[1]}
      >
        {tab === 'overview' && (
          <OverviewTab
            teamId={team.id}
            leagueId={team.leagueId}
            season={season}
            history={history}
            loading={data.matchesLoading && !teamMatches.length}
            error={data.matchesError}
            onRetry={data.reload}
          />
        )}
        {tab === 'matches' && (
          <MatchesTab
            team={team}
            matches={teamMatches}
            timezone={timezone}
            loading={data.matchesLoading && !teamMatches.length}
            error={data.matchesError}
            onRetry={data.reload}
            onOpenMatch={onOpenMatch}
          />
        )}
        {tab === 'squad' && (
          <ClubPlayers
            key={team.id}
            team={team}
            matches={teamMatches}
            onOpenMatch={onOpenMatch}
            heading="Состав"
            groupBy="position"
            visibleLimit={18}
          />
        )}
        {tab === 'h2h' && (
          <HeadToHeadTab
            team={team}
            teams={data.teams}
            matches={teamMatches}
            season={season}
            timezone={timezone}
          />
        )}
      </div>

      <SourceLine
        sources={['pitch']}
        fetchedAt={data.fetchedAt}
        stale={data.stale}
        timezone={timezone}
      />
    </div>
  );
}

function ClubSnapshot({
  label,
  match,
  teamId,
  teamName,
  timezone,
  onOpenMatch,
}: {
  label: string;
  match: MatchSummary | null;
  teamId: string;
  teamName: string;
  timezone: string;
  onOpenMatch: (id: string) => void;
}) {
  const hidden = useResultHidden('football', match?.id ?? '');
  if (!match) {
    return (
      <div className="club-snapshot">
        <span className="club-snapshot__label">{label}</span>
        <span className="muted small">—</span>
      </div>
    );
  }
  const state = classifyMatchStatus(match.status, match.status_text);
  const outcome = outcomeForTeam(match, teamId, teamName);
  return (
    <div className="club-snapshot">
      <span className="club-snapshot__label">{label}</span>
      <MatchRow
        size="compact"
        className="team-schedule-row club-match-row--wide"
        onClick={() => onOpenMatch(match.id)}
        ariaLabel={`Открыть матч: ${match.home_team.name} — ${match.away_team.name}`}
        home={{ name: match.home_team.name, imageUrl: match.home_team.image_url }}
        away={{ name: match.away_team.name, imageUrl: match.away_team.image_url }}
        time={formatFixtureTime(match, timezone)}
        status={rowStatus(match)}
        score={
          state === 'finished'
            ? { home: match.score_home ?? null, away: match.score_away ?? null }
            : null
        }
        hideScore={hidden}
        badge={hidden ? undefined : resultBadge(outcome)}
      />
    </div>
  );
}

function OverviewTab({
  teamId,
  leagueId,
  season,
  history,
  loading,
  error,
  onRetry,
}: {
  teamId: string;
  leagueId: string;
  season: string | undefined;
  history: TeamHistory;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const spoilers = useSpoilerSet();
  if (loading) {
    return (
      <div className="club-overview">
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  const hasTiles = history.form.length > 0 || history.results > 0 || history.played.length > 0;
  const formHidden = history.played
    .slice(0, 10)
    .some((match) => spoilers.has(spoilerKey('football', match.id)));
  return (
    <div className="club-overview">
      {error && (
        <EmptyState
          tone="error"
          title="Матчи недоступны"
          message={error}
          action={
            <Button variant="quiet" onClick={onRetry}>
              Повторить
            </Button>
          }
        />
      )}
      {hasTiles && (
        <div className="club-stat-grid">
          {history.form.length > 0 && !formHidden && (
            <StatTile
              className="club-form-tile"
              label="Форма"
              value={<FormStrip form={history.form} />}
            />
          )}
          {history.results > 0 && (
            <StatTile
              label="Баланс побед"
              value={`${history.wins}–${history.draws}–${history.losses}`}
              note="W–D–L по завершённым"
            />
          )}
          {history.results > 0 && (
            <StatTile
              label="Голы"
              value={`${history.goalsFor} : ${history.goalsAgainst}`}
              note="забито : пропущено"
            />
          )}
          {history.played.length > 0 && (
            <StatTile label="Матчи" value={history.played.length} note="завершено" />
          )}
        </div>
      )}

      {!hasTiles && !error && (
        <EmptyState
          title="Матчей пока нет"
          message="В загруженном сезоне нет завершённых матчей этого клуба."
        />
      )}

      <PointsPanel teamId={teamId} leagueId={leagueId} season={season} />
    </div>
  );
}

function PointsPanel({
  teamId,
  leagueId,
  season,
}: {
  teamId: string;
  leagueId: string;
  season: string | undefined;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    rows: HistoryMatch[] | null;
    error: string | null;
  } | null>(null);
  const key = `${leagueId}|${season ?? ''}|${attempt}`;

  useEffect(() => {
    if (!season) return;
    let active = true;
    setResult({ key, rows: null, error: null });
    void fetchHistorySeason(leagueId, season).then(
      (rows) => {
        if (active) setResult({ key, rows, error: null });
      },
      (error: unknown) => {
        if (active)
          setResult({
            key,
            rows: null,
            error: error instanceof Error ? error.message : 'История недоступна.',
          });
      },
    );
    return () => {
      active = false;
    };
  }, [leagueId, season, key]);

  const current = result?.key === key ? result : null;
  const progression = useMemo(
    () => (current?.rows ? pointsProgression(current.rows, teamId) : []),
    [current, teamId],
  );
  if (!season) return null;
  if (!current) {
    return (
      <Panel className="club-points">
        <PanelHeader title="Ход очков" />
        <div className="club-points__loading" role="status" aria-label="Загрузка хода очков">
          <Skeleton />
        </div>
      </Panel>
    );
  }
  if (current.error) {
    return (
      <Panel className="club-points">
        <PanelHeader title="Ход очков" />
        <EmptyState
          tone="error"
          title="Ход очков недоступен"
          message={current.error}
          action={
            <Button variant="quiet" onClick={() => setAttempt((value) => value + 1)}>
              Повторить
            </Button>
          }
        />
      </Panel>
    );
  }
  const last = progression.at(-1);
  if (progression.length < 1 || !last) return null;
  const max = last.points || 1;
  return (
    <Panel className="club-points">
      <PanelHeader title="Ход очков" />
      <div className="club-points__chart" role="img" aria-label="График накопленных очков">
        {progression.map((point, index) => (
          <i
            key={index}
            style={
              {
                '--bar-height': `${Math.max(4, (point.points / max) * 100)}%`,
              } as CSSProperties
            }
            title={`${point.round}: ${point.points} очк.`}
          />
        ))}
      </div>
      <span className="muted small">{`${countRu(last.points, ['очко', 'очка', 'очков'])} после ${progression.length} ${pluralRu(progression.length, ['матча', 'матчей', 'матчей'])}`}</span>
    </Panel>
  );
}

function MatchesTab({
  team,
  matches,
  timezone,
  loading,
  error,
  onRetry,
  onOpenMatch,
}: {
  team: TeamCatalogueEntry;
  matches: MatchSummary[];
  timezone: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenMatch: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (loading) {
    return (
      <div className="club-matches">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  return (
    <div className="club-matches">
      {error && (
        <EmptyState
          tone="error"
          title="Матчи недоступны"
          message={error}
          action={
            <Button variant="quiet" onClick={onRetry}>
              Повторить
            </Button>
          }
        />
      )}
      {matches.length > 0 ? (
        <>
          <MatchList
            items={matches}
            getKey={(match) => match.id}
            getTime={(match) => fixtureCalendarTime(match)}
            timezone={timezone}
            grouping="month"
            limit={expanded ? undefined : COLLAPSED_MATCHES}
            renderRow={(match) => (
              <ClubMatchRow
                match={match}
                team={team}
                timezone={timezone}
                onOpenMatch={onOpenMatch}
              />
            )}
          />
          {matches.length > COLLAPSED_MATCHES && (
            <div className="club-matches__more">
              <Button variant="quiet" onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Свернуть' : 'Показать все'}
              </Button>
            </div>
          )}
        </>
      ) : (
        !error && (
          <EmptyState title="Матчей нет" message="В загруженном сезоне нет матчей этого клуба." />
        )
      )}
    </div>
  );
}

function ClubMatchRow({
  match,
  team,
  timezone,
  onOpenMatch,
}: {
  match: MatchSummary;
  team: TeamCatalogueEntry;
  timezone: string;
  onOpenMatch: (id: string) => void;
}) {
  const hidden = useResultHidden('football', match.id);
  const state = classifyMatchStatus(match.status, match.status_text);
  const outcome = outcomeForTeam(match, team.id, team.name);
  const label = `${match.home_team.name} — ${match.away_team.name}`;
  const isHome = match.home_team.id === team.id;
  const outcomeBadge = hidden ? undefined : resultBadge(outcome);
  return (
    <MatchRow
      size="compact"
      className="team-schedule-row club-match-row--wide"
      home={{
        name: match.home_team.name,
        imageUrl: match.home_team.image_url,
        action: isHome ? outcomeBadge : undefined,
      }}
      away={{
        name: match.away_team.name,
        imageUrl: match.away_team.image_url,
        action: !isHome ? outcomeBadge : undefined,
      }}
      time={formatFixtureTime(match, timezone)}
      status={rowStatus(match)}
      score={
        state === 'finished'
          ? { home: match.score_home ?? null, away: match.score_away ?? null }
          : null
      }
      hideScore={hidden}
      actions={
        <Button
          variant="quiet"
          small
          onClick={() => {
            viewState.write(`match.${match.id}.tab`, 'stats');
            onOpenMatch(match.id);
          }}
          aria-label={`Разбор матча: ${label}`}
        >
          Разбор
        </Button>
      }
    />
  );
}

function HeadToHeadTab({
  team,
  teams,
  matches,
  season,
  timezone,
}: {
  team: TeamCatalogueEntry;
  teams: TeamCatalogueEntry[];
  matches: MatchSummary[];
  season: string | undefined;
  timezone: string;
}) {
  const [rivalId, setRivalId] = useViewState<string>(`club.${team.id}.rival`, '');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    teamId: string;
    rivalId: string;
    attempt: number;
    rows: HistoryMatch[] | null;
    error: string | null;
  } | null>(null);
  const rivals = useMemo(
    () =>
      teams
        .filter((entry) => entry.id !== team.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [teams, team.id],
  );
  const options = useMemo(
    () => rivals.map((entry) => ({ value: entry.id, label: entry.name, group: entry.leagueName })),
    [rivals],
  );

  useEffect(() => {
    if (!rivalId && rivals.length === 1) setRivalId(rivals[0]!.id);
  }, [rivalId, rivals, setRivalId]);
  useEffect(() => {
    if (rivalId && !rivals.some((entry) => entry.id === rivalId)) setRivalId('');
  }, [rivalId, rivals, setRivalId]);

  useEffect(() => {
    if (!rivalId) return;
    let active = true;
    const key = { teamId: team.id, rivalId, attempt };
    setResult({ ...key, rows: null, error: null });
    void fetchHeadToHead(team.id, rivalId).then(
      (rows) => {
        if (active) setResult({ ...key, rows, error: null });
      },
      (error: unknown) => {
        if (active)
          setResult({
            ...key,
            rows: null,
            error: error instanceof Error ? error.message : 'История недоступна.',
          });
      },
    );
    return () => {
      active = false;
    };
  }, [team.id, rivalId, attempt]);

  const current =
    result?.teamId === team.id && result.rivalId === rivalId && result.attempt === attempt
      ? result
      : null;
  const rival =
    rivals.find((entry) => entry.id === rivalId) ?? (rivals.length === 1 ? rivals[0]! : null);
  const loaded = useMemo(() => {
    if (!rival) return [];
    return matches
      .filter(
        (match) =>
          involvesTeam(match, team.id, team.name) && involvesTeam(match, rival.id, rival.name),
      )
      .map((match) => loadedMeeting(match, team.leagueId, season, timezone))
      .filter((match): match is HistoryMatch => match !== null);
  }, [matches, team, rival, season, timezone]);
  const merged = useMemo(() => mergeHeadToHead(current?.rows ?? [], loaded), [current, loaded]);
  const summary = useMemo(
    () => (rivalId ? h2hSummary(merged, team.id, rivalId) : null),
    [merged, rivalId, team.id],
  );
  const [expanded, setExpanded] = useState(false);

  if (!rivals.length) {
    return (
      <EmptyState title="Соперников нет" message="В загруженном каталоге нет других клубов." />
    );
  }

  return (
    <Panel className="club-h2h">
      <PanelHeader
        title="Личные встречи"
        action={
          merged.length > 0 && summary && summary.played > 0 ? (
            <span className="muted small">{countRu(summary.played, MATCHES)}</span>
          ) : undefined
        }
      />
      <div className="club-h2h__picker">
        {rivals.length === 1 ? (
          <span className="club-h2h__single">
            Соперник: <strong>{rival?.name}</strong>
          </span>
        ) : (
          <SearchSelect
            ariaLabel="Соперник"
            value={rivalId}
            options={options}
            onChange={setRivalId}
            placeholder="Выберите соперника"
          />
        )}
      </div>

      {!rivalId && <p className="muted small">Выберите соперника, чтобы увидеть личные встречи.</p>}

      {rivalId && !current && (
        <div className="club-h2h__loading" role="status" aria-label="Загрузка личных встреч">
          <Skeleton />
        </div>
      )}

      {current?.error && (
        <EmptyState
          tone="error"
          title="Личные встречи недоступны"
          message={current.error}
          action={
            <Button variant="quiet" onClick={() => setAttempt((value) => value + 1)}>
              Повторить
            </Button>
          }
        />
      )}

      {merged.length > 0 && summary ? (
        <>
          {summary.played > 0 && (
            <div className="club-stat-grid">
              <StatTile label="Матчи" value={summary.played} />
              <StatTile label="Победы" value={summary.aWins} note={team.name} />
              <StatTile label="Ничьи" value={summary.draws} />
              <StatTile label="Поражения" value={summary.bWins} note={rival?.name} />
              <StatTile
                label="Голы"
                value={`${summary.aGoals} : ${summary.bGoals}`}
                note="забито : пропущено"
              />
            </div>
          )}
          <div className="club-h2h__list">
            {(expanded ? merged : merged.slice(0, COLLAPSED_H2H)).map((match) => (
              <H2HRow key={match.id} match={match} team={team} rival={rival} timezone={timezone} />
            ))}
          </div>
          {merged.length > COLLAPSED_H2H && (
            <div className="club-matches__more">
              <Button variant="quiet" onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Свернуть' : 'Показать все'}
              </Button>
            </div>
          )}
        </>
      ) : (
        current?.rows &&
        !current.error && <p className="muted small">Личных матчей в истории пока нет.</p>
      )}
    </Panel>
  );
}

function H2HRow({
  match,
  team,
  rival,
  timezone,
}: {
  match: HistoryMatch;
  team: TeamCatalogueEntry;
  rival: TeamCatalogueEntry | null;
  timezone: string;
}) {
  const hidden = useResultHidden('football', match.id);
  const known = match.homeScore >= 0 && match.awayScore >= 0;
  const isHome = match.homeId === team.id;
  const own = isHome ? match.homeScore : match.awayScore;
  const opp = isHome ? match.awayScore : match.homeScore;
  const outcome: FormResult | null = known ? (own > opp ? 'W' : own < opp ? 'L' : 'D') : null;
  const outcomeBadge = hidden ? undefined : resultBadge(outcome);
  return (
    <MatchRow
      size="compact"
      home={{ name: match.homeName, action: isHome ? outcomeBadge : undefined }}
      away={{ name: match.awayName, action: !isHome ? outcomeBadge : undefined }}
      time={formatHumanDate(match.date, timezone)}
      status="finished"
      score={known ? { home: match.homeScore, away: match.awayScore } : { home: null, away: null }}
      hideScore={hidden}
      ariaLabel={`${team.name} — ${rival?.name ?? match.awayName}: ${match.date}`}
    />
  );
}
