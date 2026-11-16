import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, Star } from 'lucide-react';
import { useApiResource } from './api';
import {
  parseSchedule,
  parseDriverStandings,
  parseConstructorStandings,
  parseRaceResults,
  nextRace,
  latestFinished,
  isFinished,
  classifyResult,
} from './parsing';
import type {
  JolpicaRace,
  JolpicaDriverStanding,
  JolpicaResultEntry,
  JolpicaConstructor,
  JolpicaConstructorStanding,
} from './types';
import { parseUtc, formatDateTime, formatShort } from './time';
import { teamColor } from './teamColors';
import { useFavoriteDrivers, useFavoriteTeams } from './useFavorites';
import { useSeason } from './SeasonContext';
import { DriverName, RetryButton, SourceBar, State, TeamDot } from './shared';
import { Badge, Button, IconButton, Panel, PanelHeader, Tooltip } from '../../kit';
import { useNow } from '../../lib/useNow';
import { EventCover } from '../../components/EventCover';
import { grandPrixTitle, racePresentation } from './calendarModel';
import { resultStatusLabel } from './analysisLabels';

/**
 * Latest verified race results.
 * Fetched once at Overview level and shared by the latest-race panel and the
 * favourite-driver table, so we do not issue one request per block.
 */
interface LatestRaceData {
  round: number | null;
  race: {
    /** The Russian name of the Grand Prix, the same one the calendar shows. */
    title: string;
    round: string;
    Circuit: { circuitName: string; Location?: { country?: string } };
    date: string;
    time?: string;
  } | null;
  results: JolpicaResultEntry[];
}

const EMPTY_LATEST: LatestRaceData = { round: null, race: null, results: [] };
const DASH = '—';

function transformLatest(payload: unknown): LatestRaceData {
  const rows = parseRaceResults(payload);
  const row = rows.length > 0 ? rows[0] : undefined;
  if (!row) return EMPTY_LATEST;
  return {
    round: Number.isFinite(Number(row.round)) ? Number(row.round) : null,
    race: {
      title: grandPrixTitle(row.raceName).title,
      round: row.round,
      Circuit: {
        circuitName: row.Circuit.circuitName,
        Location: row.Circuit.Location ? { country: row.Circuit.Location.country } : undefined,
      },
      date: row.date,
      time: row.time,
    },
    results: row.Results,
  };
}

function pointsValue(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !value.trim()) return null;
  const points = Number(value);
  return Number.isFinite(points) ? points : null;
}

function numberLabel(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

/** The gap to the leader; zero for the leader, a dash when either value is unknown. */
function gapToLeader(
  points: string | null | undefined,
  leaderPoints: string | null | undefined,
): string {
  const own = pointsValue(points);
  const leader = pointsValue(leaderPoints);
  if (own === null || leader === null) return DASH;
  const gap = leader - own;
  if (!Number.isFinite(gap) || gap <= 0) return '0';
  return `−${numberLabel(gap)}`;
}

function SessionRow({ label, d }: { label: string; d?: { date?: string; time?: string } }) {
  const dt = d?.date ? parseUtc(d.date, d.time) : null;
  return (
    <div className="f1-session-row">
      <span className="f1-session-label">{label}</span>
      <span className="f1-num">{dt ? formatDateTime(dt) : DASH}</span>
    </div>
  );
}

function WeekendBody({ race }: { race: JolpicaRace }) {
  const sessions: Array<{ label: string; d?: { date?: string; time?: string } }> = [];
  if (race.FirstPractice) sessions.push({ label: 'Практика 1', d: race.FirstPractice });
  if (race.SprintQualifying || race.SprintShootout)
    sessions.push({
      label: 'Спринт-квалификация',
      d: race.SprintQualifying ?? race.SprintShootout,
    });
  if (race.SecondPractice) sessions.push({ label: 'Практика 2', d: race.SecondPractice });
  if (race.Sprint) sessions.push({ label: 'Спринт', d: race.Sprint });
  if (race.ThirdPractice) sessions.push({ label: 'Практика 3', d: race.ThirdPractice });
  if (race.Qualifying) sessions.push({ label: 'Квалификация', d: race.Qualifying });
  sessions.push({ label: 'Гонка', d: { date: race.date, time: race.time } });

  const circuit = race.Circuit;
  const loc = circuit.Location;
  return (
    <div className="f1-weekend">
      <div>
        <strong className="ui-section-title">{racePresentation(race).title}</strong>
        <div className="f1-muted">
          {circuit.circuitName}
          {loc?.locality ? ` · ${loc.locality}` : ''}
          {loc?.country ? `, ${loc.country}` : ''}
        </div>
      </div>
      <div>
        {sessions.map((session) => (
          <SessionRow key={session.label} label={session.label} d={session.d} />
        ))}
      </div>
    </div>
  );
}

interface PodiumItem {
  place: number;
  entry: JolpicaResultEntry | undefined;
}

function PodiumBody({
  last,
  fallbackRound,
  onRetry,
}: {
  last: LatestRaceData;
  fallbackRound: number | null;
  onRetry: () => void;
}) {
  const summary = useMemo(() => {
    if (!last.race || last.results.length === 0) return null;
    const results = last.results;
    const podium: PodiumItem[] = [
      { place: 1, entry: results.find((r) => r.position === '1') },
      { place: 2, entry: results.find((r) => r.position === '2') },
      { place: 3, entry: results.find((r) => r.position === '3') },
    ];
    const retirements = results.filter(
      (r) => classifyResult(r.status, r.positionText) === 'dnf',
    ).length;
    const finishedCount = results.filter(
      (r) => classifyResult(r.status, r.positionText) === 'finished',
    ).length;
    return { podium, retirements, finishedCount };
  }, [last]);

  const roundLabel = last.round ?? fallbackRound;

  if (!last.race && fallbackRound === null)
    return <State kind="empty" title="Нет завершённых гонок" message="Результатов сезона нет." />;
  if (!last.race && fallbackRound !== null)
    return (
      <State
        kind="empty"
        title={`Нет результатов раунда ${fallbackRound}`}
        action={<RetryButton onClick={onRetry} />}
      />
    );
  if (last.race && last.results.length === 0)
    return <State kind="empty" title="Нет результатов этапа" />;
  if (!last.race || !summary) return null;

  return (
    <div className="f1-podium">
      <div>
        <strong className="ui-section-title">{last.race.title}</strong>
        <div className="f1-muted">
          {last.race.Circuit.circuitName}
          {last.race.Circuit.Location?.country ? ` · ${last.race.Circuit.Location.country}` : ''}
          {roundLabel ? ` · Раунд ${roundLabel}` : ''}
        </div>
      </div>
      <div className="f1-podium-list">
        {summary.podium.map(({ place, entry }) => {
          if (!entry) return null;
          return (
            <div key={entry.Driver.driverId} className="f1-podium-row">
              <span className={place === 1 ? 'f1-podium-place is-first' : 'f1-podium-place'}>
                {place}
              </span>
              <div className="f1-podium-driver">
                <DriverName
                  givenName={entry.Driver.givenName}
                  familyName={entry.Driver.familyName}
                  size={24}
                />
                <span className="f1-muted f1-inline">
                  <TeamDot color={teamColor(entry.Constructor.constructorId)} />
                  {entry.Constructor.name}
                </span>
              </div>
              <div className="f1-podium-right">
                <div className="f1-num f1-note-small">
                  {place === 1 ? 'Победитель' : (entry.Time?.time ?? DASH)}
                </div>
                {entry.FastestLap?.rank === '1' && entry.FastestLap.Time?.time ? (
                  <div className="f1-muted">БК {entry.FastestLap.Time.time}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="f1-kv f1-kv--spaced">
        <span>
          Финишировали: <b>{summary.finishedCount}</b>
        </span>
        <span>
          Сходы: <b>{summary.retirements}</b>
        </span>
        <span className="f1-muted">
          {last.race ? formatShort(parseUtc(last.race.date, last.race.time)) : DASH}
        </span>
      </div>
    </div>
  );
}

function TopFiveTable({
  standings,
  leaderPoints,
  favoriteDrivers,
}: {
  standings: JolpicaDriverStanding[];
  leaderPoints: string | undefined;
  favoriteDrivers: readonly string[];
}) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table f1-mini-table">
        <thead>
          <tr>
            <th className="ui-table__num">Поз.</th>
            <th>Пилот</th>
            <th>Команда</th>
            <th className="ui-table__num">Очки</th>
            <th className="ui-table__num">Отставание</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => {
            const favorite = favoriteDrivers.includes(row.Driver.driverId);
            const displayTeam = row.Constructors?.[0] ?? null;
            return (
              <tr key={row.Driver.driverId} className={favorite ? 'ui-table__favorite' : ''}>
                <td className="ui-table__num f1-cell-position">{row.position ?? DASH}</td>
                <td>
                  <DriverName
                    givenName={row.Driver.givenName}
                    familyName={row.Driver.familyName}
                    size={24}
                  />
                </td>
                <td>
                  {displayTeam ? (
                    <span className="f1-team-inline">
                      <TeamDot color={teamColor(displayTeam.constructorId)} />
                      {displayTeam.name}
                    </span>
                  ) : (
                    DASH
                  )}
                </td>
                <td className="ui-table__num f1-cell-points">{row.points ?? DASH}</td>
                <td className="ui-table__num">{gapToLeader(row.points, leaderPoints)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RosterRow {
  standing: JolpicaDriverStanding;
  currentTeam: JolpicaConstructor | null;
}

function FavoriteDriverRow({
  row,
  leaderPoints,
  latestRound,
  latestRaceName,
  latestEntry,
}: {
  row: RosterRow;
  leaderPoints: string | undefined;
  latestRound: number | null;
  latestRaceName: string | null;
  latestEntry: JolpicaResultEntry | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { standing, currentTeam } = row;
  const displayTeam = currentTeam ?? standing.Constructors?.[0] ?? null;
  const name = `${standing.Driver.givenName} ${standing.Driver.familyName}`;

  return (
    <>
      <tr>
        <td className="f1-col-toggle">
          <IconButton
            small
            aria-label={`${expanded ? 'Скрыть' : 'Показать'} последний результат: ${name}`}
            aria-expanded={expanded}
            icon={
              <ChevronDown
                size={14}
                className={expanded ? 'f1-chevron is-open' : 'f1-chevron'}
                aria-hidden="true"
              />
            }
            onClick={() => setExpanded((value) => !value)}
          />
        </td>
        <td className="ui-table__num f1-cell-position">{standing.position ?? DASH}</td>
        <td>
          <DriverName
            givenName={standing.Driver.givenName}
            familyName={standing.Driver.familyName}
            size={24}
          />
        </td>
        <td>
          {displayTeam ? (
            <span className="f1-team-inline">
              <TeamDot color={teamColor(displayTeam.constructorId)} />
              {displayTeam.name}
              {standing.Driver.code ? <Badge>{standing.Driver.code}</Badge> : null}
            </span>
          ) : (
            DASH
          )}
        </td>
        <td className="ui-table__num f1-cell-points">{standing.points ?? DASH}</td>
        <td className="ui-table__num">{gapToLeader(standing.points, leaderPoints)}</td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6} className="f1-expand-cell">
            <div className="f1-expand">
              {latestEntry && latestRaceName ? (
                <div className="f1-kv f1-kv--column">
                  <span className="f1-muted f1-note-small">
                    {latestRaceName}
                    {latestRound !== null ? ` · Раунд ${latestRound}` : ''}
                  </span>
                  <span>
                    Финиш: <b>{latestEntry.positionText ?? latestEntry.position ?? DASH}</b>
                    {latestEntry.status ? ` (${resultStatusLabel(latestEntry.status)})` : ''}
                  </span>
                  <span>
                    Очки: <b>{latestEntry.points ?? DASH}</b> · Старт:{' '}
                    <b>{latestEntry.grid ?? DASH}</b> · Победы: <b>{standing.wins ?? DASH}</b>
                  </span>
                  {latestEntry.Time?.time ? (
                    <span>
                      Время: <b>{latestEntry.Time.time}</b>
                    </span>
                  ) : null}
                  <span className="f1-muted">
                    Команда в этом этапе: {latestEntry.Constructor.name}
                  </span>
                </div>
              ) : (
                <p className="f1-muted">Нет результата в последней гонке.</p>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FavoriteDriversTable({
  rows,
  leaderPoints,
  latestRound,
  latestRaceName,
  latestByDriver,
}: {
  rows: RosterRow[];
  leaderPoints: string | undefined;
  latestRound: number | null;
  latestRaceName: string | null;
  latestByDriver: Map<string, JolpicaResultEntry>;
}) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table f1-mini-table">
        <thead>
          <tr>
            <th></th>
            <th className="ui-table__num">Поз.</th>
            <th>Пилот</th>
            <th>Команда</th>
            <th className="ui-table__num">Очки</th>
            <th className="ui-table__num">Отставание</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <FavoriteDriverRow
              key={row.standing.Driver.driverId}
              row={row}
              leaderPoints={leaderPoints}
              latestRound={latestRound}
              latestRaceName={latestRaceName}
              latestEntry={latestByDriver.get(row.standing.Driver.driverId) ?? null}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FavoriteTeams({
  rows,
  onToggle,
}: {
  rows: JolpicaConstructorStanding[];
  onToggle: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="f1-fav-teams">
      {rows.map((row) => (
        <Button
          key={row.Constructor.constructorId}
          variant="quiet"
          small
          aria-pressed
          title="Убрать из избранных"
          onClick={() => onToggle(row.Constructor.constructorId)}
        >
          <TeamDot color={teamColor(row.Constructor.constructorId)} />
          {row.Constructor.name}
          <span className="f1-muted">
            {row.position ? `${row.position}-е` : DASH} · {row.points ?? DASH}
          </span>
          <Star size={11} fill="currentColor" aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}

/**
 * Overview tab.
 *
 * Current roster of favourite teams is derived from the *latest verified race
 * results* (`{year}/last/results.json?limit=100`). Driver.driverId in a result
 * is matched to Constructor.constructorId via the entry's own Constructor.
 * We also include manually favourited drivers (e.g. max_verstappen) and
 * de-duplicate by driverId. If latest results are unavailable we do NOT claim
 * that Constructors[] season history is the current roster.
 */
export function Overview({
  onOpenCalendar,
  onOpenStandings,
}: {
  onOpenCalendar?: (round: string) => void;
  onOpenStandings?: () => void;
} = {}) {
  const { year } = useSeason();
  const schedule = useApiResource(
    `${year}-overview-schedule`,
    `${year}.json?limit=100`,
    parseSchedule,
  );
  const dStand = useApiResource(
    `${year}-overview-dstand`,
    `${year}/driverStandings.json`,
    parseDriverStandings,
  );
  const cStand = useApiResource(
    `${year}-overview-cstand`,
    `${year}/constructorStandings.json`,
    parseConstructorStandings,
  );
  const latest = useApiResource(
    `${year}-overview-latest`,
    `${year}/last/results.json?limit=100`,
    transformLatest,
  );
  const [favDrivers] = useFavoriteDrivers();
  const [favTeams, toggleFavTeam] = useFavoriteTeams();
  const now = useNow();

  const races = useMemo(() => schedule.data?.races ?? [], [schedule.data]);
  const next = useMemo(() => nextRace(races, new Date(now)), [races, now]);
  const lastFinishedRace = useMemo(() => latestFinished(races, new Date(now)), [races, now]);
  const driverStandings = useMemo(() => dStand.data?.standings ?? [], [dStand.data]);
  const constructorStandings = useMemo(() => cStand.data?.standings ?? [], [cStand.data]);

  const latestData = latest.data ?? null;
  const latestHasResults = !!(latestData && latestData.race && latestData.results.length > 0);

  // driverId -> constructorId from the latest verified race lineup.
  const latestByDriver = useMemo(() => {
    const m = new Map<string, JolpicaResultEntry>();
    if (!latestHasResults || !latestData) return m;
    for (const entry of latestData.results) m.set(entry.Driver.driverId, entry);
    return m;
  }, [latestData, latestHasResults]);

  // All entries in latest result grouped by constructorId.
  const latestByConstructor = useMemo(() => {
    const m = new Map<string, JolpicaResultEntry[]>();
    if (!latestHasResults || !latestData) return m;
    for (const entry of latestData.results) {
      const cid = entry.Constructor.constructorId;
      const list = m.get(cid);
      if (list) list.push(entry);
      else m.set(cid, [entry]);
    }
    return m;
  }, [latestData, latestHasResults]);

  const standingById = useMemo(() => {
    const m = new Map<string, JolpicaDriverStanding>();
    for (const s of driverStandings) m.set(s.Driver.driverId, s);
    return m;
  }, [driverStandings]);

  /**
   * Roster with dedupe by driverId. If `rosterSource` is 'latest', each
   * currentTeam comes from the latest race entry. Otherwise currentTeam is
   * null and constructors come from standings only (historical label).
   */
  const roster = useMemo<{ rows: RosterRow[]; source: 'latest' | 'standings' | 'none' }>(() => {
    const rows: RosterRow[] = [];
    const seen = new Set<string>();
    const pushStanding = (
      standing: JolpicaDriverStanding,
      currentTeam: JolpicaConstructor | null,
    ) => {
      if (seen.has(standing.Driver.driverId)) return;
      seen.add(standing.Driver.driverId);
      rows.push({ standing, currentTeam });
    };

    if (latestHasResults) {
      // 1) Actually current drivers of favorite constructors.
      for (const cid of favTeams) {
        const entries = latestByConstructor.get(cid) ?? [];
        for (const entry of entries) {
          const s = standingById.get(entry.Driver.driverId);
          if (s) pushStanding(s, entry.Constructor);
        }
      }
      // 2) Manually favorited drivers (Max is favorite).
      for (const did of favDrivers) {
        const s = standingById.get(did);
        if (!s) continue;
        const entry = latestByDriver.get(did);
        pushStanding(s, entry ? entry.Constructor : null);
      }
      rows.sort((a, b) => Number(a.standing.position ?? 999) - Number(b.standing.position ?? 999));
      return { rows, source: 'latest' };
    }

    // Latest results unavailable: do not claim Constructors[] season history
    // is the current roster. Only show per-driver favorite entries with no
    // team attribution beyond the standings table itself.
    for (const did of favDrivers) {
      const s = standingById.get(did);
      if (s) pushStanding(s, null);
    }
    rows.sort((a, b) => Number(a.standing.position ?? 999) - Number(b.standing.position ?? 999));
    return { rows, source: favDrivers.length ? 'standings' : 'none' };
  }, [favTeams, favDrivers, latestHasResults, latestByConstructor, latestByDriver, standingById]);

  const latestLabel = latestData?.race
    ? `${latestData.race.title}${latestData.round !== null ? ` · Раунд ${latestData.round}` : ''}`
    : null;

  const favConstructorRows = useMemo(() => {
    if (!favTeams.length) return [];
    return constructorStandings.filter((c) => favTeams.includes(c.Constructor.constructorId));
  }, [constructorStandings, favTeams]);

  const orderedStandings = useMemo(
    () =>
      [...driverStandings].sort((a, b) => Number(a.position ?? 999) - Number(b.position ?? 999)),
    [driverStandings],
  );
  const leaderPoints = orderedStandings[0]?.points;
  const topFive = orderedStandings.slice(0, 5);
  const leadConstructor = useMemo(
    () =>
      [...constructorStandings].sort(
        (a, b) => Number(a.position ?? 999) - Number(b.position ?? 999),
      )[0] ?? null,
    [constructorStandings],
  );

  // Show the "no current lineup" hint when latest results missing.
  const showLineupWarning = !latest.loading && !latestHasResults && favTeams.length > 0;
  const coverRace = next ?? lastFinishedRace;

  return (
    <>
      <EventCover
        sport="f1"
        eyebrow={`Формула 1 · Сезон ${year}${coverRace ? ` · Этап ${coverRace.round}` : ''}`}
      >
        <h2>{coverRace ? racePresentation(coverRace).title : `Календарь сезона ${year}`}</h2>
        {coverRace ? (
          <>
            <strong>{formatDateTime(parseUtc(coverRace.date, coverRace.time))}</strong>
            <p>{coverRace.Circuit.circuitName}</p>
            <div className="event-cover-actions">
              {onOpenCalendar && (
                <Button variant="primary" onClick={() => onOpenCalendar(coverRace.round)}>
                  Открыть уикенд <CalendarClock size={16} />
                </Button>
              )}
              <span className="event-cover-status">
                {next ? 'Ближайшая гонка' : 'Последний прошедший этап'}
              </span>
            </div>
          </>
        ) : (
          <p>{schedule.loading ? 'Загружаем календарь…' : 'Календарь недоступен.'}</p>
        )}
      </EventCover>

      <div className="f1-overview-grid">
        <Panel className="f1-overview-panel" aria-label="Расписание уикенда">
          <PanelHeader
            title="Расписание уикенда"
            action={next ? <Badge>Этап {next.round}</Badge> : undefined}
          />
          {schedule.loading && !schedule.data ? (
            <State kind="loading" title="Загрузка календаря…" />
          ) : null}
          {schedule.error && !schedule.data ? (
            <State
              kind="error"
              title="Календарь недоступен"
              action={<RetryButton onClick={schedule.reload} details={schedule.error} />}
            />
          ) : null}
          {schedule.data && races.length === 0 ? (
            <State
              kind="empty"
              title={`Календарь сезона ${year} пуст`}
              message="Этапы не объявлены."
            />
          ) : null}
          {schedule.data && races.length > 0 && !next ? (
            <State kind="empty" title={`Сезон ${year} завершён`} message="Все гонки уже прошли." />
          ) : null}
          {next ? <WeekendBody race={next} /> : null}
        </Panel>

        <Panel className="f1-overview-panel" aria-label="Последняя гонка">
          <PanelHeader
            title="Последняя гонка"
            action={
              (latestData?.round ?? lastFinishedRace?.round) ? (
                <Badge>Раунд {latestData?.round ?? lastFinishedRace?.round}</Badge>
              ) : undefined
            }
          />
          {latest.loading && !latestData ? (
            <State kind="loading" title="Загрузка результатов…" />
          ) : null}
          {latest.error && !latestData ? (
            <State
              kind="error"
              title="Результаты недоступны"
              action={<RetryButton onClick={latest.reload} details={latest.error} />}
            />
          ) : null}
          {!latest.loading && !latest.error ? (
            <PodiumBody
              last={latestData ?? EMPTY_LATEST}
              fallbackRound={lastFinishedRace ? Number(lastFinishedRace.round) : null}
              onRetry={latest.reload}
            />
          ) : null}
        </Panel>
      </div>

      <div className="f1-overview-grid f1-overview-favorites">
        <Panel className="f1-overview-panel" aria-label="Чемпионат">
          <PanelHeader
            title="Чемпионат"
            action={
              onOpenStandings ? (
                <Button variant="quiet" small onClick={onOpenStandings}>
                  Все зачёты
                </Button>
              ) : undefined
            }
          />
          {dStand.loading && !dStand.data ? (
            <State kind="loading" title="Загрузка чемпионата…" />
          ) : null}
          {dStand.error && !dStand.data ? (
            <State
              kind="error"
              title="Таблица пилотов недоступна"
              action={<RetryButton onClick={dStand.reload} details={dStand.error} />}
            />
          ) : null}
          {dStand.data && topFive.length === 0 ? (
            <State kind="empty" title="Нет данных чемпионата" />
          ) : null}
          {topFive.length > 0 ? (
            <TopFiveTable
              standings={topFive}
              leaderPoints={leaderPoints}
              favoriteDrivers={favDrivers}
            />
          ) : null}
          {leadConstructor ? (
            <div className="f1-constructor-leader">
              <span className="f1-muted">Кубок конструкторов:</span>
              <span className="f1-constructor-leader-team">
                <TeamDot color={teamColor(leadConstructor.Constructor.constructorId)} />
                <span>{leadConstructor.Constructor.name ?? DASH}</span>
                <span className="f1-muted">, {leadConstructor.points ?? DASH} очков</span>
              </span>
            </div>
          ) : null}
        </Panel>

        <Panel className="f1-overview-panel" aria-label="Избранные пилоты">
          <PanelHeader
            title="Избранные пилоты"
            action={
              showLineupWarning ? (
                <Tooltip label="Состав команд не подтверждён последней гонкой.">
                  <span tabIndex={0}>
                    <Badge variant="warning">неполные данные</Badge>
                  </span>
                </Tooltip>
              ) : undefined
            }
          />
          {favTeams.length > 0 ? (
            <span className="f1-muted">Пилоты избранных команд тоже здесь.</span>
          ) : null}
          {latestHasResults && roster.rows.length === 0 ? (
            <State
              kind="empty"
              title="Нет пилотов избранных команд"
              message="Проверьте избранное."
            />
          ) : null}
          {!latestHasResults && roster.rows.length === 0 ? (
            <State
              kind="empty"
              title="Нет избранных пилотов"
              message="Отметьте пилотов в «Зачётах»."
            />
          ) : null}
          {roster.rows.length > 0 ? (
            <FavoriteDriversTable
              rows={roster.rows}
              leaderPoints={leaderPoints}
              latestRound={latestData?.round ?? null}
              latestRaceName={latestData?.race?.title ?? null}
              latestByDriver={latestByDriver}
            />
          ) : null}
          <FavoriteTeams rows={favConstructorRows} onToggle={toggleFavTeam} />
          {favTeams.length > 0 && favConstructorRows.length === 0 && cStand.data ? (
            <span className="f1-muted">Нет в таблице сезона {year}.</span>
          ) : null}
        </Panel>
      </div>

      <SourceBar
        source={schedule.source}
        fetchedAt={schedule.fetchedAt}
        stale={schedule.stale}
        onRefresh={schedule.reload}
        refreshing={schedule.loading}
      />
      <SourceBar
        source={latest.source}
        fetchedAt={latest.fetchedAt}
        stale={latest.stale}
        onRefresh={latest.reload}
        refreshing={latest.loading}
      />
      <SourceBar
        source={dStand.source}
        fetchedAt={dStand.fetchedAt}
        stale={dStand.stale}
        onRefresh={dStand.reload}
        refreshing={dStand.loading}
      />
      <SourceBar
        source={cStand.source}
        fetchedAt={cStand.fetchedAt}
        stale={cStand.stale}
        onRefresh={cStand.reload}
        refreshing={cStand.loading}
      />
    </>
  );
}

// Re-export small helper for reuse in Standings view.
export { isFinished };
