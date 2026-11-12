import { PersonAvatar } from '../../components/PersonAvatar';
import { CircleDot, Radio, Timer } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useViewState } from '../../lib/useViewState';
import { useSeason } from './SeasonContext';
import { RacePacePanel } from './RacePacePanel';
import { asArray, useApiResource } from './api';
import { grandPrixTitle } from './calendarModel';
import { SourceBar, State } from './shared';
import { openF1Color } from './teamColors';
import { formatDate, formatShort, parseUtc } from './time';
import type {
  OpenF1Driver,
  OpenF1Lap,
  OpenF1Meeting,
  OpenF1Pit,
  OpenF1Session,
  OpenF1Stint,
} from './types';

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** OpenF1 names meetings in English; show the Russian name the calendar uses. */
function meetingTitle(meeting: OpenF1Meeting): string | null {
  const name = meeting.meeting_name ?? meeting.meeting_official_name;
  return name ? grandPrixTitle(name).title : null;
}

function parseMeetings(payload: unknown): OpenF1Meeting[] {
  const out: OpenF1Meeting[] = [];
  for (const raw of asArray(payload)) {
    const o = obj(raw);
    if (!o) continue;
    const key = num(o.meeting_key);
    if (key === null) continue;
    out.push({
      meeting_key: key,
      meeting_name: str(o.meeting_name),
      meeting_official_name: str(o.meeting_official_name),
      location: str(o.location),
      country_name: str(o.country_name),
      country_code: str(o.country_code),
      circuit_short_name: str(o.circuit_short_name),
      date_start: str(o.date_start),
      date_end: str(o.date_end),
      year: num(o.year) ?? undefined,
    });
  }
  return out.sort((a, b) => (b.date_start ?? '').localeCompare(a.date_start ?? ''));
}

function parseSessions(payload: unknown): OpenF1Session[] {
  const out: OpenF1Session[] = [];
  for (const raw of asArray(payload)) {
    const o = obj(raw);
    if (!o) continue;
    const sk = num(o.session_key);
    const mk = num(o.meeting_key);
    if (sk === null || mk === null) continue;
    out.push({
      session_key: sk,
      meeting_key: mk,
      session_name: str(o.session_name),
      session_type: str(o.session_type),
      date_start: str(o.date_start),
      date_end: str(o.date_end),
      status: str(o.status),
      year: num(o.year) ?? undefined,
      circuit_short_name: str(o.circuit_short_name),
      location: str(o.location),
      country_name: str(o.country_name),
    });
  }
  return out.sort((a, b) => (a.date_start ?? '').localeCompare(b.date_start ?? ''));
}

function parseDrivers(payload: unknown): OpenF1Driver[] {
  const out: OpenF1Driver[] = [];
  const seen = new Set<number>();
  for (const raw of asArray(payload)) {
    const o = obj(raw);
    if (!o) continue;
    const dn = num(o.driver_number);
    if (dn === null || seen.has(dn)) continue;
    seen.add(dn);
    out.push({
      driver_number: dn,
      full_name: str(o.full_name),
      first_name: str(o.first_name),
      last_name: str(o.last_name),
      name_acronym: str(o.name_acronym),
      team_name: str(o.team_name),
      team_colour: str(o.team_colour),
      headshot_url: typeof o.headshot_url === 'string' ? o.headshot_url : null,
      session_key: num(o.session_key) ?? undefined,
      meeting_key: num(o.meeting_key) ?? undefined,
    });
  }
  return out.sort((a, b) => a.driver_number - b.driver_number);
}

function parseLaps(payload: unknown): OpenF1Lap[] {
  const out: OpenF1Lap[] = [];
  for (const raw of asArray(payload)) {
    const o = obj(raw);
    if (!o) continue;
    const dn = num(o.driver_number);
    if (dn === null) continue;
    out.push({
      driver_number: dn,
      lap_number: num(o.lap_number) ?? undefined,
      lap_duration: num(o.lap_duration),
      duration_sector_1: num(o.duration_sector_1),
      duration_sector_2: num(o.duration_sector_2),
      duration_sector_3: num(o.duration_sector_3),
      st_speed: num(o.st_speed),
      is_pit_out_lap: o.is_pit_out_lap === true,
      date_start: str(o.date_start),
      session_key: num(o.session_key) ?? undefined,
    });
  }
  return out;
}

function parseStints(payload: unknown): OpenF1Stint[] {
  const out: OpenF1Stint[] = [];
  for (const raw of asArray(payload)) {
    const o = obj(raw);
    if (!o) continue;
    const dn = num(o.driver_number);
    if (dn === null) continue;
    out.push({
      driver_number: dn,
      stint_number: num(o.stint_number) ?? undefined,
      lap_start: num(o.lap_start) ?? undefined,
      lap_end: num(o.lap_end) ?? undefined,
      compound: str(o.compound) ?? null,
      tyre_age_at_start: num(o.tyre_age_at_start),
      session_key: num(o.session_key) ?? undefined,
    });
  }
  return out.sort((a, b) => (a.stint_number ?? 0) - (b.stint_number ?? 0));
}

function parsePits(payload: unknown): OpenF1Pit[] {
  const out: OpenF1Pit[] = [];
  for (const raw of asArray(payload)) {
    const o = obj(raw);
    if (!o) continue;
    const dn = num(o.driver_number);
    if (dn === null) continue;
    out.push({
      driver_number: dn,
      lap_number: num(o.lap_number) ?? undefined,
      pit_duration: num(o.pit_duration),
      session_key: num(o.session_key) ?? undefined,
    });
  }
  return out.sort((a, b) => (a.lap_number ?? 0) - (b.lap_number ?? 0));
}

export function parseOpenF1Meetings(payload: unknown): OpenF1Meeting[] {
  return parseMeetings(payload);
}
export function parseOpenF1Sessions(payload: unknown): OpenF1Session[] {
  return parseSessions(payload);
}
export function parseOpenF1Drivers(payload: unknown): OpenF1Driver[] {
  return parseDrivers(payload);
}
export function parseOpenF1Laps(payload: unknown): OpenF1Lap[] {
  return parseLaps(payload);
}
export function parseOpenF1Stints(payload: unknown): OpenF1Stint[] {
  return parseStints(payload);
}
export function parseOpenF1Pits(payload: unknown): OpenF1Pit[] {
  return parsePits(payload);
}

function compoundColor(compound: string | null | undefined): string {
  const c = (compound ?? '').toLowerCase();
  if (c === 'soft') return '#ff4d4d';
  if (c === 'medium') return '#ffd24d';
  if (c === 'hard') return '#e6e6e6';
  if (c === 'intermediate') return '#4ddd78';
  if (c === 'wet') return '#3d9bff';
  return '#6b7280';
}

function compoundLabel(compound: string | null | undefined): string {
  const c = (compound ?? '').toLowerCase();
  if (c === 'soft') return 'S';
  if (c === 'medium') return 'M';
  if (c === 'hard') return 'H';
  if (c === 'intermediate') return 'I';
  if (c === 'wet') return 'W';
  return '?';
}

function fmtLap(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  if (m > 0) return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  return s.toFixed(3);
}

function driverName(d: OpenF1Driver): string {
  if (d.full_name) return d.full_name;
  const parts = [d.first_name, d.last_name].filter((p): p is string => !!p);
  return parts.length ? parts.join(' ') : `№${d.driver_number}`;
}

function sessionShortDate(s: OpenF1Session): string | null {
  if (!s.date_start) return null;
  return formatShort(parseUtc(s.date_start.slice(0, 10), s.date_start.slice(11)));
}

/**
 * A session is "completed" when its date_end is strictly before now.
 */
function isCompleted(s: OpenF1Session, now: number): boolean {
  if (!s.date_end) return false;
  const dt = parseUtc(s.date_end.slice(0, 10), s.date_end.slice(11));
  return !!dt && dt.getTime() < now;
}

/**
 * A meeting is "completed" when its date_end is strictly before now.
 */
function isMeetingCompleted(m: OpenF1Meeting, now: number): boolean {
  if (!m.date_end) return false;
  const dt = parseUtc(m.date_end.slice(0, 10), m.date_end.slice(11));
  return !!dt && dt.getTime() < now;
}

/**
 * Default session selection order for a completed meeting:
 *   1) Race, if completed;
 *   2) otherwise the latest completed previous session.
 * Only sessions with `date_end < now` qualify for the default auto-selection.
 * Future sessions remain manually selectable from the dropdown.
 */
function pickDefaultSession(sessions: OpenF1Session[], now: number): OpenF1Session | null {
  const completed = sessions.filter((s) => isCompleted(s, now));
  if (completed.length === 0) return null;
  const races = completed.filter(
    (s) =>
      (s.session_type ?? '').toLowerCase() === 'race' ||
      (s.session_name ?? '').toLowerCase() === 'race',
  );
  if (races.length > 0) {
    // The race is unique; if multiple, use the one with the latest date_end.
    return races.reduce((best, cur) => ((cur.date_end ?? '') > (best.date_end ?? '') ? cur : best));
  }
  return completed.reduce((best, cur) =>
    (cur.date_end ?? '') > (best.date_end ?? '') ? cur : best,
  );
}

/**
 * Default meeting selection: the most recent COMPLETED meeting.
 * In-progress/upcoming meetings are excluded from the default but remain
 * selectable in the list.
 */
function pickDefaultMeeting(meetings: OpenF1Meeting[], now: number): OpenF1Meeting | null {
  const completed = meetings.filter((m) => isMeetingCompleted(m, now));
  if (completed.length === 0) return null;
  return completed.reduce((best, cur) =>
    (cur.date_end ?? '') > (best.date_end ?? '') ? cur : best,
  );
}

export function Session({ mode = 'all' }: { mode?: 'all' | 'pace' }) {
  const { year: selectedYear } = useSeason();
  const [meetingKey, setMeetingKey] = useViewState<number | null>(
    `f1.openf1.${selectedYear}.meeting`,
    null,
    (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0),
  );
  const [sessionKey, setSessionKey] = useViewState<number | null>(
    `f1.openf1.${selectedYear}.${meetingKey}.session`,
    null,
    (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0),
  );
  const [driverNumber, setDriverNumber] = useViewState<number | null>(
    `f1.openf1.${selectedYear}.${sessionKey}.driver`,
    null,
    (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0),
  );

  const meetings = useApiResource(
    `openf1-meetings-${selectedYear}`,
    `meetings?year=${selectedYear}`,
    parseOpenF1Meetings,
    { source: 'openf1', enabled: selectedYear >= 2023 },
  );

  const meetingList = useMemo(() => meetings.data ?? [], [meetings.data]);

  // Auto-select the most recent COMPLETED meeting once the list is loaded.
  // Only run when there is no explicit selection already made.
  useEffect(() => {
    if (meetingKey !== null) return;
    if (meetingList.length === 0) return;
    const now = Date.now();
    const def = pickDefaultMeeting(meetingList, now);
    if (def) setMeetingKey(def.meeting_key);
  }, [meetingList, meetingKey]);

  const sessions = useApiResource(
    `openf1-sessions-${meetingKey ?? 'none'}`,
    meetingKey !== null ? `sessions?meeting_key=${meetingKey}` : null,
    parseOpenF1Sessions,
    { source: 'openf1' },
  );

  const sessionList = useMemo(() => sessions.data ?? [], [sessions.data]);

  // Auto-select the default COMPLETED session for the meeting:
  // Race if completed, otherwise the latest completed earlier session.
  useEffect(() => {
    if (sessionKey !== null) return;
    if (sessionList.length === 0) return;
    const now = Date.now();
    const def = pickDefaultSession(sessionList, now);
    if (def) setSessionKey(def.session_key);
  }, [sessionList, sessionKey]);

  const drivers = useApiResource(
    `openf1-drivers-${sessionKey ?? 'none'}`,
    sessionKey !== null ? `drivers?session_key=${sessionKey}` : null,
    parseOpenF1Drivers,
    { source: 'openf1' },
  );

  const driverList = useMemo(() => drivers.data ?? [], [drivers.data]);

  useEffect(() => {
    if (driverNumber !== null) return;
    const first = driverList[0];
    if (first) setDriverNumber(first.driver_number);
  }, [driverList, driverNumber]);

  const selectedMeeting = useMemo(
    () => meetingList.find((m) => m.meeting_key === meetingKey) ?? null,
    [meetingList, meetingKey],
  );
  const selectedSession = useMemo(
    () => sessionList.find((s) => s.session_key === sessionKey) ?? null,
    [sessionList, sessionKey],
  );

  const driverParam = driverNumber !== null ? `&driver_number=${driverNumber}` : '';

  const laps = useApiResource(
    `openf1-laps-${sessionKey ?? 'none'}-${driverNumber ?? 'none'}`,
    sessionKey !== null && driverNumber !== null
      ? `laps?session_key=${sessionKey}${driverParam}`
      : null,
    parseOpenF1Laps,
    { source: 'openf1', enabled: mode !== 'pace' },
  );

  const stints = useApiResource(
    `openf1-stints-${sessionKey ?? 'none'}-${driverNumber ?? 'none'}`,
    sessionKey !== null && driverNumber !== null
      ? `stints?session_key=${sessionKey}${driverParam}`
      : null,
    parseOpenF1Stints,
    { source: 'openf1', enabled: mode !== 'pace' },
  );

  const pits = useApiResource(
    `openf1-pits-${sessionKey ?? 'none'}-${driverNumber ?? 'none'}`,
    sessionKey !== null && driverNumber !== null
      ? `pit?session_key=${sessionKey}${driverParam}`
      : null,
    parseOpenF1Pits,
    { source: 'openf1', enabled: mode !== 'pace' },
  );

  const selectedDriver = useMemo(
    () => driverList.find((d) => d.driver_number === driverNumber) ?? null,
    [driverList, driverNumber],
  );

  const lapRows = useMemo(() => laps.data ?? [], [laps.data]);
  const stintRows = useMemo(() => stints.data ?? [], [stints.data]);
  const pitRows = useMemo(() => pits.data ?? [], [pits.data]);

  const lapStats = useMemo(() => {
    const timings: number[] = [];
    for (const l of lapRows) {
      if (typeof l.lap_duration === 'number' && Number.isFinite(l.lap_duration))
        timings.push(l.lap_duration);
    }
    if (timings.length === 0) return null;
    let best: number | null = null;
    let sum = 0;
    for (const v of timings) {
      sum += v;
      if (best === null || v < best) best = v;
    }
    return { count: timings.length, best, avg: sum / timings.length };
  }, [lapRows]);

  const fastestLaps = useMemo(() => {
    const list = lapRows.filter(
      (l) => typeof l.lap_duration === 'number' && Number.isFinite(l.lap_duration),
    );
    return [...list].sort((a, b) => Number(a.lap_duration) - Number(b.lap_duration)).slice(0, 8);
  }, [lapRows]);

  const stintTotal = useMemo(() => {
    return stintRows.reduce((max, s) => Math.max(max, s.lap_end ?? 0), 0);
  }, [stintRows]);

  const sessionsEmptyForMeeting =
    selectedMeeting !== null && !sessions.loading && !sessions.error && sessionList.length === 0;
  const noCompletedSession =
    selectedMeeting !== null &&
    !sessions.loading &&
    !sessions.error &&
    sessionList.length > 0 &&
    pickDefaultSession(sessionList, Date.now()) === null;

  const liveNote = (
    <div className="f1-pill warn" title="Живые данные недоступны: только история">
      <Radio size={12} aria-hidden="true" /> Прямая телеметрия недоступна
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="f1-card">
        <div className="f1-card-head">
          <div>
            <div className="f1-eyebrow">Сессии · исторические данные</div>
            <div className="f1-title" style={{ marginTop: 4, fontSize: 20 }}>
              {mode === 'pace' ? 'Темп пилотов внутри гонки' : 'Обзор гоночных сессий'}
            </div>
          </div>
          {liveNote}
        </div>
        <div className="f1-muted" style={{ fontSize: 12 }}>
          Данные с 2023 года, через 30 минут после сессии.
        </div>
        <div className="f1-toolbar">
          <label className="f1-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Гран-при
            <select
              className="f1-select"
              value={meetingKey ?? ''}
              onChange={(e) => setMeetingKey(e.target.value ? Number(e.target.value) : null)}
              aria-label="Гран-при"
              disabled={meetingList.length === 0}
            >
              {meetingList.length === 0 ? <option value="">Нет данных</option> : null}
              {meetingList.map((m) => (
                <option key={m.meeting_key} value={m.meeting_key}>
                  {meetingTitle(m) ?? `Митап ${m.meeting_key}`}
                  {m.location ? ` — ${m.location}` : ''}
                  {isMeetingCompleted(m, Date.now()) ? '' : ' (не завершён)'}
                </option>
              ))}
            </select>
          </label>
          <label className="f1-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Сессия
            <select
              className="f1-select"
              value={sessionKey ?? ''}
              onChange={(e) => setSessionKey(e.target.value ? Number(e.target.value) : null)}
              aria-label="Сессия"
              disabled={sessionList.length === 0}
            >
              {sessionList.length === 0 ? <option value="">Нет данных</option> : null}
              {sessionList.map((s) => {
                const date = sessionShortDate(s);
                const done = isCompleted(s, Date.now());
                return (
                  <option key={s.session_key} value={s.session_key}>
                    {s.session_name ?? `Сессия ${s.session_key}`}
                    {date ? ` · ${date}` : ''}
                    {done ? '' : ' (предстоит)'}
                  </option>
                );
              })}
            </select>
          </label>
          {mode !== 'pace' && (
            <label className="f1-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Пилот
              <select
                className="f1-select"
                value={driverNumber ?? ''}
                onChange={(e) => setDriverNumber(e.target.value ? Number(e.target.value) : null)}
                aria-label="Пилот"
                disabled={driverList.length === 0}
              >
                {driverList.length === 0 ? <option value="">Нет данных</option> : null}
                {driverList.map((d) => (
                  <option key={d.driver_number} value={d.driver_number}>
                    №{d.driver_number} {driverName(d)}
                    {d.team_name ? ` · ${d.team_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {meetings.loading && !meetings.data ? (
          <State kind="loading" title="Загрузка календаря…" />
        ) : null}
        {meetings.error && !meetings.data ? (
          <State kind="error" title="Не удалось загрузить список Гран-при">
            {meetings.error}
          </State>
        ) : null}
        {!meetings.loading && !meetings.error && meetingList.length === 0 ? (
          <State kind="empty" title={`Нет данных за ${selectedYear}`}>
            Данные о сессиях есть только с 2023 года.
          </State>
        ) : null}

        {selectedMeeting ? (
          <div className="f1-meta-row">
            <span>{meetingTitle(selectedMeeting) ?? 'Гран-при'}</span>
            {selectedMeeting.circuit_short_name ? (
              <span className="f1-pill">{selectedMeeting.circuit_short_name}</span>
            ) : null}
            {selectedMeeting.country_name ? (
              <span className="f1-muted">{selectedMeeting.country_name}</span>
            ) : null}
            {selectedMeeting.date_end ? (
              <span className="f1-muted">
                Завершено: {formatDate(parseUtc(selectedMeeting.date_end.slice(0, 10)))}
              </span>
            ) : null}
            {!isMeetingCompleted(selectedMeeting, Date.now()) ? (
              <span className="f1-pill warn">Уик-энд не завершён · неполные данные</span>
            ) : null}
          </div>
        ) : null}
        <SourceBar
          source={meetings.source}
          fetchedAt={meetings.fetchedAt}
          stale={meetings.stale}
          onRefresh={meetings.reload}
          refreshing={meetings.loading}
        />
        {meetingKey !== null && (
          <SourceBar
            source={sessions.source}
            fetchedAt={sessions.fetchedAt}
            stale={sessions.stale}
            onRefresh={sessions.reload}
            refreshing={sessions.loading}
          />
        )}
        {sessionKey !== null && (
          <SourceBar
            source={drivers.source}
            fetchedAt={drivers.fetchedAt}
            stale={drivers.stale}
            onRefresh={drivers.reload}
            refreshing={drivers.loading}
          />
        )}
      </div>

      {sessions.error && !sessions.data ? (
        <State kind="error" title="Не удалось загрузить сессии">
          {sessions.error}
        </State>
      ) : null}
      {sessionsEmptyForMeeting ? (
        <State kind="empty" title="Для этого Гран-при сессий нет" />
      ) : null}
      {noCompletedSession && !selectedSession ? (
        <State kind="empty" title="Нет завершённых сессий">
          Завершённых сессий в этом уик-энде ещё нет.
        </State>
      ) : null}

      {mode === 'pace' && selectedSession && (
        <RacePacePanel
          key={selectedSession.session_key}
          session={selectedSession}
          drivers={driverList}
          initialDriver={driverNumber}
        />
      )}
      <div className="session-details" hidden={mode === 'pace'}>
        {selectedSession ? (
          <div className="f1-card">
            <div className="f1-card-head">
              <div>
                <div className="f1-eyebrow">{selectedSession.session_name ?? 'Сессия'}</div>
                <div className="f1-title" style={{ fontSize: 17, marginTop: 4 }}>
                  {(selectedMeeting && meetingTitle(selectedMeeting)) ?? 'Гран-при'}
                </div>
                <div className="f1-muted">
                  {sessionShortDate(selectedSession) ?? '—'}
                  {selectedSession.status ? ` · Статус: ${selectedSession.status}` : ''}
                  {isCompleted(selectedSession, Date.now()) ? '' : ' · сессия ещё не завершена'}
                </div>
              </div>
              <Timer size={18} color="var(--muted,#8b9099)" aria-hidden="true" />
            </div>

            {drivers.error && !drivers.data ? (
              <State kind="error" title="Не удалось загрузить пилотов">
                {drivers.error}
              </State>
            ) : null}
            {!drivers.loading && !drivers.error && driverList.length === 0 ? (
              <State kind="empty" title="Список пилотов недоступен">
                Пилотов для этой сессии нет.
              </State>
            ) : null}

            {selectedDriver ? (
              <div className="f1-driver-head">
                <PersonAvatar
                  name={driverName(selectedDriver)}
                  src={selectedDriver.headshot_url}
                  size={64}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15 }}>{driverName(selectedDriver)}</div>
                  <div
                    className="f1-muted"
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <span
                      className="f1-team-dot"
                      style={{ background: openF1Color(selectedDriver.team_colour) ?? '#6b7280' }}
                      aria-hidden="true"
                    />
                    {selectedDriver.team_name ?? 'Команда не указана'}
                    <span className="f1-pill">№{selectedDriver.driver_number}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }} className="f1-kv">
                  {lapStats ? (
                    <>
                      <span className="f1-muted">Лучший круг</span>
                      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtLap(lapStats.best)}</b>
                      <span className="f1-muted">Средний</span>
                      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtLap(lapStats.avg)}</b>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            {laps.loading && !laps.data ? <State kind="loading" title="Загрузка кругов…" /> : null}
            {laps.error && !laps.data ? (
              <State kind="error" title="Не удалось загрузить круги">
                {laps.error}
              </State>
            ) : null}
            {laps.data && lapRows.length === 0 ? (
              <State kind="empty" title="Круговые данные недоступны">
                Для этой сессии и пилота кругов нет.
              </State>
            ) : null}

            {fastestLaps.length > 0 ? (
              <div className="f1-scroll">
                <table className="f1-table">
                  <thead>
                    <tr>
                      <th>Круг</th>
                      <th>Время</th>
                      <th>S1</th>
                      <th>S2</th>
                      <th>S3</th>
                      <th>Скорость (км/ч)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fastestLaps.map((l, i) => (
                      <tr key={`${l.driver_number}-${l.lap_number ?? i}`}>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {l.lap_number ?? '—'}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {fmtLap(l.lap_duration)}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmtLap(l.duration_sector_1)}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmtLap(l.duration_sector_2)}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmtLap(l.duration_sector_3)}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{l.st_speed ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {lapRows.length > 8 ? (
              <div className="f1-muted" style={{ fontSize: 11.5 }}>
                Показаны 8 самых быстрых кругов из {lapRows.length}.
              </div>
            ) : null}

            <SourceBar
              source={laps.source}
              fetchedAt={laps.fetchedAt}
              stale={laps.stale}
              onRefresh={laps.reload}
              refreshing={laps.loading}
            />
          </div>
        ) : null}

        {selectedSession && selectedDriver ? (
          <div className="f1-card">
            <div className="f1-card-head">
              <div className="f1-eyebrow">Отрезки и пит-стопы</div>
              <CircleDot size={16} color="var(--muted,#8b9099)" aria-hidden="true" />
            </div>
            {stints.loading && !stints.data ? (
              <State kind="loading" title="Загрузка отрезков…" />
            ) : null}
            {stints.error && !stints.data ? (
              <State kind="error" title="Отрезки недоступны">
                {stints.error}
              </State>
            ) : null}
            {stints.data && stintRows.length === 0 ? (
              <State kind="empty" title="Нет отрезков" />
            ) : null}
            {stintRows.length > 0 ? (
              <>
                <div className="f1-stint-bar" role="img" aria-label="Отрезки по кругам">
                  {stintRows.map((s, i) => {
                    const start = s.lap_start ?? 1;
                    const end = s.lap_end ?? start;
                    const width = Math.max(1, end - start + 1);
                    return (
                      <div
                        key={`${s.stint_number ?? start}-${i}`}
                        className="f1-stint-seg"
                        style={{ background: compoundColor(s.compound), flex: `${width} 0 0` }}
                        title={`${s.compound ?? 'Compound?'} · круги ${start}–${end}`}
                      >
                        {compoundLabel(s.compound)}
                      </div>
                    );
                  })}
                </div>
                <div className="f1-legend">
                  <span>
                    <i style={{ background: '#ff4d4d' }} />
                    Soft
                  </span>
                  <span>
                    <i style={{ background: '#ffd24d' }} />
                    Medium
                  </span>
                  <span>
                    <i style={{ background: '#e6e6e6' }} />
                    Hard
                  </span>
                  <span>
                    <i style={{ background: '#4ddd78' }} />
                    Intermediate
                  </span>
                  <span>
                    <i style={{ background: '#3d9bff' }} />
                    Wet
                  </span>
                  {stintTotal > 0 ? <span className="f1-muted">до {stintTotal} круга</span> : null}
                </div>
              </>
            ) : null}

            {pits.loading && !pits.data ? (
              <State kind="loading" title="Загрузка пит-стопов…" />
            ) : null}
            {pits.error && !pits.data ? (
              <State kind="error" title="Пит-стопы недоступны">
                {pits.error}
              </State>
            ) : null}
            {pits.data && pitRows.length === 0 ? (
              <div className="f1-muted" style={{ fontSize: 12 }}>
                Пит-стопы не зафиксированы.
              </div>
            ) : null}
            {pitRows.length > 0 ? (
              <div className="f1-scroll">
                <table className="f1-table">
                  <thead>
                    <tr>
                      <th>Круг</th>
                      <th>Длительность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pitRows.map((p, i) => (
                      <tr key={`${p.lap_number ?? i}-${i}`}>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {p.lap_number ?? '—'}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {p.pit_duration !== null && p.pit_duration !== undefined
                            ? `${p.pit_duration.toFixed(1)} с`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <SourceBar
              source={stints.source}
              fetchedAt={stints.fetchedAt}
              stale={stints.stale}
              onRefresh={stints.reload}
              refreshing={stints.loading}
            />
            <SourceBar
              source={pits.source}
              fetchedAt={pits.fetchedAt}
              stale={pits.stale}
              onRefresh={pits.reload}
              refreshing={pits.loading}
            />
          </div>
        ) : null}
      </div>
      {!selectedSession && !meetings.loading && meetingList.length > 0 && !noCompletedSession ? (
        <State kind="empty" title="Выберите сессию">
          Выберите пилота и сессию.
        </State>
      ) : null}
    </div>
  );
}
