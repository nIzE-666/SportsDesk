import { useCallback, useEffect, useState } from 'react';
import TeamBadge from '../../components/TeamBadge';
import { api } from '../../lib/bridge';
import { LEAGUES } from '../../lib/navigationMetadata';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../../components/StateViews';
import { SourceLine } from '../../components/SourceLine';
import { Button, Panel } from '../../kit';
import { teamMatchesFavorite } from '../../lib/sportsIdentity';
import { clubKey } from './clubNames';
import { useFavorites } from './FavoritesProvider';
import type { SportScoreStandings, SportScoreStandingRow } from './types';
import type { TeamCatalogueEntry, UseFootballResult } from './useFootballData';
import './standingsTable.css';

const SLUG_BY_LEAGUE: Record<string, string> = {
  l_4WFCIZ: 'english-premier-league',
  l_0ErfuF: 'spanish-la-liga',
  l_0eg6C9: 'united-states-major-league-soccer',
  l_0ALvwF: 'italian-serie-a',
  l_1Isor4: 'bundesliga',
  l_3FJFUl: 'french-ligue-1',
};

/** One row of the shared table; unknown numbers stay `null` and become a dash. */
export interface StandingsTableRow {
  position: number;
  team: string;
  logo?: string | null;
  played?: number | null;
  wins?: number | null;
  draws?: number | null;
  losses?: number | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  goalDifference?: number | null;
  points?: number | null;
  /** A club page to open; the table itself does not know pages. */
  teamId?: string;
  /** Keeps the name visible but not clickable, with `teamNote` as the reason. */
  disabled?: boolean;
  teamNote?: string;
  /** Promotion or relegation note of the source, shown as the row tooltip. */
  promo?: string;
}

export type StandingsZoneTone = 'direct' | 'playoff' | 'qualification' | 'relegation';
export interface StandingsZone {
  from: number;
  to: number;
  tone: StandingsZoneTone;
}

function zoneOf(position: number, zones: readonly StandingsZone[]) {
  return zones.find((zone) => position >= zone.from && position <= zone.to);
}

/**
 * The one table of the app: a sticky header, badges, the favourite row and the
 * optional qualification and relegation zones. League, Champions League and
 * cup group tables all use it.
 */
export function StandingsTable({
  rows,
  zones = [],
  onTeam,
  ariaLabel,
}: {
  rows: readonly StandingsTableRow[];
  zones?: readonly StandingsZone[];
  onTeam?: (row: StandingsTableRow) => void;
  ariaLabel?: string;
}) {
  const { favoriteTeamNames } = useFavorites();
  return (
    <div className="ui-table-scroll">
      <table className="ui-table standings-table" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th className="ui-table__num">#</th>
            <th>Команда</th>
            <th className="ui-table__num">И</th>
            <th className="ui-table__num">В</th>
            <th className="ui-table__num">Н</th>
            <th className="ui-table__num">П</th>
            <th className="ui-table__num">ЗМ</th>
            <th className="ui-table__num">ПМ</th>
            <th className="ui-table__num">РМ</th>
            <th className="ui-table__num">О</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const zone = zoneOf(row.position, zones);
            const favorite = teamMatchesFavorite(row.team, favoriteTeamNames);
            return (
              <tr
                key={`${row.position}:${row.team}`}
                title={row.promo}
                className={[
                  zone ? `standings-table__row--${zone.tone}` : '',
                  favorite ? 'ui-table__favorite' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <td className="ui-table__num">
                  <span
                    className={[
                      'standings-table__position',
                      zone ? `standings-table__position--${zone.tone}` : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {row.position}
                  </span>
                </td>
                <td>
                  {onTeam ? (
                    <Button
                      variant="quiet"
                      small
                      className="ui-table__team st-team-open"
                      onClick={() => onTeam(row)}
                      disabled={row.disabled}
                      title={row.teamNote}
                    >
                      <TeamBadge name={row.team} imageUrl={row.logo ?? undefined} size={20} />
                      <span className="ui-table__team-name">{row.team}</span>
                    </Button>
                  ) : (
                    <span className="ui-table__team">
                      <TeamBadge name={row.team} imageUrl={row.logo ?? undefined} size={20} />
                      <span className="ui-table__team-name">{row.team}</span>
                    </span>
                  )}
                </td>
                <td className="ui-table__num">{row.played ?? '—'}</td>
                <td className="ui-table__num">{row.wins ?? '—'}</td>
                <td className="ui-table__num">{row.draws ?? '—'}</td>
                <td className="ui-table__num">{row.losses ?? '—'}</td>
                <td className="ui-table__num">{row.goalsFor ?? '—'}</td>
                <td className="ui-table__num">{row.goalsAgainst ?? '—'}</td>
                <td className="ui-table__num">
                  {row.goalDifference != null
                    ? row.goalDifference > 0
                      ? `+${row.goalDifference}`
                      : row.goalDifference
                    : '—'}
                </td>
                <td className="ui-table__num">
                  <strong>{row.points ?? '—'}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StandingsView({
  data,
  onOpenTeam,
}: {
  data: UseFootballResult;
  onOpenTeam: (id: string) => void;
}) {
  const slug = SLUG_BY_LEAGUE[data.selectedLeagueId];
  const [standings, setStandings] = useState<SportScoreStandings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    if (!slug) {
      setStandings(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const reply = await api(
        'sportscore',
        `standings/?sport=football&slug=${encodeURIComponent(slug)}`,
      );
      const payload = reply.payload as any;
      if (!payload || !Array.isArray(payload.tables)) {
        throw new Error('Источник не вернул таблицу для этой лиги');
      }
      setStandings(payload as SportScoreStandings);
      setFetchedAt(reply.fetchedAt ?? null);
      setStale(reply.stale);
    } catch (e) {
      setStandings(null);
      setError(e instanceof Error ? e.message : 'Ошибка загрузки таблицы');
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const tables = standings?.tables ?? [];

  return (
    <div className="standings-view">
      <div className="dashboard-head">
        <div>
          <h2 className="screen-title">Текущая таблица</h2>
          <p className="muted small">
            {LEAGUES.find((l) => l.id === data.selectedLeagueId)?.label ??
              standings?.competition ??
              data.leagues.find((l) => l.id === data.selectedLeagueId)?.name ??
              'Лига'}{' '}
            · текущий сезон
          </p>
        </div>
        <div className="dashboard-head-actions">
          <Button onClick={load} disabled={loading || !slug}>
            {loading ? 'Обновление…' : 'Обновить'}
          </Button>
        </div>
      </div>

      {!slug && (
        <EmptyBlock
          title="Таблица недоступна для этой лиги"
          message="Таблицы доступны для Premier League, Ла Лиги, Серии A, Бундеслиги, Лиги 1 и MLS."
        />
      )}

      {slug && loading && !standings && <LoadingBlock label="Загрузка таблицы…" rows={6} />}
      {slug && error && <ErrorBlock title="Таблица недоступна" message={error} onRetry={load} />}

      {tables.map((table, i) => (
        <Panel key={i} className="standings-panel">
          {table.group && <h2 className="ui-panel__title">{table.group}</h2>}
          <StandingsTable
            ariaLabel={table.group ?? 'Турнирная таблица'}
            rows={table.rows.map((row) => leagueRow(row, data))}
            onTeam={(row) => row.teamId && onOpenTeam(row.teamId)}
          />
        </Panel>
      ))}

      {standings && tables.length === 0 && (
        <EmptyBlock title="Пустая таблица" message="Источник вернул таблицу без строк." />
      )}

      <SourceLine sources={['sportscore']} fetchedAt={fetchedAt} stale={stale && !!standings} />
    </div>
  );
}

function leagueRow(row: SportScoreStandingRow, data: UseFootballResult): StandingsTableRow {
  const team = matchTeam(row.team, data);
  return {
    position: row.pos,
    team: team?.name ?? row.team,
    logo: team?.image_url ?? row.team_logo,
    played: row.p,
    wins: row.w,
    draws: row.d,
    losses: row.l,
    goalsFor: row.gf,
    goalsAgainst: row.ga,
    goalDifference: row.gd,
    points: row.pts,
    teamId: team?.id,
    disabled: !team?.id,
    teamNote: team?.id ? 'Открыть команду' : 'Для этого клуба нет страницы',
    promo: row.promo_name,
  };
}

function matchTeam(name: string, data: UseFootballResult): TeamCatalogueEntry | undefined {
  const teams = data.leagueTeams.length ? data.leagueTeams : data.teams;
  const candidates = teams.filter((team) => clubKey(team.name) === clubKey(name));
  return candidates.length === 1 ? candidates[0] : undefined;
}
