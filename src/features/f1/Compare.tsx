import { DriverPortrait } from './DriverPortraits';
import { ArrowLeftRight, Trophy } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useViewState } from '../../lib/useViewState';
import { Button, IconButton, StatTile } from '../../kit';
import { useApiResource } from './api';
import { grandPrixTitle } from './calendarModel';
import { ComparisonChart } from './ComparisonChart';
import { parseDriverStandings } from './parsing';
import { useSeason } from './SeasonContext';
import { SourceBar, State, TeamDot } from './shared';
import { teamColor } from './teamColors';
import { useWeekendSeason } from './useWeekendSeason';
import type { WeekendSeason } from './weekendData';
import { buildWeekendComparison } from './weekendData';

const EMPTY: WeekendSeason = {
  races: [],
  sprints: [],
  qualifying: [],
  issues: [],
  stale: false,
  fetchedAt: '',
};
const number = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
export function Compare({ round = 'season' }: { round?: 'season' | number }) {
  const { year } = useSeason();
  const { data, busy, error, reload } = useWeekendSeason(year);
  const [a, setA] = useViewState(`f1.${year}.compare.a`, 'max_verstappen');
  const [b, setB] = useViewState(`f1.${year}.compare.b`, '');
  const standing = useApiResource(
    `${year}-comparison-standing`,
    `${year}/driverStandings.json`,
    parseDriverStandings,
  );
  const drivers = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; code: string; team: string; teamId: string }
    >();
    for (const race of [...(data?.races ?? []), ...(data?.sprints ?? [])])
      for (const row of race.Results)
        map.set(row.Driver.driverId, {
          id: row.Driver.driverId,
          name: `${row.Driver.givenName} ${row.Driver.familyName}`,
          code: row.Driver.code ?? row.Driver.familyName.slice(0, 3).toUpperCase(),
          team: row.Constructor.name,
          teamId: row.Constructor.constructorId,
        });
    for (const race of data?.qualifying ?? [])
      for (const row of race.QualifyingResults)
        if (!map.has(row.Driver.driverId))
          map.set(row.Driver.driverId, {
            id: row.Driver.driverId,
            name: `${row.Driver.givenName} ${row.Driver.familyName}`,
            code: row.Driver.code ?? row.Driver.familyName.slice(0, 3).toUpperCase(),
            team: row.Constructor.name,
            teamId: row.Constructor.constructorId,
          });
    return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [data]);
  useEffect(() => {
    if (!drivers.length) return;
    if (!drivers.some((driver) => driver.id === a))
      setA(drivers.find((driver) => driver.teamId === 'red_bull')?.id ?? drivers[0]!.id);
    if (!drivers.some((driver) => driver.id === b))
      setB(
        drivers.find((driver) => driver.teamId === 'mercedes' && driver.id !== a)?.id ??
          drivers.find((driver) => driver.id !== a)?.id ??
          '',
      );
  }, [drivers, a, b]);
  const all = useMemo(() => buildWeekendComparison(data ?? EMPTY, a, b), [data, a, b]);
  const requestedRound = round === 'season' ? 'season' : String(round);
  const selectedRound =
    requestedRound === 'season' || all.series.some((row) => String(row.round) === requestedRound)
      ? requestedRound
      : 'season';
  const roundUnavailable = requestedRound !== 'season' && selectedRound === 'season';
  const comparison = useMemo(
    () => buildWeekendComparison(data ?? EMPTY, a, b, selectedRound),
    [data, a, b, selectedRound],
  );
  const driverA = drivers.find((driver) => driver.id === a),
    driverB = drivers.find((driver) => driver.id === b);
  if (busy && !data)
    return (
      <State kind="loading" title="Собираем уикенды сезона…">
        Это займёт несколько секунд.
      </State>
    );
  if (error && !data)
    return (
      <State kind="error" title="Сравнение недоступно">
        {error}{' '}
        <Button variant="quiet" small onClick={reload}>
          Повторить
        </Button>
      </State>
    );
  if (!drivers.length) return <State kind="empty" title="Результаты ещё не опубликованы" />;
  const metrics = [
    { key: 'racePoints', label: 'Очки в гонках' },
    { key: 'sprintPoints', label: 'Очки в спринтах' },
    { key: 'points', label: 'Всего очков' },
    { key: 'starts', label: 'Стартов в гонках' },
    { key: 'wins', label: 'Побед в гонках' },
    { key: 'podiums', label: 'Подиумов в гонках' },
    { key: 'sprintStarts', label: 'Стартов в спринтах' },
    { key: 'sprintWins', label: 'Побед в спринтах' },
    { key: 'dnf', label: 'Сходов в гонках' },
  ] as const;
  return (
    <div className="season-comparison">
      <div className="panel comparison-picker">
        <ArrowLeftRight size={18} />
        <select aria-label="Первый пилот" value={a} onChange={(event) => setA(event.target.value)}>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name}
            </option>
          ))}
        </select>
        <IconButton
          icon={<ArrowLeftRight size={17} />}
          aria-label="Поменять пилотов местами"
          onClick={() => {
            setA(b);
            setB(a);
          }}
        />
        <select aria-label="Второй пилот" value={b} onChange={(event) => setB(event.target.value)}>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name}
            </option>
          ))}
        </select>
      </div>
      {roundUnavailable && all.series.length > 0 ? (
        <p className="f1-analysis-note">Для этого этапа нет данных — показан весь сезон.</p>
      ) : null}
      {error && (
        <p className="f1-analysis-note" role="alert">
          {error} Показана предыдущая загрузка.{' '}
          <Button variant="quiet" small onClick={reload}>
            Повторить
          </Button>
        </p>
      )}
      {data?.issues.map((issue) => (
        <p className="f1-analysis-note" role="status" key={issue}>
          {issue}{' '}
          <Button variant="quiet" small onClick={reload}>
            Повторить
          </Button>
        </p>
      ))}
      <div className="versus-grid">
        {[
          { driver: driverA, total: comparison.a },
          { driver: driverB, total: comparison.b },
        ].map(({ driver, total }, index) => {
          const side = index === 0 ? 'a' : 'b';
          const official = standing.data?.standings.find(
            (row) => row.Driver.driverId === driver?.id,
          )?.points;
          const officialPoints =
            official !== undefined && Number.isFinite(Number(official)) ? Number(official) : null;
          return (
            <section key={side} className={`panel versus-driver ${side}`}>
              <DriverPortrait name={driver?.name ?? 'Пилот'} size={76} />
              <div>
                <span className="eyebrow">ПИЛОТ {index === 0 ? 'A' : 'B'}</span>
                <h2>{driver?.name ?? '—'}</h2>
                <p>
                  <TeamDot color={teamColor(driver?.teamId ?? '')} />
                  {driver?.team ?? '—'}
                </p>
                {selectedRound === 'season' && (
                  <p className="muted small">
                    В опубликованном зачёте: {number(officialPoints)} очков
                    {officialPoints !== null &&
                    total.points !== null &&
                    Math.abs(officialPoints - total.points) > 0.001 ? (
                      <span className="points-difference">
                        {' '}
                        · отличается на {number(officialPoints - total.points)}
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
              <div className="versus-points">
                <strong className={`versus-points-value ${side}`}>{number(total.points)}</strong>
                <small>гонки + спринты</small>
              </div>
            </section>
          );
        })}
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>
            <Trophy size={16} /> Уикенды в цифрах
          </h2>
          <span className="muted small">
            {selectedRound === 'season'
              ? `Сезон ${year}`
              : grandPrixTitle(comparison.series[0]?.name ?? '').title}
          </span>
        </div>
        <div className="f1-comparison-metrics">
          {metrics.map((metric) => (
            <StatTile
              key={metric.key}
              label={metric.label}
              value={
                <span className="f1-comparison-pair">
                  <span>{number(comparison.a[metric.key])}</span>
                  <span className="f1-comparison-sep">—</span>
                  <span>{number(comparison.b[metric.key])}</span>
                </span>
              }
              note={`${driverA?.code || 'A'} — ${driverB?.code || 'B'}`}
            />
          ))}
        </div>
        <div className="h2h-line">
          <span>{comparison.headToHead.a}</span>
          <p>
            Выше на финише гонки
            <small>Оба финишировали в {comparison.headToHead.compared} гонках</small>
          </p>
          <span>{comparison.headToHead.b}</span>
        </div>
        {data?.qualifying === null ? (
          <p className="muted small">Сравнение квалификаций недоступно.</p>
        ) : (
          <div className="h2h-line">
            <span>{comparison.qualifyingHeadToHead.a}</span>
            <p>
              Выше в квалификации
              <small>
                Парных результатов: {comparison.qualifyingHeadToHead.compared}. Штрафы на стартовой
                решётке сюда не входят.
              </small>
            </p>
            <span>{comparison.qualifyingHeadToHead.b}</span>
          </div>
        )}
        <p className="muted small" title="В опубликованном зачёте очки могут отличаться.">
          Очки — по результатам гонок и спринтов.
        </p>
      </section>
      <ComparisonChart
        series={comparison.series}
        a={driverA?.name ?? 'Пилот A'}
        b={driverB?.name ?? 'Пилот B'}
      />
      <section className="panel comparison-races">
        <h3>Каждый этап крупным планом</h3>
        <p className="muted small">К — квалификация, Г — финиш гонки.</p>
        <div className="ui-table-scroll">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Этап</th>
                <th>{driverA?.code || '—'} · К</th>
                <th>Г</th>
                <th>Гонка / спринт</th>
                <th>Всего</th>
                <th>{driverB?.code || '—'} · К</th>
                <th>Г</th>
                <th>Гонка / спринт</th>
                <th>Всего</th>
              </tr>
            </thead>
            <tbody>
              {comparison.series.map((row) => (
                <tr key={row.round}>
                  <td>
                    {row.round}. {grandPrixTitle(row.name).title}
                  </td>
                  <td>{row.aQualifying ?? '—'}</td>
                  <td>{row.aPosition ?? '—'}</td>
                  <td>
                    {number(row.aRacePoints)} / {number(row.aSprintPoints)}
                  </td>
                  <td>{number(row.aPoints)}</td>
                  <td>{row.bQualifying ?? '—'}</td>
                  <td>{row.bPosition ?? '—'}</td>
                  <td>
                    {number(row.bRacePoints)} / {number(row.bSprintPoints)}
                  </td>
                  <td>{number(row.bPoints)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <SourceBar
        source="Jolpica"
        fetchedAt={data?.fetchedAt ?? null}
        stale={data?.stale ?? false}
        onRefresh={() => {
          reload();
          standing.reload();
        }}
        refreshing={busy}
      />
    </div>
  );
}
