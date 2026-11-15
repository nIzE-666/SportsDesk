import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { api } from '../../lib/bridge';
import { retainResource } from '../../lib/resourceHealth';
import { LoadingBlock } from '../../components/StateViews';
import { SourceLine } from '../../components/SourceLine';
import { Button, Panel } from '../../kit';
import { useViewState } from '../../lib/useViewState';
import {
  buildXg,
  parsePressure,
  parseShots,
  periodLabel,
  selectShots,
  shotClock,
  shotMinute,
  shotOutcome,
  SHOT_PERIODS,
  type AnalysisShot,
  type PressureData,
  type ShotData,
  type ShotPeriod,
  type XgSeries,
} from './matchAnalysisModel';
import type { MatchDetail } from './types';
import './matchAnalysis.css';

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error?: string;
  stale?: boolean;
  fetchedAt?: string | null;
}
const empty = <T,>(): Resource<T> => ({ data: null, loading: true });
/** «1 точка», «2 точки», «5 точек». */
const pointsWord = (count: number) => {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'точек';
  return count % 10 === 1 ? 'точка' : count % 10 >= 2 && count % 10 <= 4 ? 'точки' : 'точек';
};
const decimal = (value: number | null) =>
  value === null
    ? '—'
    : value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useAnalysis(matchId: string, liveTick: number, refreshToken: number) {
  const [shots, setShots] = useState<Resource<ShotData>>(empty);
  const [pressure, setPressure] = useState<Resource<PressureData>>(empty);
  const [retry, setRetry] = useState(0);
  const lastRetry = useRef(0);
  const lastTick = useRef(liveTick);
  const lastRefreshToken = useRef(refreshToken);
  useEffect(() => {
    const release = ['shots', 'momentum'].map((suffix) =>
      retainResource('pitch', `matches/${matchId}/${suffix}`),
    );
    return () => release.forEach((stop) => stop());
  }, [matchId]);
  useEffect(() => {
    let active = true;
    const automatic =
      liveTick !== lastTick.current &&
      retry === lastRetry.current &&
      refreshToken === lastRefreshToken.current;
    lastRetry.current = retry;
    lastTick.current = liveTick;
    lastRefreshToken.current = refreshToken;
    async function load<T>(
      suffix: string,
      parse: (v: unknown, id: string) => T,
      set: Dispatch<SetStateAction<Resource<T>>>,
    ) {
      set((prev) => ({ ...prev, loading: true }));
      try {
        const reply = await api('pitch', `matches/${matchId}/${suffix}`, { automatic });
        const data = parse(reply.payload, matchId);
        if (active)
          set({
            data,
            loading: false,
            stale: reply.stale,
            fetchedAt: reply.fetchedAt ?? null,
            error: reply.failure?.message,
          });
      } catch (e) {
        if (active)
          set((prev) => ({
            ...prev,
            loading: false,
            error: e instanceof Error ? e.message : 'Данные временно недоступны.',
          }));
      }
    }
    void Promise.allSettled([
      load('shots', parseShots, setShots),
      load('momentum', parsePressure, setPressure),
    ]);
    return () => {
      active = false;
    };
  }, [matchId, liveTick, retry, refreshToken]);
  return { shots, pressure, reload: () => setRetry((n) => n + 1) };
}

function ResourceNotice({ resource }: { resource: Resource<unknown> }) {
  return (
    <>
      {resource.loading && resource.data !== null && (
        <p className="muted small" role="status">
          Обновляем данные…
        </p>
      )}
      {resource.error && (
        <p className="analysis-notice" role="status">
          {resource.data !== null ? 'Показаны прежние данные. ' : ''}
          {resource.error}
        </p>
      )}
    </>
  );
}

export function MatchAnalysis({
  detail,
  liveTick = 0,
  refreshToken = 0,
  onSourceStatus,
}: {
  detail: MatchDetail;
  liveTick?: number;
  refreshToken?: number;
  onSourceStatus?: (status: { fetchedAt: string | null; stale: boolean }) => void;
}) {
  const { shots, pressure, reload } = useAnalysis(detail.id, liveTick, refreshToken);
  const timestamps = [shots.fetchedAt, pressure.fetchedAt];
  const oldest = timestamps.every((value) => value && Number.isFinite(Date.parse(value)))
    ? (timestamps
        .filter((value): value is string => !!value)
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null)
    : null;
  const stale =
    !!shots.stale ||
    !!pressure.stale ||
    (!!shots.error && !!shots.data) ||
    (!!pressure.error && !!pressure.data);
  useEffect(() => {
    onSourceStatus?.({ fetchedAt: oldest, stale });
  }, [onSourceStatus, oldest, stale]);
  const [team, setTeam] = useViewState(
    `analysis.${detail.id}.team`,
    'All',
    (v) => v === 'All' || v === detail.home_team.id || v === detail.away_team.id,
  );
  const [period, setPeriod] = useViewState<ShotPeriod | 'All'>(
    `analysis.${detail.id}.period`,
    'All',
    (v) =>
      v === 'All' || v === 'Unknown' || SHOT_PERIODS.includes(v as (typeof SHOT_PERIODS)[number]),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const knownShots = useMemo(
    () =>
      (shots.data?.shots ?? []).filter(
        (s) => s.teamId === detail.home_team.id || s.teamId === detail.away_team.id,
      ),
    [shots.data, detail],
  );
  const filtered = selectShots(knownShots, team, period);
  const availablePeriods = [...SHOT_PERIODS, 'Unknown' as const].filter((p) =>
    knownShots.some((s) => s.period === p),
  );
  const activePeriod = period === 'All' || availablePeriods.includes(period) ? period : 'All';
  const visible = activePeriod === period ? filtered : selectShots(knownShots, team, activePeriod);
  const homeShots = visible.filter((s) => s.teamId === detail.home_team.id);
  const awayShots = visible.filter((s) => s.teamId === detail.away_team.id);
  const homeXg = buildXg(homeShots),
    awayXg = buildXg(awayShots);
  const omitted = (shots.data?.rejected ?? 0) + (shots.data?.shots.length ?? 0) - knownShots.length;
  const missingCoordinates = visible.filter((s) => s.x === null).length;
  const clock = shotClock(knownShots);
  return (
    <div className="match-analysis" aria-label="Разбор матча">
      <header className="analysis-heading">
        <div>
          <h2>Разбор матча</h2>
          <p className="muted small">Качество моментов и ход игры</p>
        </div>
        {!onSourceStatus && (
          <Button onClick={reload} disabled={shots.loading || pressure.loading}>
            Обновить разбор
          </Button>
        )}
      </header>
      <Panel className="analysis-pressure">
        <h3 title="Показатель источника, а не вероятность гола">Давление по ходу матча</h3>
        <p className="muted small">
          Выше нуля — давление {detail.home_team.name}, ниже — {detail.away_team.name}.
        </p>
        <ResourceNotice resource={pressure} />
        {pressure.loading && !pressure.data ? (
          <LoadingBlock label="Загружаем давление…" rows={2} />
        ) : pressure.data?.points.length ? (
          <PressureChart data={pressure.data} detail={detail} />
        ) : pressure.data ? (
          <p className="muted">Источник не опубликовал давление для этого матча.</p>
        ) : null}
        {!!pressure.data?.rejected && (
          <p className="analysis-notice">
            Пропущено некорректных точек давления: {pressure.data.rejected}.
          </p>
        )}
      </Panel>
      <Panel className="analysis-shots">
        <h3>Удары и ожидаемые голы</h3>
        <ResourceNotice resource={shots} />
        {shots.loading && !shots.data ? (
          <LoadingBlock label="Загружаем удары…" rows={3} />
        ) : !shots.data ? (
          <p className="muted">Данные об ударах недоступны.</p>
        ) : !knownShots.length ? (
          <p className="muted">Источник не опубликовал удары для этого матча.</p>
        ) : (
          <>
            <div className="analysis-filters">
              <label>
                Команда
                <select aria-label="Команда" value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="All">Обе команды</option>
                  <option value={detail.home_team.id}>{detail.home_team.name}</option>
                  <option value={detail.away_team.id}>{detail.away_team.name}</option>
                </select>
              </label>
              <label>
                Период
                <select
                  aria-label="Период"
                  value={activePeriod}
                  onChange={(e) => setPeriod(e.target.value as ShotPeriod | 'All')}
                >
                  <option value="All">Весь матч (без серии пенальти)</option>
                  {availablePeriods.map((p) => (
                    <option key={p} value={p}>
                      {periodLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="analysis-totals">
              {[
                { side: 'home', ref: detail.home_team, list: homeShots, xg: homeXg },
                { side: 'away', ref: detail.away_team, list: awayShots, xg: awayXg },
              ]
                .filter(({ ref }) => team === 'All' || team === ref.id)
                .map(({ side, ref, list, xg }) => (
                  <div key={side} className={`analysis-total ${side}`}>
                    <strong>{ref.name}</strong>
                    <span>
                      Удары: {list.length} · xG по ударам {decimal(xg.total)}
                    </span>
                    <small className="muted">
                      {xg.known} из {xg.count} ударов с xG
                      {xg.incomplete ? ' · неполные данные' : ''}
                    </small>
                  </div>
                ))}
            </div>
            {(homeXg.incomplete || awayXg.incomplete) && (
              <p className="analysis-notice">
                Неполная кривая xG: суммируются только известные значения.
              </p>
            )}
            <div className="analysis-visuals">
              <div>
                <h4>Карта ударов</h4>
                <ShotMap shots={visible} homeId={detail.home_team.id} selected={selected} />
                <p className="muted small">
                  Обе команды атакуют вправо; круг — xG, квадрат — xG неизвестен, кольцо — гол.
                </p>
                {missingCoordinates > 0 && (
                  <p className="analysis-notice">
                    Без координат: {missingCoordinates} (есть в списке).
                  </p>
                )}
              </div>
              <div>
                <h4>Накопленный xG · {periodLabel(activePeriod)}</h4>
                {homeXg.points.length || awayXg.points.length ? (
                  <XgChart home={homeXg} away={awayXg} clock={clock} detail={detail} />
                ) : (
                  <p className="muted">Для кривой нужны xG, минута и период удара.</p>
                )}
                <p
                  className="muted small"
                  title="Сумма может отличаться от командной статистики из-за округления отдельных ударов."
                >
                  Сумма xG выбранных ударов; автоголы и серия пенальти не входят.
                </p>
              </div>
            </div>
            <div className="ui-table-scroll analysis-table-scroll">
              <table className="ui-table">
                <caption>
                  Список ударов · {periodLabel(activePeriod)} · {visible.length}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Минута</th>
                    <th scope="col">Команда и игрок</th>
                    <th scope="col">Исход</th>
                    <th scope="col">xG</th>
                    <th scope="col">Карта</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr key={s.id} className={selected === s.id ? 'selected' : ''}>
                      <td>
                        {shotMinute(s)}
                        <small>{periodLabel(s.period)}</small>
                      </td>
                      <td>
                        <span
                          className={`analysis-team ${s.teamId === detail.home_team.id ? 'home' : 'away'}`}
                        >
                          {s.teamId === detail.home_team.id
                            ? detail.home_team.name
                            : detail.away_team.name}
                        </span>
                        <br />
                        {s.player}
                      </td>
                      <td>{shotOutcome(s)}</td>
                      <td>{decimal(s.xg)}</td>
                      <td>
                        {s.x !== null ? (
                          <Button
                            variant="quiet"
                            small
                            aria-pressed={selected === s.id}
                            aria-label={`Показать удар: ${s.player}, ${shotMinute(s)}`}
                            onClick={() => setSelected(selected === s.id ? null : s.id)}
                          >
                            Показать
                          </Button>
                        ) : (
                          <span className="muted">Нет координат</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visible.length && <p className="muted">Нет ударов для этого выбора.</p>}
          </>
        )}
        {omitted > 0 && (
          <p className="analysis-notice">Неполные данные: пропущено записей — {omitted}.</p>
        )}
      </Panel>
      {!onSourceStatus && (
        <SourceLine sources={['pitch']} fetchedAt={oldest} oldest stale={stale} />
      )}
    </div>
  );
}

function ShotMap({
  shots,
  homeId,
  selected,
}: {
  shots: AnalysisShot[];
  homeId: string;
  selected: string | null;
}) {
  return (
    <svg
      className="analysis-pitch"
      viewBox="-3 -3 111 74"
      role="img"
      aria-label="Карта ударов, обе команды атакуют вправо; подробности в списке ударов"
    >
      <g className="analysis-pitch-lines" fill="none">
        <rect width="105" height="68" />
        <path d="M52.5 0V68M0 13.84H16.5V54.16H0M105 13.84H88.5V54.16H105M0 24.84H5.5V43.16H0M105 24.84H99.5V43.16H105" />
        <circle cx="52.5" cy="34" r="9.15" />
        <path d="M105 30.34h2v7.32h-2" />
      </g>
      {shots
        .filter((s) => s.x !== null && s.y !== null)
        .map((s) => {
          const radius = s.xg === null ? 1.4 : 1.2 + Math.sqrt(s.xg) * 2.8;
          return (
            <g
              key={s.id}
              className={`analysis-shot ${s.teamId === homeId ? 'home' : 'away'} ${selected === s.id ? 'selected' : ''}`}
            >
              <title>{`${shotMinute(s)} · ${s.player} · ${shotOutcome(s)} · xG ${decimal(s.xg)}`}</title>
              {s.xg === null ? (
                <rect x={s.x! - radius} y={s.y! - radius} width={radius * 2} height={radius * 2} />
              ) : (
                <circle cx={s.x!} cy={s.y!} r={radius} />
              )}
              {s.outcome.toLowerCase() === 'goal' && (
                <circle className="analysis-goal-ring" cx={s.x!} cy={s.y!} r={radius + 1.2} />
              )}
              {selected === s.id && (
                <circle className="analysis-selection-ring" cx={s.x!} cy={s.y!} r={radius + 3} />
              )}
            </g>
          );
        })}
    </svg>
  );
}
function XgChart({
  home,
  away,
  clock,
  detail,
}: {
  home: XgSeries;
  away: XgSeries;
  clock: ReturnType<typeof shotClock>;
  detail: MatchDetail;
}) {
  const max = Math.max(1, home.total ?? 0, away.total ?? 0);
  const x = (time: number) => 40 + (time / clock.end) * 520;
  const y = (v: number) => 168 - (v / max) * 136;
  const path = (series: XgSeries) => {
    let p = `M${x(0)},${y(0)}`;
    for (const point of series.points) p += `H${x(clock.time(point.shot)!)}V${y(point.total)}`;
    // Do not extend the line through an unobserved interval to the final whistle.
    return p;
  };
  return (
    <svg
      className="analysis-chart"
      viewBox="0 0 600 205"
      role="img"
      aria-label={`Накопленный xG: ${detail.home_team.name} ${decimal(home.total)}, ${detail.away_team.name} ${decimal(away.total)}. Значения каждого удара приведены в списке.`}
    >
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <path className="analysis-grid" d={`M40 ${y(v)}H560`} />
          <text x="32" y={y(v) + 4} textAnchor="end">
            {decimal(v)}
          </text>
        </g>
      ))}
      {clock.ticks.map((t) => (
        <text key={t.value} x={x(t.value)} y="192" textAnchor="middle">
          {t.label}
        </text>
      ))}
      {[
        { series: home, side: 'home' },
        { series: away, side: 'away' },
      ].map(
        ({ series, side }) =>
          series.points.length > 0 && (
            <path
              key={side}
              className={`analysis-xg ${side}`}
              strokeDasharray={series.incomplete ? '5 4' : undefined}
              d={path(series)}
            />
          ),
      )}
    </svg>
  );
}
function PressureChart({ data, detail }: { data: PressureData; detail: MatchDetail }) {
  const end = Math.max(90, ...data.points.map((p) => p.minute));
  // Use the published scale unchanged; no invented normalisation or interpolated gaps.
  const scale = Math.max(1, ...data.points.map((p) => Math.abs(p.value)));
  return (
    <>
      <svg
        className="analysis-chart analysis-pressure-chart"
        viewBox="0 0 600 180"
        role="img"
        aria-label={`Давление: ${detail.home_team.name} выше нуля, ${detail.away_team.name} ниже нуля; численные значения в раскрываемой таблице`}
      >
        <path className="analysis-grid" d="M40 76H560" />
        <text x="32" y="26" textAnchor="end">
          {decimal(scale)}
        </text>
        <text x="32" y="80" textAnchor="end">
          0
        </text>
        <text x="32" y="138" textAnchor="end">
          {decimal(-scale)}
        </text>
        {data.points.map((p) => (
          <line
            key={p.minute}
            className={`analysis-pressure-bar ${p.value >= 0 ? 'home' : 'away'}`}
            x1={40 + (p.minute / end) * 520}
            x2={40 + (p.minute / end) * 520}
            y1="76"
            y2={76 - (p.value / scale) * 58}
          >
            <title>{`${p.minute}′ · ${p.value}`}</title>
          </line>
        ))}
        {[0, 45, 90, ...(end > 90 ? [end] : [])].map((v) => (
          <text key={v} x={40 + (v / end) * 520} y="164" textAnchor="middle">
            {v}′
          </text>
        ))}
      </svg>
      <details>
        <summary>
          Давление в числах · {data.points.length} {pointsWord(data.points.length)}
        </summary>
        <div className="ui-table-scroll analysis-table-scroll">
          <table className="ui-table">
            <caption>Исходные значения давления</caption>
            <thead>
              <tr>
                <th scope="col">Минута источника</th>
                <th scope="col">Индекс давления</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((p) => (
                <tr key={p.minute}>
                  <td>{p.minute}′</td>
                  <td>{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
