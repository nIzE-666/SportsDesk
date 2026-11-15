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
import { countRu, LAP_PAIRS, LAPS, pluralRu } from '../../lib/plural';
import { Badge, Button, Panel, PanelHeader, StatTile } from '../../kit';
import { sessionNameLabel } from './analysisLabels';
import { SourceBar, tyreClass, type F1Style } from './shared';
import { useSourceSummaryAvailable } from './SourceSummary';
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
const compoundName = (compound: string | null | undefined) => {
  const value = (compound ?? '').toLowerCase();
  if (value === 'soft') return 'Мягкие';
  if (value === 'medium') return 'Средние';
  if (value === 'hard') return 'Жёсткие';
  if (value === 'intermediate') return 'Промежуточные';
  if (value === 'wet') return 'Дождевые';
  return 'Состав неизвестен';
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
  const aggregated = useSourceSummaryAvailable();
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
  const sessionName = sessionNameLabel(session.session_name) ?? 'Сессия';
  const sessionPlace = session.circuit_short_name || session.location;
  const pits =
    comparison?.rows.filter((r) => r.a.pitIn || r.a.pitOut || r.b.pitIn || r.b.pitOut) ?? [];
  return (
    <Panel className="race-pace-panel" aria-label="Сравнение гоночного темпа">
      <PanelHeader
        title={
          <>
            <Gauge size={19} /> Сравнение темпа по кругам
          </>
        }
        action={
          available ? (
            <Badge>Исторические данные</Badge>
          ) : (
            <Badge variant="warning">Данные ещё недоступны</Badge>
          )
        }
      />
      <span className="f1-muted f1-analysis-current">
        {sessionPlace ? `${sessionName} · ${sessionPlace}` : sessionName}
      </span>
      <p className="analysis-description">Круги, шины и пит-стопы.</p>
      <div className="pace-driver-selectors">
        {(
          [
            { driver: a, side: 'a', label: 'Первый пилот' },
            { driver: b, side: 'b', label: 'Второй пилот' },
          ] as const
        ).map(({ driver, side, label }) => (
          <div className={`pace-driver-selector ${side}`} key={side}>
            <PersonAvatar name={driverName(driver)} src={driver?.headshot_url} size={50} />
            <div className="pace-driver-field">
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
                    {driverName(d)} · {d.team_name || `№ ${d.driver_number}`}
                  </option>
                ))}
              </select>
            </div>
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
          Без кругов пит-лейна
        </label>
        <Button
          variant="primary"
          disabled={busy || !available || !a || !b}
          onClick={() => void load(!!raw)}
          icon={<ArrowLeftRight size={15} />}
        >
          {busy ? 'Загружаем круги…' : raw ? 'Обновить сравнение' : 'Сравнить темп'}
        </Button>
      </div>
      {!available && (
        <p className="muted small" title="Круги появляются через 30 минут после сессии.">
          Круги появляются через 30 минут.
        </p>
      )}
      {drivers.length < 2 && <p className="muted small">Нужны данные двух пилотов.</p>}
      {busy && (
        <p role="status" className="muted small">
          Загружаем круги…
        </p>
      )}
      {error && (
        <p className="season-error" role="alert" title={error}>
          Сравнение недоступно.
        </p>
      )}
      {comparison && (
        <>
          {!!comparison.warnings.length && (
            <div className="pace-warnings" role="status">
              {comparison.warnings.map((warning, index) => (
                <Badge key={index} variant="warning">
                  {warning}
                </Badge>
              ))}
            </div>
          )}
          <div className="pace-summary">
            {[
              { value: comparison.a, name: nameA, side: 'a' },
              { value: comparison.b, name: nameB, side: 'b' },
            ].map(({ value, name, side }) => (
              <StatTile
                key={side}
                className={`pace-summary__tile pace-summary__tile--${side}`}
                label={name}
                value={duration(value.medianSeconds)}
                note={
                  <>
                    Медиана · {countRu(value.validLapCount, LAPS)}
                    <br />
                    Среднее {duration(value.meanSeconds)} · без {value.excludedPitLapCount}{' '}
                    пит-кругов
                  </>
                }
              />
            ))}
            <StatTile
              className="pace-summary__tile pace-summary__tile--delta"
              label="Разница на общих кругах"
              value={seconds(comparison.paired.meanDeltaSeconds)}
              note={
                <>
                  Среднее A − B · {comparison.paired.lapCount}{' '}
                  {pluralRu(comparison.paired.lapCount, LAP_PAIRS)} кругов
                </>
              }
            />
          </div>
          <div className="pace-chart" role="img" aria-label={`Время кругов: ${nameA} и ${nameB}`}>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart
                data={comparison.rows}
                margin={{ top: 18, right: 18, bottom: 10, left: 6 }}
              >
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="lapNumber"
                  tick={{ fill: 'var(--color-text-secondary)', fontSize: 'var(--text-12)' }}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  width={68}
                  tickFormatter={duration}
                  tick={{ fill: 'var(--color-text-secondary)', fontSize: 'var(--text-12)' }}
                />
                <Tooltip
                  labelFormatter={(v) => `Круг ${v}`}
                  formatter={(v, name) => [duration(Number(v)), name]}
                  contentStyle={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text)',
                  }}
                />
                <Legend />
                {pits.map((r) => (
                  <ReferenceLine
                    key={r.lapNumber}
                    x={r.lapNumber}
                    stroke="var(--color-text-secondary)"
                    strokeDasharray="3 6"
                    strokeOpacity={0.35}
                  />
                ))}
                <Line
                  dataKey="a.paceSeconds"
                  name={nameA}
                  stroke="var(--color-chart-7)"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="b.paceSeconds"
                  name={nameB}
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!comparison.a.validLapCount && !comparison.b.validLapCount && (
            <p className="muted">Нет подходящих кругов с временем.</p>
          )}
          <div className="pace-tyres">
            {(['a', 'b'] as const).map((side) => (
              <div key={side}>
                <strong>{side === 'a' ? nameA : nameB}</strong>
                <div
                  className="pace-tyre-track"
                  style={{ '--lap-count': comparison.rows.length } as F1Style}
                  aria-label={`Шины: ${side === 'a' ? nameA : nameB}`}
                >
                  {segments(comparison, side).map((s, i) => (
                    <span
                      key={i}
                      className={`f1-tyre f1-tyre--${tyreClass(s.compound)}`}
                      title={`${compoundName(s.compound)} · круги ${s.start}–${s.end}`}
                      style={
                        {
                          '--stint-grid': `${s.start} / span ${s.end - s.start + 1}`,
                        } as F1Style
                      }
                    >
                      {s.compound.slice(0, 1)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <span className="muted small">Пунктир — пит-лейн.</span>
          <details className="pace-lap-details">
            <summary>Покруговые данные, шины и пит-стопы</summary>
            <div className="ui-table-scroll">
              <table className="ui-table">
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
            <span title="Темп не скорректирован на трафик, SC/VSC, топливо и возраст шин.">
              Без поправок на трафик и шины.
            </span>
            {!aggregated && (
              <Button small busy={busy} onClick={() => void load(true)}>
                <RefreshCw size={13} /> Перезагрузить данные
              </Button>
            )}
          </div>
          <SourceBar
            source="OpenF1"
            fetchedAt={raw?.fetchedAt ?? null}
            stale={raw?.stale ?? false}
            onRefresh={() => void load(true)}
            refreshing={busy}
          />
        </>
      )}
    </Panel>
  );
}
