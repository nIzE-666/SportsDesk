import { useCallback, useEffect, useState } from 'react';
import TeamBadge from '../../components/TeamBadge';
import { api } from '../../lib/bridge';
import { canonicalTeamName } from '../../lib/sportsIdentity';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../../components/StateViews';
import { SourceLine } from '../../components/SourceLine';
import type { SportScoreStandings, SportScoreStandingRow } from './types';
import type { TeamCatalogueEntry, UseFootballResult } from './useFootballData';

const SLUG_BY_LEAGUE: Record<string, string> = {
  l_4WFCIZ: 'english-premier-league',
  l_0ErfuF: 'spanish-la-liga',
  l_0eg6C9: 'major-league-soccer',
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
          <h1>Текущая таблица</h1>
          <p className="muted small">
            {standings?.competition ??
              data.leagues.find((l) => l.id === data.selectedLeagueId)?.name ??
              'Лига'}{' '}
            · текущий сезон
          </p>
        </div>
        <div className="dashboard-head-actions">
          <button className="ghost-btn" onClick={load} disabled={loading || !slug}>
            {loading ? 'Обновление…' : 'Обновить'}
          </button>
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
          <div className="standings-table" role="table">
            <div className="st-head" role="row">
              <span>#</span>
              <span>Команда</span>
              <span>И</span>
              <span>В</span>
              <span>Н</span>
              <span>П</span>
              <span>Г</span>
              <span>О</span>
            </div>
            {table.rows.map((row) => (
              <StandingsRow
                key={row.team_slug ?? row.pos}
                row={row}
                onOpenTeam={onOpenTeam}
                matchTeam={(name) => matchTeam(name, data)}
              />
            ))}
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
  const key = (value: string) => {
    const normalized = canonicalTeamName(value);
    return normalized === 'bournemouth afc' || normalized === 'afc bournemouth'
      ? 'bournemouth'
      : normalized;
  };
  const teams = data.leagueTeams.length ? data.leagueTeams : data.teams;
  const candidates = teams.filter((team) => key(team.name) === key(name));
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
    <div className="st-row" role="row" title={row.promo_name ?? ''}>
      <span className="st-pos">{row.pos}</span>
      <button
        className="st-team"
        onClick={() => teamId && onOpenTeam(teamId)}
        disabled={!teamId}
        title={teamId ? 'Открыть команду' : 'Клуб не сопоставлен с PitchAPI'}
      >
        <TeamBadge name={name} imageUrl={team?.image_url ?? row.team_logo} size={18} />
        <span>{name}</span>
      </button>
      <span>{row.p ?? '—'}</span>
      <span>{row.w ?? '—'}</span>
      <span>{row.d ?? '—'}</span>
      <span>{row.l ?? '—'}</span>
      <span>{row.gd != null ? (row.gd > 0 ? `+${row.gd}` : row.gd) : '—'}</span>
      <span>
        <strong>{row.pts ?? '—'}</strong>
      </span>
    </div>
  );
}
