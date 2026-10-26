import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Gauge, RefreshCw } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PersonAvatar } from '../../components/PersonAvatar';
import { useViewState } from '../../lib/useViewState';
import { useNow } from '../../lib/useNow';
import {
  buildRacePaceComparison,
  isRacePaceSessionAvailable,
  loadRacePace,
  type RacePaceComparison,
  type RacePaceData,
} from './racePace';
import type { OpenF1Driver, OpenF1Session } from './types';
import './racePace.css';

const driverName = (d: OpenF1Driver | undefined) =>
  d?.full_name || [d?.first_name, d?.last_name].filter(Boolean).join(' ') || 'Пилот';
const duration = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.floor(n / 60)}:${(n % 60).toFixed(3).padStart(6, '0')}`;
const seconds = (n: number | null | undefined) =>
  n == null
    ? '—'
    : `${n > 0 ? '+' : ''}${n.toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} с`;
const TYRE_COLORS: Record<string, string> = {
  SOFT: '#fa6868',
  MEDIUM: '#e7c64b',
  HARD: '#c7d0dc',
  INTERMEDIATE: '#5bd290',
  WET: '#5aabff',
};
function segments(comparison: RacePaceComparison, side: 'a' | 'b') {
  const out: { start: number; end: number; compound: string; stint: number | null }[] = [];
  for (const row of comparison.rows) {
    const point = row[side];
    if (!point.compound) continue;
    const previous = out.at(-1);
    if (
      previous &&
      previous.compound === point.compound &&
      previous.stint === point.stintNumber &&
      previous.end === row.lapNumber - 1
    )
      previous.end = row.lapNumber;
    else
      out.push({
        start: row.lapNumber,
        end: row.lapNumber,
        compound: point.compound,
        stint: point.stintNumber,
      });
  }
  return out;
}

export function RacePacePanel({
  session,
  drivers,
  initialDriver,
}: {
  session: OpenF1Session;
  drivers: OpenF1Driver[];
  initialDriver?: number | null;
}) {
  const now = useNow();
  const [aId, setAId] = useViewState<number | null>(
    `pace.${session.session_key}.a`,
    null,
    (v) => v === null || typeof v === 'number',
  );
  const [bId, setBId] = useViewState<number | null>(
    `pace.${session.session_key}.b`,
    null,
    (v) => v === null || typeof v === 'number',
  );
  const [excludePits, setExcludePits] = useViewState<boolean>(
    'pace.exclude-pit-laps',
    true,
    (v) => typeof v === 'boolean',
  );
  const a =
    drivers.find((d) => d.driver_number === aId) ??
    drivers.find((d) => d.driver_number === initialDriver) ??
    drivers[0];
  const b =
    drivers.find((d) => d.driver_number === bId && d.driver_number !== a?.driver_number) ??
    drivers.find((d) => d.name_acronym === 'RUS' && d.driver_number !== a?.driver_number) ??
    drivers.find((d) => d.driver_number !== a?.driver_number);
  const identity = `${session.session_key}:${a?.driver_number}:${b?.driver_number}`;
  const [loaded, setLoaded] = useState<{ key: string; value: RacePaceData } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
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
  const available = isRacePaceSessionAvailable(session, now);
  const load = async (refresh = false) => {
    if (!a || !b) return;
    const id = ++revision.current;
    setBusy(true);
    setError(null);
    try {
      const value = await loadRacePace(session, a.driver_number, b.driver_number, { refresh });
      if (revision.current === id) setLoaded({ key: identity, value });
    } catch (e) {
      if (revision.current === id)
        setError(e instanceof Error ? e.message : 'Сравнение темпа недоступно.');
    } finally {
      if (revision.current === id) setBusy(false);
    }
  };
  const raw = loaded?.key === identity ? loaded.value : null;
  const comparison = useMemo(
    () => (raw ? buildRacePaceComparison(raw, { excludePitLaps: excludePits }) : null),
    [raw, excludePits],
  );
  const nameA = driverName(a),
    nameB = driverName(b);
  const pits =
    comparison?.rows.filter((r) => r.a.pitIn || r.a.pitOut || r.b.pitIn || r.b.pitOut) ?? [];
  return (
    <section className="f1-card race-pace-panel" aria-label="Сравнение гоночного темпа">
      <div className="section-title">
        <div>
          <h2>
            <Gauge size={19} /> Сравнение темпа по кругам
          </h2>
          <p className="analysis-subtitle">
            {session.session_name ?? 'Сессия'} ·{' '}
            {session.circuit_short_name ?? session.location ?? ''}
          </p>
        </div>
        <span className="chip">{available ? 'Исторические данные' : 'Данные ещё недоступны'}</span>
      </div>
      <p className="analysis-description">
        Два пилота, одна сессия: время каждого круга, шины и пит-стопы. Сравнение помогает увидеть
        отрезки с разным темпом; это не график отрыва на трассе.
      </p>
      <div className="pace-driver-selectors">
        {(
          [
            { driver: a, side: 'a', label: 'Первый пилот' },
            { driver: b, side: 'b', label: 'Второй пилот' },
          ] as const
        ).map(({ driver, side, label }) => (
          <div className={`pace-driver-selector ${side}`} key={side}>
            <PersonAvatar name={driverName(driver)} src={driver?.headshot_url} size={50} />
            <label>
              <span>{label}</span>
              <select
                aria-label={`${label} для темпа`}
                value={driver?.driver_number ?? ''}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (side === 'a') {
                    if (value === b?.driver_number) setBId(a?.driver_number ?? null);
                    setAId(value);
                  } else {
                    if (value === a?.driver_number) setAId(b?.driver_number ?? null);
                    setBId(value);
                  }
                }}
              >
                {drivers.map((d) => (
                  <option value={d.driver_number} key={d.driver_number}>
                    {driverName(d)} · {d.team_name ?? `№ ${d.driver_number}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>
      <div className="pace-controls">
        <label>
          <input
            type="checkbox"
            checked={excludePits}
            onChange={(e) => setExcludePits(e.target.checked)}
          />{' '}
          Исключать круги заезда и выезда из боксов
        </label>
        <button
          className="primary-btn"
          disabled={busy || !available || !a || !b}
          onClick={() => void load(!!raw)}
        >
          <ArrowLeftRight size={15} />
          {busy ? 'Загружаем круги…' : raw ? 'Обновить сравнение' : 'Сравнить темп'}
        </button>
      </div>
      {!available && (
        <p className="muted small">
          Исторические круги доступны после окончания сессии с задержкой не менее 30 минут. Выберите
          более раннюю завершённую сессию.
        </p>
      )}
      {drivers.length < 2 && (
        <p className="muted small">Для сравнения нужны данные хотя бы двух пилотов этой сессии.</p>
      )}
      {busy && (
        <p role="status" className="muted small">
          Загружаем круги, отрезки и пит-стопы двух пилотов. Повторные запросы используют
          сохранённые данные.
        </p>
      )}
      {error && (
        <p className="season-error" role="alert">
          {error}
        </p>
      )}
      {comparison && (
        <>
          {!!comparison.warnings.length && (
            <div className="pace-warnings" role="status">
              {comparison.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
          <div className="pace-summary">
            {[
              { value: comparison.a, name: nameA, color: '#ff7771' },
              { value: comparison.b, name: nameB, color: '#69b7ff' },
            ].map(({ value, name, color }) => (
              <div key={name} style={{ borderTopColor: color }}>
                <span>{name}</span>
                <strong>{duration(value.medianSeconds)}</strong>
                <small>Медиана · {value.validLapCount} кругов с временем</small>
                <small>
                  Среднее: {duration(value.meanSeconds)} · пит-кругов исключено:{' '}
                  {value.excludedPitLapCount}
                </small>
              </div>
            ))}
            <div>
              <span>Разница на общих кругах</span>
              <strong>{seconds(comparison.paired.meanDeltaSeconds)}</strong>
              <small>Среднее A − B · {comparison.paired.lapCount} пар кругов</small>
              <small>
                Минус — быстрее {nameA}; плюс — {nameB}
              </small>
            </div>
          </div>
          <div className="pace-chart" role="img" aria-label={`Время кругов: ${nameA} и ${nameB}`}>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart
                data={comparison.rows}
                margin={{ top: 18, right: 18, bottom: 10, left: 6 }}
              >
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="lapNumber" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <YAxis
                  domain={['auto', 'auto']}
                  width={68}
                  tickFormatter={duration}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={(v) => `Круг ${v}`}
                  formatter={(v, name) => [duration(Number(v)), name]}
                  contentStyle={{
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    color: 'var(--text)',
                  }}
                />
                <Legend />
                {pits.map((r) => (
                  <ReferenceLine
                    key={r.lapNumber}
                    x={r.lapNumber}
                    stroke="var(--muted)"
                    strokeDasharray="3 6"
                    strokeOpacity={0.35}
                  />
                ))}
                <Line
                  dataKey="a.paceSeconds"
                  name={nameA}
                  stroke="#ff7771"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="b.paceSeconds"
                  name={nameB}
                  stroke="#69b7ff"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!comparison.a.validLapCount && !comparison.b.validLapCount && (
            <p className="muted">В выбранных данных нет подходящих кругов с временем.</p>
          )}
          <div className="pace-tyres">
            {(['a', 'b'] as const).map((side) => (
              <div key={side}>
                <strong>{side === 'a' ? nameA : nameB}</strong>
                <div
                  className="pace-tyre-track"
                  aria-label={`Шины: ${side === 'a' ? nameA : nameB}`}
                >
                  {segments(comparison, side).map((s, i) => (
                    <span
                      key={i}
                      title={`${s.compound} · круги ${s.start}–${s.end}`}
                      style={{
                        left: `${((s.start - 1) / comparison.rows.length) * 100}%`,
                        width: `${((s.end - s.start + 1) / comparison.rows.length) * 100}%`,
                        background: TYRE_COLORS[s.compound.toUpperCase()] ?? '#8190a2',
                      }}
                    >
                      {s.compound.slice(0, 1)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="muted small">
            S — мягкие, M — средние, H — жёсткие, I — промежуточные, W — дождевые. Пунктир на
            графике отмечает пит-заезд или выезд.
          </p>
          <details className="pace-lap-details">
            <summary>Покруговые данные, шины и пит-стопы</summary>
            <div className="f1-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Круг</th>
                    <th>{nameA}</th>
                    <th>Шины / боксы</th>
                    <th>{nameB}</th>
                    <th>Шины / боксы</th>
                    <th>A − B</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((r) => (
                    <tr key={r.lapNumber}>
                      <td>{r.lapNumber}</td>
                      <td>{duration(r.a.durationSeconds)}</td>
                      <td>
                        {r.a.compound ?? '—'}
                        {r.a.pitIn ? ' · заезд' : ''}
                        {r.a.pitOut ? ' · выезд' : ''}
                        {r.a.pitLaneSeconds !== null ? ` · пит-лейн ${r.a.pitLaneSeconds} с` : ''}
                      </td>
                      <td>{duration(r.b.durationSeconds)}</td>
                      <td>
                        {r.b.compound ?? '—'}
                        {r.b.pitIn ? ' · заезд' : ''}
                        {r.b.pitOut ? ' · выезд' : ''}
                        {r.b.pitLaneSeconds !== null ? ` · пит-лейн ${r.b.pitLaneSeconds} с` : ''}
                      </td>
                      <td>{seconds(r.deltaSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="analysis-footer">
            <span>
              Темп не скорректирован на трафик, SC/VSC, топливо и возраст шин. Источник OpenF1
              {raw?.stale ? ' · сохранённые данные' : ''}.
            </span>
            <button className="ghost-btn" disabled={busy} onClick={() => void load(true)}>
              <RefreshCw size={13} /> Перезагрузить данные
            </button>
          </div>
        </>
      )}
    </section>
  );
}
