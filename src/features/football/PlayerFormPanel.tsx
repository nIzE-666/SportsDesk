import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronRight, RefreshCw } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useViewState } from '../../lib/useViewState';
import { Button, EmptyState, Panel, PanelHeader, SegmentedControl, StatTile } from '../../kit';
import {
  fetchPlayerForm,
  selectPlayerFormFixtures,
  selectPlayerFormWindow,
  type PlayerForm,
  type PlayerFormMetricKey,
  type PlayerFormWindow,
} from './playerForm';
import { formatHumanDate } from '../../lib/humanDate';
import { formatDate, getUserTimezone } from './storage';
import type { MatchSummary } from './types';
import './playerForm.css';

const METRICS: { key: PlayerFormMetricKey; label: string; unit: string }[] = [
  { key: 'rating', label: 'Рейтинг', unit: '' },
  { key: 'minutes', label: 'Минуты', unit: ' мин.' },
  { key: 'goals', label: 'Голы', unit: '' },
  { key: 'assists', label: 'Голевые передачи', unit: '' },
];
const number = (n: number | null | undefined, decimals = 2) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: decimals });

export function PlayerFormPanel({
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
  onOpenMatch?: (id: string) => void;
}) {
  const [windowSize, setWindowSize] = useViewState<PlayerFormWindow>(
    `player-form.${playerId}.${teamId}.window`,
    5,
    (v) => v === 5 || v === 10,
  );
  const [metric, setMetric] = useViewState<PlayerFormMetricKey>(
    `player-form.${playerId}.${teamId}.metric`,
    'rating',
    (v) => METRICS.some((m) => m.key === v),
  );
  const candidates = useMemo(() => selectPlayerFormFixtures(teamId, matches), [teamId, matches]);
  const identity = `${playerId}:${teamId}:${candidates.map((m) => `${m.id}:${m.time_utc ?? m.date}`).join('|')}`;
  const [loaded, setLoaded] = useState<{ key: string; value: PlayerForm } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState([0, 0]);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setLoaded(null);
    setError(null);
    setBusy(false);
    return () => {
      revision.current++;
    };
  }, [identity]);
  const load = async () => {
    const id = ++revision.current;
    setBusy(true);
    setError(null);
    setProgress([0, Math.min(60, candidates.length)]);
    try {
      const value = await fetchPlayerForm(playerId, teamId, matches, windowSize, (done, total) => {
        if (revision.current === id) setProgress([done, total]);
      });
      if (revision.current === id) setLoaded({ key: identity, value });
    } catch (e) {
      if (revision.current === id)
        setError(e instanceof Error ? e.message : 'Не удалось собрать форму игрока.');
    } finally {
      if (revision.current === id) setBusy(false);
    }
  };
  const data = loaded?.key === identity ? selectPlayerFormWindow(loaded.value, windowSize) : null;
  const chosenMetric = METRICS.find((m) => m.key === metric)!;
  const graph = data?.rows.map((row, i) => ({ ...row, index: i + 1, value: row[metric] })) ?? [];
  const average = data?.baseline.metrics[metric].mean ?? null;
  const tz = getUserTimezone();
  return (
    <Panel className="player-form" aria-label="Форма игрока">
      <PanelHeader
        title={
          <span className="player-form__title">
            <Activity size={18} aria-hidden="true" /> Форма игрока
          </span>
        }
        action={
          <SegmentedControl
            ariaLabel="Окно формы игрока"
            value={String(windowSize)}
            onChange={(id) => setWindowSize(Number(id) as PlayerFormWindow)}
            items={[
              { id: '5', label: '5 матчей' },
              { id: '10', label: '10 матчей' },
            ]}
          />
        }
      />
      <p className="player-form__subtitle">{teamName} · последние матчи</p>
      {!data && !busy && (
        <Button disabled={!candidates.length || !playerId} onClick={() => void load()}>
          Показать форму игрока <ChevronRight size={15} aria-hidden="true" />
        </Button>
      )}
      {!candidates.length && (
        <p className="players-note">В расписании нет завершённых матчей этого клуба.</p>
      )}
      {busy && (
        <div className="player-form__progress" role="status">
          <span>
            Собираем показатели: {progress[0]} / {progress[1]}
          </span>
          <progress max={progress[1] || 1} value={progress[0]} />
        </div>
      )}
      {error && (
        <EmptyState
          tone="error"
          message={error}
          action={
            <Button variant="quiet" small onClick={() => void load()}>
              Повторить
            </Button>
          }
        />
      )}
      {data && (
        <>
          <div className="player-form__coverage">
            <strong>
              Последние {data.recent.fixtures} матчей команды · показатели есть в{' '}
              {data.recent.available}
            </strong>
            <span>
              База: {data.baseline.fixtures} из {data.totalCandidates} матчей
              {data.stale ? ' · есть сохранённые данные' : ''}
              {data.failed ? ` · не загрузились: ${data.failed}` : ''}
            </span>
          </div>
          <div className="player-form__summary">
            {METRICS.map((m) => {
              const recent = data.recent.metrics[m.key],
                base = data.baseline.metrics[m.key];
              const delta =
                recent.mean !== null && base.mean !== null ? recent.mean - base.mean : null;
              return (
                <Button
                  key={m.key}
                  className="player-form__metric"
                  aria-pressed={metric === m.key}
                  onClick={() => setMetric(m.key)}
                >
                  <StatTile
                    label={`${m.label} · среднее за матч`}
                    value={`${number(recent.mean)}${recent.mean !== null ? m.unit : ''}`}
                    note={
                      <>
                        <span>
                          База: {number(base.mean)}
                          {base.mean !== null ? m.unit : ''}
                        </span>
                        {delta !== null && (
                          <span>
                            {delta > 0 ? '+' : ''}
                            {number(delta)} к среднему базы
                          </span>
                        )}
                        <span>
                          Наблюдений: {recent.observed} / {data.recent.fixtures}; в базе:{' '}
                          {base.observed}
                        </span>
                      </>
                    }
                  />
                </Button>
              );
            })}
          </div>
          <div className="player-form__chart-head">
            <h3>{chosenMetric.label} по матчам</h3>
            <span>Пунктир — среднее базы</span>
          </div>
          <div
            className="player-form__chart"
            role="img"
            aria-label={`График: ${chosenMetric.label}, последние ${data.recent.fixtures} матчей`}
          >
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={graph} margin={{ top: 15, right: 20, bottom: 12, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="index"
                  tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                  tickFormatter={(n) => {
                    const row = graph[Number(n) - 1];
                    return row?.date
                      ? formatDate(row.date, tz).replace(/ \d{4}$/, '')
                      : `Матч ${n}`;
                  }}
                />
                <YAxis
                  domain={metric === 'rating' ? [0, 10] : [0, 'auto']}
                  allowDecimals={metric === 'rating'}
                  width={42}
                  tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                />
                <Tooltip
                  labelFormatter={(value) => {
                    const row = graph[Number(value) - 1];
                    return row
                      ? `${row.match.home_team.name} — ${row.match.away_team.name}`
                      : 'Матч';
                  }}
                  formatter={(v) => [number(Number(v)), chosenMetric.label]}
                  contentStyle={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text)',
                  }}
                />
                {average !== null && (
                  <ReferenceLine
                    y={average}
                    stroke="var(--color-text-secondary)"
                    strokeDasharray="5 5"
                  />
                )}
                <Line
                  type="linear"
                  dataKey="value"
                  name={chosenMetric.label}
                  stroke="var(--color-accent)"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="ui-table-scroll player-form__table">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Матч · новые сверху</th>
                  <th className="ui-table__num">Рейтинг</th>
                  <th className="ui-table__num">Мин.</th>
                  <th className="ui-table__num">Голы</th>
                  <th className="ui-table__num">Передачи</th>
                </tr>
              </thead>
              <tbody>
                {data.rows
                  .slice()
                  .reverse()
                  .map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Button
                          variant="quiet"
                          className="player-form__match"
                          disabled={!onOpenMatch}
                          onClick={() => onOpenMatch?.(row.id)}
                        >
                          <small>
                            {row.date ? formatHumanDate(row.date, tz) : 'Дата уточняется'}
                            {row.status === 'failed'
                              ? ' · не загрузился'
                              : row.status === 'missing'
                                ? ' · нет данных игрока'
                                : row.status === 'not-played'
                                  ? ' · 0 минут'
                                  : ''}
                          </small>
                          <span>
                            {row.match.home_team.name} — {row.match.away_team.name}
                          </span>
                        </Button>
                      </td>
                      <td className="ui-table__num">{number(row.rating)}</td>
                      <td className="ui-table__num">{number(row.minutes, 0)}</td>
                      <td className="ui-table__num">{number(row.goals, 0)}</td>
                      <td className="ui-table__num">{number(row.assists, 0)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="player-form__footer">
            <span>База — до 60 последних матчей клуба.</span>
            <Button disabled={busy} onClick={() => void load()}>
              <RefreshCw size={13} aria-hidden="true" /> Повторить подсчёт
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
