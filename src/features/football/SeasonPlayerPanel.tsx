import { useEffect, useRef, useState } from 'react';
import { BarChart3, ChevronRight } from 'lucide-react';
import { fetchPlayerSeasonStats } from './playerAnalytics';
import type { PlayerSeasonStats } from './playerAnalytics';
import type { MatchSummary } from './types';
import { formatHumanDateTime } from '../../lib/humanDate';
import { getUserTimezone } from './storage';
import { statLabel } from './statLabels';

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
  return (
    <section className="panel season-player-panel">
      <div className="section-title">
        <h2>
          <BarChart3 size={16} /> Статистика по матчам команды
        </h2>
        <span className="muted tiny">{teamName}</span>
      </div>
      <p className="muted small">
        Суммы и средние показатели игрока по загруженным завершённым матчам этой команды. После
        подсчёта ниже появятся показатели и список встреч, из которых они сложились. Это не полная
        статистика карьеры.
      </p>
      {!stats && !busy && (
        <button className="primary-btn" disabled={!candidates.length} onClick={load}>
          Собрать статистику по матчам <ChevronRight size={14} />
        </button>
      )}
      {!candidates.length && (
        <p className="muted small">
          В загруженном расписании пока нет завершённых матчей этой команды.
        </p>
      )}
      {busy && (
        <div className="season-progress">
          <span>
            Анализируем матчи: {progress[0]} / {progress[1] || candidates.length}
          </span>
          <progress max={progress[1] || candidates.length || 1} value={progress[0]} />
        </div>
      )}
      {error && (
        <p role="alert" className="season-error">
          {error}{' '}
          <button className="text-link" onClick={load}>
            Повторить
          </button>
        </p>
      )}
      {stats && (
        <>
          <div className="season-coverage">
            <strong>{stats.available} матчей с данными игрока</strong>
            <span>
              Проверено {stats.scanned} из {stats.totalCandidates} · {stats.minutes} известных минут
              {stats.failed ? ` · ${stats.failed} ответов недоступно` : ''}
              {stats.stale ? ' · Сохранённые данные могут быть устаревшими' : ''}
            </span>
          </div>
          <div className="season-metrics">
            {stats.metrics.map((m) => (
              <div className="season-metric" key={m.key}>
                <span>{statLabel(m.key, m.label)}</span>
                <strong>
                  {m.value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                  {m.kind === 'fraction' ? '%' : ''}
                </strong>
                <small>Есть данные в {m.matches} матчах</small>
                {per90 &&
                  m.kind === 'total' &&
                  m.matches === stats.available &&
                  !['minutes', 'minutes_played', 'appearances'].includes(m.key) && (
                    <em>
                      {((m.value / stats.minutes) * 90).toLocaleString('ru-RU', {
                        maximumFractionDigits: 2,
                      })}{' '}
                      / 90 минут
                    </em>
                  )}
              </div>
            ))}
          </div>
          {!stats.metrics.length && (
            <p className="muted small">В этих матчах источник не вернул показатели игрока.</p>
          )}
          <h3 className="season-recent-title">Игры, из которых сложились цифры</h3>
          <div className="season-match-list">
            {stats.matches
              .slice()
              .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
              .map((m) => {
                const fixture = matches.find((f) => f.id === m.id);
                return (
                  <button key={m.id} onClick={() => onOpenMatch(m.id)}>
                    <span>
                      {formatHumanDateTime(fixture?.time_utc ?? m.date, getUserTimezone())}
                      <strong>
                        {fixture ? `${fixture.home_team.name} — ${fixture.away_team.name}` : 'Матч'}
                      </strong>
                    </span>
                    <span>{m.minutes ?? '—'} мин.</span>
                    <b>{m.rating?.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ?? '—'}</b>
                    <ChevronRight size={13} />
                  </button>
                );
              })}
          </div>
        </>
      )}
    </section>
  );
}
