import { useCallback, useEffect, useState } from 'react';
import TeamBadge from '../../components/TeamBadge';
import { api } from '../../lib/bridge';
import { LEAGUES } from '../../lib/navigationMetadata';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../../components/StateViews';
import { SourceLine } from '../../components/SourceLine';
import { Button } from '../../kit';
import { clubKey } from './clubNames';
import type { SportScoreStandings, SportScoreStandingRow } from './types';
import type { TeamCatalogueEntry, UseFootballResult } from './useFootballData';

const SLUG_BY_LEAGUE: Record<string, string> = {
  l_4WFCIZ: 'english-premier-league',
  l_0ErfuF: 'spanish-la-liga',
  l_0eg6C9: 'united-states-major-league-soccer',
  l_0ALvwF: 'italian-serie-a',
  l_1Isor4: 'bundesliga',
  l_3FJFUl: 'french-ligue-1',
};

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
        <section key={i} className="panel standings-panel">
          {table.group && <h3>{table.group}</h3>}
          <div className="ui-table-scroll">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Команда</th>
                  <th className="ui-table__num">И</th>
                  <th className="ui-table__num">В</th>
                  <th className="ui-table__num">Н</th>
                  <th className="ui-table__num">П</th>
                  <th className="ui-table__num">Г</th>
                  <th className="ui-table__num">О</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <StandingsRow
                    key={row.team_slug ?? row.pos}
                    row={row}
                    onOpenTeam={onOpenTeam}
                    matchTeam={(name) => matchTeam(name, data)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {standings && tables.length === 0 && (
        <EmptyBlock title="Пустая таблица" message="Источник вернул таблицу без строк." />
      )}

      <SourceLine sources={['sportscore']} fetchedAt={fetchedAt} stale={stale && !!standings} />
    </div>
  );
}

function matchTeam(name: string, data: UseFootballResult): TeamCatalogueEntry | undefined {
  const teams = data.leagueTeams.length ? data.leagueTeams : data.teams;
  const candidates = teams.filter((team) => clubKey(team.name) === clubKey(name));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function StandingsRow({
  row,
  matchTeam,
  onOpenTeam,
}: {
  row: SportScoreStandingRow;
  matchTeam: (name: string) => TeamCatalogueEntry | undefined;
  onOpenTeam: (id: string) => void;
}) {
  const team = matchTeam(row.team);
  const teamId = team?.id;
  const name = team?.name ?? row.team;
  return (
    <tr title={row.promo_name ?? ''}>
      <td>{row.pos}</td>
      <td>
        <Button
          variant="quiet"
          small
          className="st-team-open"
          onClick={() => teamId && onOpenTeam(teamId)}
          disabled={!teamId}
          title={teamId ? 'Открыть команду' : 'Для этого клуба нет страницы'}
        >
          <TeamBadge name={name} imageUrl={team?.image_url ?? row.team_logo} size={18} />
          <span>{name}</span>
        </Button>
      </td>
      <td className="ui-table__num">{row.p ?? '—'}</td>
      <td className="ui-table__num">{row.w ?? '—'}</td>
      <td className="ui-table__num">{row.d ?? '—'}</td>
      <td className="ui-table__num">{row.l ?? '—'}</td>
      <td className="ui-table__num">
        {row.gd != null ? (row.gd > 0 ? `+${row.gd}` : row.gd) : '—'}
      </td>
      <td className="ui-table__num">
        <strong>{row.pts ?? '—'}</strong>
      </td>
    </tr>
  );
}
