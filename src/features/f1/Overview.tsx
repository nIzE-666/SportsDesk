import { useMemo, useState } from 'react';
import { CalendarClock, Trophy, Flag, Users, Star } from 'lucide-react';
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
} from './types';
import { parseUtc, formatDateTime, formatShort } from './time';
import { teamColor } from './teamColors';
import { useFavoriteDrivers, useFavoriteTeams } from './useFavorites';
import { useSeason } from './SeasonContext';
import { SourceBar, State, TeamDot, DriverName, type F1Style } from './shared';
import { Badge, Button } from '../../kit';
import { useNow } from '../../lib/useNow';
import { EventCover } from '../../components/EventCover';
import { grandPrixTitle, racePresentation } from './calendarModel';

/**
 * Latest verified race results.
 * Fetched once at Overview level and shared by the latest-race card and
 * favorite-driver cards, so we do not issue one request per card.
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

function SessionRow({ label, d }: { label: string; d?: { date?: string; time?: string } }) {
  const dt = d?.date ? parseUtc(d.date, d.time) : null;
  return (
    <div className="f1-session-row">
      <span className="f1-muted">{label}</span>
      <span className="f1-num">{formatDateTime(dt)}</span>
    </div>
  );
}

function WeekendCard({ race }: { race: JolpicaRace }) {
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
    <div className="f1-card hl">
      <div className="f1-card-head">
        <div>
          <div className="f1-eyebrow">
            {racePresentation(race).title} · Раунд {race.round}
          </div>
          <h2 className="f1-title f1-title--tight">Расписание уикенда</h2>
          <div className="f1-muted f1-muted--tight">
            {circuit.circuitName}
            {loc?.locality ? ` · ${loc.locality}` : ''}
            {loc?.country ? `, ${loc.country}` : ''}
          </div>
        </div>
        <Flag size={22} className="f1-icon-accent" aria-hidden="true" />
      </div>
      <div>
        {sessions.map((s) => (
          <SessionRow key={s.label} label={s.label} d={s.d} />
        ))}
      </div>
      <div className="f1-muted f1-note-small">
        Время в вашем часовом поясе (настраивается в параметрах приложения).
      </div>
    </div>
  );
}

interface PodiumItem {
  place: number;
  entry: JolpicaResultEntry | undefined;
}

function LatestRaceCard({
  last,
  fallbackRound,
}: {
  last: LatestRaceData;
  fallbackRound: number | null;
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

  return (
    <div className="f1-card">
      <div className="f1-card-head">
        <div>
          <div className="f1-eyebrow">
            Последняя гонка{roundLabel ? ` · Раунд ${roundLabel}` : ''}
          </div>
          <div className="f1-title f1-title--tight f1-title--race">
            {last.race ? last.race.title : 'Нет данных'}
          </div>
          {last.race ? (
            <div className="f1-muted">
              {last.race.Circuit.circuitName}
              {last.race.Circuit.Location?.country
                ? ` · ${last.race.Circuit.Location.country}`
                : ''}
            </div>
          ) : null}
        </div>
        <Trophy size={20} className="f1-icon-accent" aria-hidden="true" />
      </div>

      {!last.race && fallbackRound === null ? (
        <State kind="empty" title="Нет завершённых гонок в сезоне">
          Результаты этого сезона недоступны.
        </State>
      ) : null}

      {!last.race && fallbackRound !== null ? (
        <State kind="empty" title="Результаты последней гонки недоступны">
          Данные раунда {fallbackRound} не получены. Попробуйте обновить.
        </State>
      ) : null}

      {last.race && last.results.length === 0 ? (
        <State kind="empty" title="Нет данных о результатах">
          Результаты этого этапа недоступны.
        </State>
      ) : null}

      {summary && last.race ? (
        <div className="f1-podium">
          {summary.podium.map(({ place, entry }) => {
            if (!entry) return null;
            return (
              <div key={entry.Driver.driverId} className="f1-podium-row">
                <span className={place === 1 ? 'f1-podium-place is-first' : 'f1-podium-place'}>
                  {place}
                </span>
                <div>
                  <div>
                    <DriverName
                      givenName={entry.Driver.givenName}
                      familyName={entry.Driver.familyName}
                    />
                  </div>
                  <div className="f1-muted f1-inline">
                    <TeamDot color={teamColor(entry.Constructor.constructorId)} />
                    {entry.Constructor.name}
                  </div>
                </div>
                <div className="f1-podium-right">
                  {place === 1 ? (
                    <div className="f1-num f1-note-small">Победитель</div>
                  ) : entry.Time?.time ? (
                    <div className="f1-num f1-note-small">{entry.Time.time}</div>
                  ) : null}
                  {entry.FastestLap?.rank === '1' && entry.FastestLap.Time?.time ? (
                    <div className="f1-muted">БК {entry.FastestLap.Time.time}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div className="f1-kv f1-kv--spaced">
            <span>
              Финишировали: <b>{summary.finishedCount}</b>
            </span>
            <span>
              Сходы: <b>{summary.retirements}</b>
            </span>
            <span className="f1-muted">
              Дата: {formatShort(parseUtc(last.race.date, last.race.time))}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface FavoriteDriverCardProps {
  standing: JolpicaDriverStanding;
  /** Constructor from the latest verified race result, when available. */
  currentTeam: JolpicaConstructor | null;
  lineupSourceLabel: string | null;
  latestRound: number | null;
  latestRaceName: string | null;
  latestEntry: JolpicaResultEntry | null;
}

function FavoriteDriverCard({
  standing,
  currentTeam,
  lineupSourceLabel,
  latestRound,
  latestRaceName,
  latestEntry,
}: FavoriteDriverCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [favTeams, toggleTeam] = useFavoriteTeams();

  // Team to display: actual current team from the latest race if we have it,
  // otherwise the first constructor listed in season standings.
  const displayTeam = currentTeam ?? standing.Constructors?.[0] ?? null;
  const teamIsFromLatest = !!currentTeam;
  const isFavTeam = displayTeam ? favTeams.includes(displayTeam.constructorId) : false;

  return (
    <div className="f1-card f1-card--driver">
      <div className="f1-driver-head">
        <div className="f1-big f1-big--position">{standing.position ?? '—'}</div>
        <div className="f1-driver-main">
          <div className="f1-driver-name">
            <DriverName
              givenName={standing.Driver.givenName}
              familyName={standing.Driver.familyName}
            />
          </div>
          <div className="f1-muted f1-driver-team">
            {displayTeam ? (
              <Button
                type="button"
                variant="quiet"
                small
                className="f1-team-chip"
                onClick={() => toggleTeam(displayTeam.constructorId)}
                title="Отметить команду избранной"
                style={
                  {
                    '--team-color': teamColor(displayTeam.constructorId),
                  } as F1Style
                }
              >
                <TeamDot color={teamColor(displayTeam.constructorId)} />
                {displayTeam.name}
                {isFavTeam ? <Star size={11} fill="currentColor" aria-hidden="true" /> : null}
              </Button>
            ) : (
              <span>Команда не указана</span>
            )}
            {standing.Driver.code ? <Badge>{standing.Driver.code}</Badge> : null}
          </div>
          {teamIsFromLatest && lineupSourceLabel ? (
            <div className="f1-muted f1-note-tight">
              Текущая команда по составу: {lineupSourceLabel}
            </div>
          ) : null}
        </div>
        <div className="f1-driver-points">
          <div className="f1-points f1-points--big">{standing.points ?? '—'}</div>
          <div className="f1-muted">очков</div>
        </div>
      </div>
      <div className="f1-kv">
        <span>
          Победы: <b>{standing.wins ?? '—'}</b>
        </span>
        {displayTeam && (standing.Constructors?.length ?? 0) > 1 ? (
          <span title="В таблице указано несколько команд в сезоне">
            <Badge variant="warning">Команд в сезоне: {standing.Constructors?.length}</Badge>
          </span>
        ) : null}
      </div>
      <Button
        type="button"
        variant="quiet"
        small
        className="f1-expand-button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? 'Скрыть последний результат' : 'Показать последний результат'}
      </Button>
      {expanded ? (
        <div>
          {latestEntry && latestRaceName ? (
            <div className="f1-kv f1-kv--column">
              <div className="f1-muted f1-note-small">
                {latestRaceName}
                {latestRound !== null ? ` · Раунд ${latestRound}` : ''}
              </div>
              <span>
                Финиш: <b>{latestEntry.positionText ?? latestEntry.position ?? '—'}</b>
                {latestEntry.status ? ` (${latestEntry.status})` : ''}
              </span>
              <span>
                Очки: <b>{latestEntry.points ?? '—'}</b> · Старт: <b>{latestEntry.grid ?? '—'}</b>
              </span>
              {latestEntry.Time?.time ? (
                <span>
                  Время: <b>{latestEntry.Time.time}</b>
                </span>
              ) : null}
              <span className="f1-muted">Команда в этом этапе: {latestEntry.Constructor.name}</span>
            </div>
          ) : (
            <State kind="empty" title="Пилот не найден в последнем результате">
              В последней гонке сезона этот пилот не участвовал или результаты недоступны.
            </State>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface RosterRow {
  standing: JolpicaDriverStanding;
  currentTeam: JolpicaConstructor | null;
}

/**
 * Overview tab.
 *
 * Current roster of favorite teams is derived from the *latest verified race
 * results* (`{year}/last/results.json?limit=100`). Driver.driverId in a result
 * is matched to Constructor.constructorId via the entry's own Constructor.
 * We also include manually favorited drivers (e.g. max_verstappen) and
 * de-duplicate by driverId. If latest results are unavailable we do NOT claim
 * that Constructors[] season history is the current roster.
 */
export function Overview({ onOpenCalendar }: { onOpenCalendar?: (round: string) => void } = {}) {
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
  const [favTeams] = useFavoriteTeams();
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
      return { rows, source: 'latest' };
    }

    // Latest results unavailable: do not claim Constructors[] season history
    // is the current roster. Only show per-driver favorite entries with no
    // team attribution beyond the standings table itself.
    for (const did of favDrivers) {
      const s = standingById.get(did);
      if (s) pushStanding(s, null);
    }
    return { rows, source: favDrivers.length ? 'standings' : 'none' };
  }, [favTeams, favDrivers, latestHasResults, latestByConstructor, latestByDriver, standingById]);

  const latestLabel = latestData?.race
    ? `${latestData.race.title}${latestData.round !== null ? ` · Раунд ${latestData.round}` : ''}`
    : null;

  const favConstructorRows = useMemo(() => {
    if (!favTeams.length) return [];
    return constructorStandings.filter((c) => favTeams.includes(c.Constructor.constructorId));
  }, [constructorStandings, favTeams]);

  const rule = driverStandings.length > 0 ? String(driverStandings.length) : '—';

  const leadDriver: JolpicaDriverStanding | undefined = driverStandings[0];
  const leadCons = constructorStandings[0];

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
          <p>
            {schedule.loading
              ? 'Загружаем календарь и расписание сессий.'
              : 'Календарь недоступен.'}
          </p>
        )}
      </EventCover>
      <div className="f1-grid f1-overview-grid">
        <div className="f1-overview-column">
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
          {schedule.loading && !schedule.data ? (
            <State kind="loading" title="Загрузка календаря сезона…" />
          ) : null}
          {schedule.error && !schedule.data ? (
            <State kind="error" title="Календарь недоступен">
              {schedule.error}
            </State>
          ) : null}
          {schedule.data && races.length === 0 ? (
            <State kind="empty" title={`Календарь сезона ${year} пуст`}>
              Этапы этого сезона недоступны.
            </State>
          ) : null}
          {schedule.data && races.length > 0 && !next ? (
            <State kind="empty" title={`Сезон ${year} завершён`}>
              Все гонки сезона уже прошли.
            </State>
          ) : null}
          {next ? <WeekendCard race={next} /> : null}

          {latest.loading && !latestData ? (
            <State kind="loading" title="Загрузка результатов последней гонки…" />
          ) : null}
          {latest.error && !latestData ? (
            <State kind="error" title="Результаты последней гонки недоступны">
              {latest.error}
            </State>
          ) : null}
          {!latest.loading && !latest.error ? (
            <LatestRaceCard
              last={latestData ?? EMPTY_LATEST}
              fallbackRound={lastFinishedRace ? Number(lastFinishedRace.round) : null}
            />
          ) : null}
        </div>

        <div className="f1-overview-column">
          <div className="f1-card">
            <div className="f1-card-head">
              <div className="f1-eyebrow">Чемпионат · Сезон {year}</div>
              <Users size={16} className="f1-icon-muted" aria-hidden="true" />
            </div>
            {dStand.loading && !dStand.data ? (
              <State kind="loading" title="Загрузка лидеров…" />
            ) : null}
            {dStand.error && !dStand.data ? (
              <State kind="error" title="Таблица пилотов недоступна">
                {dStand.error}
              </State>
            ) : null}
            {leadDriver ? (
              <div className="f1-stack">
                <div>
                  <div className="f1-muted f1-note-small">Лидер пилотов</div>
                  <div className="f1-leader-name">
                    <DriverName
                      givenName={leadDriver.Driver.givenName}
                      familyName={leadDriver.Driver.familyName}
                    />
                  </div>
                  <div className="f1-muted f1-inline">
                    {leadDriver.Constructors?.[0] ? (
                      <TeamDot color={teamColor(leadDriver.Constructors[0].constructorId)} />
                    ) : null}
                    {leadDriver.Constructors?.[0]?.name ?? '—'}
                  </div>
                </div>
                <div className="f1-kv">
                  <span>
                    Очки: <b>{leadDriver.points ?? '—'}</b>
                  </span>
                  <span>
                    Победы: <b>{leadDriver.wins ?? '—'}</b>
                  </span>
                </div>
              </div>
            ) : null}
            {leadCons ? (
              <div className="f1-leader-divider">
                <div className="f1-muted f1-note-small">Лидер Кубка конструкторов</div>
                <div className="f1-inline f1-leader-team">
                  <TeamDot color={teamColor(leadCons.Constructor.constructorId)} />
                  <b className="f1-strong">{leadCons.Constructor.name}</b>
                </div>
                <div className="f1-kv f1-kv--tight">
                  <span>
                    Очки: <b>{leadCons.points ?? '—'}</b>
                  </span>
                  <span>
                    Победы: <b>{leadCons.wins ?? '—'}</b>
                  </span>
                </div>
              </div>
            ) : null}
            <div className="f1-muted f1-note-tight">Пилотов в чемпионате: {rule}</div>
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
          </div>
        </div>
      </div>
      <div className="f1-grid f1-overview-favorites">
        <div className="f1-card">
          <div className="f1-card-head">
            <div className="f1-eyebrow">Пилоты избранных команд и избранные пилоты</div>
            <CalendarClock size={16} className="f1-icon-muted" aria-hidden="true" />
          </div>
          <div className="f1-muted f1-note-tight">
            {latestHasResults && latestLabel ? (
              <span>
                Текущий состав по последней проверенной гонке:{' '}
                <b className="f1-strong">{latestLabel}</b>. Избранные команды:{' '}
                {favTeams.length > 0
                  ? favTeams
                      .map(
                        (id) =>
                          constructorStandings.find((c) => c.Constructor.constructorId === id)
                            ?.Constructor.name ?? id,
                      )
                      .join(', ')
                  : 'не выбраны'}
                .
              </span>
            ) : (
              <span>
                Результаты последней гонки недоступны — состав избранных команд не может быть
                подтверждён. Показаны только избранные пилоты из таблицы чемпионата.
              </span>
            )}
          </div>
          {latestHasResults && roster.rows.length === 0 ? (
            <State kind="empty" title="В последней гонке нет пилотов избранных команд">
              Ни один пилот с избранными командами не найден в результатах. Проверьте избранные
              команды и обновите данные.
            </State>
          ) : null}
          {!latestHasResults && roster.rows.length === 0 ? (
            <State kind="empty" title="Нет данных для избранных пилотов">
              Отметьте пилотов и команды ★ во вкладке «Зачёты».
            </State>
          ) : null}
          {showLineupWarning ? (
            <div>
              <Badge variant="warning">
                Состав избранных команд не подтверждён последней гонкой
              </Badge>
            </div>
          ) : null}
          <div className="f1-stack">
            {roster.rows.map(({ standing, currentTeam }) => {
              const entry = latestByDriver.get(standing.Driver.driverId) ?? null;
              return (
                <FavoriteDriverCard
                  key={standing.Driver.driverId}
                  standing={standing}
                  currentTeam={currentTeam}
                  lineupSourceLabel={latestHasResults && currentTeam ? latestLabel : null}
                  latestRound={latestData?.round ?? null}
                  latestRaceName={latestData?.race?.title ?? null}
                  latestEntry={entry}
                />
              );
            })}
          </div>
        </div>

        <div className="f1-card">
          <div className="f1-eyebrow">Избранные команды</div>
          {favTeams.length === 0 ? (
            <State kind="empty" title="Нет избранных команд">
              Отметьте команды в таблице конструкторов.
            </State>
          ) : favConstructorRows.length === 0 && cStand.data ? (
            <div className="f1-muted f1-note-small">
              Избранные команды отсутствуют в таблице сезона {year}.
            </div>
          ) : (
            <div className="f1-list">
              {favConstructorRows.map((c) => (
                <div key={c.Constructor.constructorId} className="f1-row">
                  <span className="f1-pos">{c.position ?? '—'}</span>
                  <TeamDot color={teamColor(c.Constructor.constructorId)} />
                  <span className="f1-row-name">{c.Constructor.name}</span>
                  <span className="f1-points">{c.points ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Re-export small helper for reuse in Standings view.
export { isFinished };
