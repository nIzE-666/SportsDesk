import { positionText } from './parsing';
import { DriverName, TeamDot } from './shared';
import { teamColor } from './teamColors';
import type { JolpicaQualifyingEntry, JolpicaResultEntry } from './types';

export function RaceResultsTable({ rows }: { rows: JolpicaResultEntry[] }) {
  return (
    <div className="f1-scroll">
      <table className="f1-table">
        <thead>
          <tr>
            <th>Поз.</th>
            <th>Пилот</th>
            <th>Команда</th>
            <th>Очки</th>
            <th>Статус / время</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.Driver.driverId}>
              <td>{positionText(row.positionText ?? row.position)}</td>
              <td>
                <DriverName givenName={row.Driver.givenName} familyName={row.Driver.familyName} />
              </td>
              <td>
                <TeamDot color={teamColor(row.Constructor.constructorId)} /> {row.Constructor.name}
              </td>
              <td>{row.points ?? '—'}</td>
              <td>
                {row.status ?? '—'}
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
    <div className="f1-scroll">
      <table className="f1-table">
        <thead>
          <tr>
            <th>Поз.</th>
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
              <td>{row.position ?? '—'}</td>
              <td>
                <DriverName givenName={row.Driver.givenName} familyName={row.Driver.familyName} />
              </td>
              <td>
                <TeamDot color={teamColor(row.Constructor.constructorId)} /> {row.Constructor.name}
              </td>
              <td>{row.Q1 ?? '—'}</td>
              <td>{row.Q2 ?? '—'}</td>
              <td>{row.Q3 ?? '—'}</td>
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
    <div className="f1-scroll">
      <table className="f1-table">
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
                <td>{r ?? '—'}</td>
                <td>{sprintScheduled ? (s ?? '—') : 'Нет спринта'}</td>
                <td>
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
