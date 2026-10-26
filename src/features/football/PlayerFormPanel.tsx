import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react';
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
import {
  fetchPlayerForm,
  selectPlayerFormFixtures,
  selectPlayerFormWindow,
  type PlayerForm,
  type PlayerFormMetricKey,
  type PlayerFormWindow,
} from './playerForm';
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
    <section className="panel player-form-panel" aria-label="Форма игрока">
      <div className="section-title">
        <div>
          <h2>
            <Activity size={18} /> Форма игрока
          </h2>
          <p className="analysis-subtitle">{teamName} · динамика по последним матчам команды</p>
        </div>
        <div className="analysis-control-group" role="group" aria-label="Окно формы игрока">
          {([5, 10] as const).map((n) => (
            <button
              key={n}
              className={windowSize === n ? 'ghost-btn active' : 'ghost-btn'}
              aria-pressed={windowSize === n}
              onClick={() => setWindowSize(n)}
            >
              {n} матчей
            </button>
          ))}
        </div>
      </div>
      <p className="analysis-description">
        Рейтинг, минуты, голы и передачи — по матчам, а не одной суммой. Сравнение со средним по
        доступной базе покажет, как меняются показатели. Пропуски данных остаются пропусками.
      </p>
      {!data && !busy && (
        <button
          className="primary-btn"
          disabled={!candidates.length || !playerId}
          onClick={() => void load()}
        >
          Показать форму игрока <ChevronRight size={15} />
        </button>
      )}
      {!candidates.length && (
        <p className="muted small">В загруженном расписании нет завершённых матчей этого клуба.</p>
      )}
      {busy && (
        <div className="analysis-progress" role="status">
          <span>
            Собираем показатели: {progress[0]} / {progress[1]}
          </span>
          <progress max={progress[1] || 1} value={progress[0]} />
        </div>
      )}
      {error && (
        <p className="season-error" role="alert">
          {error}{' '}
          <button className="ghost-btn" onClick={() => void load()}>
            Повторить
          </button>
        </p>
      )}
      {data && (
        <>
          <div className="analysis-coverage">
            <strong>
              Последние {data.recent.fixtures} матчей команды · показатели есть в{' '}
              {data.recent.available}
            </strong>
            <span>
              База: {data.baseline.fixtures} проверенных встреч из {data.totalCandidates}{' '}
              загруженных{data.stale ? ' · есть сохранённые данные' : ''}
              {data.failed ? ` · ${data.failed} ответов недоступно` : ''}
            </span>
          </div>
          <div className="form-summary-grid">
            {METRICS.map((m) => {
              const recent = data.recent.metrics[m.key],
                base = data.baseline.metrics[m.key];
              const delta =
                recent.mean !== null && base.mean !== null ? recent.mean - base.mean : null;
              return (
                <button
                  key={m.key}
                  className={`form-summary-card ${metric === m.key ? 'selected' : ''}`}
                  aria-pressed={metric === m.key}
                  onClick={() => setMetric(m.key)}
                >
                  <span>{m.label} · среднее за матч</span>
                  <strong>
                    {number(recent.mean)}
                    {recent.mean !== null ? m.unit : ''}
                  </strong>
                  <small>
                    База: {number(base.mean)}
                    {base.mean !== null ? m.unit : ''}
                  </small>
                  {delta !== null && (
                    <span className="form-delta">
                      {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{' '}
                      {delta > 0 ? '+' : ''}
                      {number(delta)} к среднему базы
                    </span>
                  )}
                  <small>
                    Наблюдений: {recent.observed} / {data.recent.fixtures}; в базе: {base.observed}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="analysis-chart-head">
            <h3>{chosenMetric.label} по матчам</h3>
            <span>Пунктир — среднее базы</span>
          </div>
          <div
            className="analysis-chart"
            role="img"
            aria-label={`График: ${chosenMetric.label}, последние ${data.recent.fixtures} матчей`}
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={graph} margin={{ top: 15, right: 20, bottom: 12, left: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="index"
                  tick={{ fill: 'var(--muted)', fontSize: 12 }}
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
                  tick={{ fill: 'var(--muted)', fontSize: 12 }}
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
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    color: 'var(--text)',
                  }}
                />
                {average !== null && (
                  <ReferenceLine y={average} stroke="var(--muted)" strokeDasharray="5 5" />
                )}
                <Line
                  type="linear"
                  dataKey="value"
                  name={chosenMetric.label}
                  stroke="var(--accent)"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="form-match-list">
            <div className="form-match-header">
              <span>Матч · старые слева на графике</span>
              <span>Рейтинг</span>
              <span>Мин.</span>
              <span>Голы</span>
              <span>Передачи</span>
            </div>
            {data.rows
              .slice()
              .reverse()
              .map((row) => (
                <div className="form-match-row" key={row.id}>
                  <button
                    className="form-match-open"
                    disabled={!onOpenMatch}
                    onClick={() => onOpenMatch?.(row.id)}
                  >
                    <small>
                      {row.date ? formatDate(row.date, tz) : 'Дата уточняется'}
                      {row.status === 'failed'
                        ? ' · ответ недоступен'
                        : row.status === 'missing'
                          ? ' · нет данных игрока'
                          : row.status === 'not-played'
                            ? ' · 0 минут по данным источника'
                            : ''}
                    </small>
                    <span>
                      {row.match.home_team.name} — {row.match.away_team.name}
                    </span>
                  </button>
                  <strong>{number(row.rating)}</strong>
                  <span>{number(row.minutes, 0)}</span>
                  <span>{number(row.goals, 0)}</span>
                  <span>{number(row.assists, 0)}</span>
                </div>
              ))}
          </div>
          <div className="analysis-footer">
            <span>
              База — до 60 загруженных матчей клуба. Сравнение описывает показатели, а не причину их
              изменения.
            </span>
            <button className="ghost-btn" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={13} /> Повторить подсчёт
            </button>
          </div>
        </>
      )}
    </section>
  );
}
