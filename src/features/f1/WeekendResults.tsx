import { positionText } from './parsing';
import { resultStatusLabel } from './analysisLabels';
import { DriverName, TeamDot } from './shared';
import { teamColor } from './teamColors';
import type { JolpicaQualifyingEntry, JolpicaResultEntry } from './types';

export function RaceResultsTable({ rows }: { rows: JolpicaResultEntry[] }) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            <th className="ui-table__num">Поз.</th>
            <th>Пилот</th>
            <th>Команда</th>
            <th>Очки</th>
            <th>Статус / время</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.Driver.driverId}>
              <td className="ui-table__num">{positionText(row.positionText ?? row.position)}</td>
              <td>
                <DriverName givenName={row.Driver.givenName} familyName={row.Driver.familyName} />
              </td>
              <td>
                <span className="f1-team-inline">
                  <TeamDot color={teamColor(row.Constructor.constructorId)} />
                  {row.Constructor.name}
                </span>
              </td>
              <td className="ui-table__num">{row.points ?? '—'}</td>
              <td>
                {(row.status ? resultStatusLabel(row.status) : null) ?? '—'}
                {row.Time?.time ? ` · ${row.Time.time}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function QualifyingResultsTable({ rows }: { rows: JolpicaQualifyingEntry[] }) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            <th className="ui-table__num">Поз.</th>
            <th>Пилот</th>
            <th>Команда</th>
            <th>Q1</th>
            <th>Q2</th>
            <th>Q3</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.Driver.driverId}>
              <td className="ui-table__num">{row.position ?? '—'}</td>
              <td>
                <DriverName givenName={row.Driver.givenName} familyName={row.Driver.familyName} />
              </td>
              <td>
                <span className="f1-team-inline">
                  <TeamDot color={teamColor(row.Constructor.constructorId)} />
                  {row.Constructor.name}
                </span>
              </td>
              <td className="ui-table__num">{row.Q1 ?? '—'}</td>
              <td className="ui-table__num">{row.Q2 ?? '—'}</td>
              <td className="ui-table__num">{row.Q3 ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function WeekendPointsTable({
  race,
  sprint,
  sprintScheduled,
}: {
  race: JolpicaResultEntry[];
  sprint: JolpicaResultEntry[];
  sprintScheduled: boolean;
}) {
  const drivers = new Map([...race, ...sprint].map((row) => [row.Driver.driverId, row.Driver]));
  const points = (value: string | undefined) =>
    value !== undefined && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            <th>Пилот</th>
            <th>Гонка</th>
            <th>Спринт</th>
            <th>Опубликовано очков</th>
          </tr>
        </thead>
        <tbody>
          {[...drivers.values()].map((driver) => {
            const r = points(race.find((row) => row.Driver.driverId === driver.driverId)?.points),
              s = points(sprint.find((row) => row.Driver.driverId === driver.driverId)?.points);
            return (
              <tr key={driver.driverId}>
                <td>
                  <DriverName givenName={driver.givenName} familyName={driver.familyName} />
                </td>
                <td className="ui-table__num">{r ?? '—'}</td>
                <td className="ui-table__num">{sprintScheduled ? (s ?? '—') : 'Нет спринта'}</td>
                <td className="ui-table__num">
                  <strong>{r === null && s === null ? '—' : (r ?? 0) + (s ?? 0)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
