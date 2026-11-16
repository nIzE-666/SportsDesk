import { useEffect, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Button, EmptyState, Panel, PanelHeader, StatTile } from '../../kit';
import { fetchPlayerSeasonStats } from './playerAnalytics';
import type { PlayerSeasonStats } from './playerAnalytics';
import type { MatchSummary } from './types';
import { formatHumanDateTime } from '../../lib/humanDate';
import { MATCHES, pluralRu } from '../../lib/plural';
import { getUserTimezone } from './storage';
import { statLabel } from './statLabels';
import './playerForm.css';

/** Prepositional case for «есть данные в …». */
const MATCHES_IN = ['матче', 'матчах', 'матчах'] as const;

export function SeasonPlayerPanel({
  playerId,
  teamId,
  teamName,
  matches,
  onOpenMatch,
}: {
  playerId: string;
  teamId: string;
  teamName: string;
  matches: MatchSummary[];
  onOpenMatch: (id: string) => void;
}) {
  const [stats, setStats] = useState<PlayerSeasonStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setStats(null);
    setError(null);
    setBusy(false);
    return () => {
      revision.current++;
    };
  }, [playerId, teamId, matches]);
  const candidates = matches.filter(
    (m) => m.status === 'finished' && (m.home_team.id === teamId || m.away_team.id === teamId),
  );
  const load = async () => {
    const id = ++revision.current;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchPlayerSeasonStats(playerId, teamId, matches, (done, total) => {
        if (revision.current === id) setProgress([done, total]);
      });
      if (revision.current === id) setStats(result);
    } catch (e) {
      if (revision.current === id) setError(e instanceof Error ? e.message : 'Данные недоступны.');
    } finally {
      if (revision.current === id) setBusy(false);
    }
  };
  const per90 = stats && stats.minutes > 0 && stats.matches.every((m) => m.minutes !== null);
  const tz = getUserTimezone();
  return (
    <Panel className="player-season" aria-label="Статистика по матчам команды">
      <PanelHeader
        title={
          <span className="player-season__title">
            <BarChart3 size={16} aria-hidden="true" /> Статистика по матчам команды
          </span>
        }
        action={<span className="player-season__team">{teamName}</span>}
      />
      <p className="players-note">Суммы и средние по завершённым матчам этой команды.</p>
      {!stats && !busy && (
        <Button variant="primary" onClick={load} disabled={!candidates.length}>
          Собрать статистику по матчам
        </Button>
      )}
      {!candidates.length && (
        <p className="players-note">В расписании нет завершённых матчей этой команды.</p>
      )}
      {busy && (
        <div className="player-season__progress" role="status">
          <span>
            Анализируем матчи: {progress[0]} / {progress[1] || candidates.length}
          </span>
          <progress max={progress[1] || candidates.length || 1} value={progress[0]} />
        </div>
      )}
      {error && (
        <EmptyState
          tone="error"
          title="Статистика недоступна"
          message={error}
          action={
            <Button variant="quiet" onClick={load}>
              Повторить
            </Button>
          }
        />
      )}
      {stats && (
        <>
          <div className="player-season__coverage">
            <strong>
              {stats.available} {pluralRu(stats.available, MATCHES)} с данными игрока
            </strong>
            <span>
              Проверено {stats.scanned} из {stats.totalCandidates} · {stats.minutes} известных минут
              {stats.failed ? ` · не загрузились: ${stats.failed}` : ''}
              {stats.stale ? ' · данные могут быть устаревшими' : ''}
            </span>
          </div>
          <div className="player-season__metrics">
            {stats.metrics.map((m) => (
              <StatTile
                key={m.key}
                label={statLabel(m.key, m.label)}
                value={`${m.value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}${
                  m.kind === 'fraction' ? '%' : ''
                }`}
                note={
                  <>
                    <span>
                      Есть данные в {m.matches} {pluralRu(m.matches, MATCHES_IN)}
                    </span>
                    {per90 &&
                      m.kind === 'total' &&
                      m.matches === stats.available &&
                      !['minutes', 'minutes_played', 'appearances'].includes(m.key) && (
                        <span>
                          {' · '}
                          {`${((m.value / stats.minutes) * 90).toLocaleString('ru-RU', {
                            maximumFractionDigits: 2,
                          })}\u00A0/\u00A090\u00A0минут`}
                        </span>
                      )}
                  </>
                }
              />
            ))}
          </div>
          {!stats.metrics.length && (
            <p className="players-note">В этих матчах показателей игрока нет.</p>
          )}
          <h3 className="player-season__subtitle">Матчи в подсчёте</h3>
          <div className="ui-table-scroll player-season__table">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Матч · новые сверху</th>
                  <th className="ui-table__num">Минуты</th>
                  <th className="ui-table__num">Рейтинг</th>
                </tr>
              </thead>
              <tbody>
                {stats.matches
                  .slice()
                  .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
                  .map((m) => {
                    const fixture = matches.find((f) => f.id === m.id);
                    return (
                      <tr key={m.id}>
                        <td>
                          <Button
                            variant="quiet"
                            className="player-season__match"
                            onClick={() => onOpenMatch(m.id)}
                          >
                            <small>{formatHumanDateTime(fixture?.time_utc ?? m.date, tz)}</small>
                            <span>
                              {fixture
                                ? `${fixture.home_team.name} — ${fixture.away_team.name}`
                                : 'Матч'}
                            </span>
                          </Button>
                        </td>
                        <td className="ui-table__num">{m.minutes ?? '—'} мин.</td>
                        <td className="ui-table__num">
                          {m.rating?.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
