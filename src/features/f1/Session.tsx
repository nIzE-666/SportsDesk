import { PersonAvatar } from '../../components/PersonAvatar';
import { CircleDot, Radio, Timer } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useViewState } from '../../lib/useViewState';
import { useSeason } from './SeasonContext';
import { RacePacePanel } from './RacePacePanel';
import { isCompleted, isMeetingCompleted, pickDefaultSession } from './analysisChoice';
import { meetingTitle, sessionNameLabel, sessionShortDate } from './analysisLabels';
import { useApiResource } from './api';
import { RetryButton, SourceBar, State, tyreClass, type F1Style } from './shared';
import { Badge, Panel, PanelHeader } from '../../kit';
import { openF1Color } from './teamColors';
import { formatDate, parseUtc } from './time';
import { parseOpenF1Drivers, parseOpenF1Laps, parseOpenF1Pits, parseOpenF1Stints } from './openf1';
import type { AnalysisSelection } from './useAnalysisSelection';
import type { OpenF1Driver } from './types';

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

function statusLabel(value?: string): string | null {
  const status = (value ?? '').toLowerCase();
  if (status === 'finalised' || status === 'finalized' || status === 'finished') return 'завершена';
  if (status === 'started' || status === 'running') return 'идёт';
  return null;
}

export function Session({
  mode = 'all',
  analysis,
}: {
  mode?: 'all' | 'pace';
  analysis: AnalysisSelection;
}) {
  const { year: selectedYear } = useSeason();
  const { meeting: selectedMeeting, session: selectedSession } = analysis;
  const meetingList = analysis.meetingList;
  const sessionList = analysis.sessionList;
  const meetings = analysis.meetings;
  const sessions = analysis.sessions;
  const sessionKey = selectedSession?.session_key ?? null;
  const [driverNumber, setDriverNumber] = useViewState<number | null>(
    `f1.openf1.${selectedYear}.${sessionKey}.driver`,
    null,
    (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0),
  );

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
    <span title="Живые данные недоступны: только история">
      <Badge variant="warning">
        <Radio size={12} aria-hidden="true" /> Прямая телеметрия недоступна
      </Badge>
    </span>
  );

  return (
    <div className="f1-session">
      <Panel className="f1-session-overview" aria-label="Гоночные сессии">
        <PanelHeader
          title={mode === 'pace' ? 'Темп пилотов внутри гонки' : 'Обзор гоночных сессий'}
          action={liveNote}
        />
        <div className="f1-muted f1-session-note">Данные с 2023 года.</div>
        {mode !== 'pace' ? (
          <div className="f1-toolbar">
            <div className="f1-muted f1-analysis-field">
              <span>Пилот</span>
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
            </div>
          </div>
        ) : null}

        {meetings.loading && !meetings.data ? (
          <State kind="loading" title="Загрузка календаря…" />
        ) : null}
        {meetings.error && !meetings.data ? (
          <State
            kind="error"
            title="Не удалось загрузить Гран-при"
            action={<RetryButton onClick={meetings.reload} details={meetings.error} />}
          />
        ) : null}
        {!meetings.loading && !meetings.error && meetingList.length === 0 ? (
          <State
            kind="empty"
            title={`Нет данных за ${selectedYear}`}
            message="Данные с 2023 года."
          />
        ) : null}

        {selectedMeeting ? (
          <div className="f1-meta-row">
            <span>{meetingTitle(selectedMeeting) ?? 'Гран-при'}</span>
            {selectedMeeting.circuit_short_name ? (
              <Badge>{selectedMeeting.circuit_short_name}</Badge>
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
              <Badge variant="warning">Уик-энд не завершён · неполные данные</Badge>
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
        {selectedMeeting !== null && (
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
      </Panel>

      {sessions.error && !sessions.data ? (
        <State
          kind="error"
          title="Не удалось загрузить сессии"
          action={<RetryButton onClick={sessions.reload} details={sessions.error} />}
        />
      ) : null}
      {sessionsEmptyForMeeting ? (
        <State kind="empty" title="Для этого Гран-при сессий нет" />
      ) : null}
      {noCompletedSession && !selectedSession ? (
        <State kind="empty" title="Нет завершённых сессий" />
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
          <Panel className="f1-session-panel" aria-label="Сессия">
            <PanelHeader
              title={(selectedMeeting && meetingTitle(selectedMeeting)) ?? 'Гран-при'}
              action={<Timer size={18} color="var(--color-text-secondary)" aria-hidden="true" />}
            />
            <div className="f1-muted f1-session-card-title">
              {sessionNameLabel(selectedSession.session_name) ?? 'Сессия'}
              {sessionShortDate(selectedSession) ? ` · ${sessionShortDate(selectedSession)}` : ''}
              {statusLabel(selectedSession.status)
                ? ` · ${statusLabel(selectedSession.status)}`
                : ''}
              {isCompleted(selectedSession, Date.now()) ? '' : ' · сессия ещё не завершена'}
            </div>

            {drivers.error && !drivers.data ? (
              <State
                kind="error"
                title="Не удалось загрузить пилотов"
                action={<RetryButton onClick={drivers.reload} details={drivers.error} />}
              />
            ) : null}
            {!drivers.loading && !drivers.error && driverList.length === 0 ? (
              <State kind="empty" title="Список пилотов недоступен" />
            ) : null}

            {selectedDriver ? (
              <div className="f1-driver-head">
                <PersonAvatar
                  name={driverName(selectedDriver)}
                  src={selectedDriver.headshot_url}
                  size={64}
                />
                <div className="f1-session-driver">
                  <div className="f1-session-driver-name">{driverName(selectedDriver)}</div>
                  <div className="f1-muted f1-session-driver-team">
                    <span
                      className="f1-team-dot"
                      style={
                        {
                          '--dot-color':
                            openF1Color(selectedDriver.team_colour) ?? 'var(--color-text-tertiary)',
                        } as F1Style
                      }
                      aria-hidden="true"
                    />
                    {selectedDriver.team_name ?? 'Команда не указана'}
                    <Badge>№{selectedDriver.driver_number}</Badge>
                  </div>
                </div>
                <div className="f1-kv f1-session-stats">
                  {lapStats ? (
                    <>
                      <span className="f1-muted">Лучший круг</span>
                      <b className="f1-num">{fmtLap(lapStats.best)}</b>
                      <span className="f1-muted">Средний</span>
                      <b className="f1-num">{fmtLap(lapStats.avg)}</b>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            {laps.loading && !laps.data ? <State kind="loading" title="Загрузка кругов…" /> : null}
            {laps.error && !laps.data ? (
              <State
                kind="error"
                title="Не удалось загрузить круги"
                action={<RetryButton onClick={laps.reload} details={laps.error} />}
              />
            ) : null}
            {laps.data && lapRows.length === 0 ? (
              <State kind="empty" title="Круговые данные недоступны" message="Кругов нет." />
            ) : null}

            {fastestLaps.length > 0 ? (
              <div className="ui-table-scroll">
                <table className="ui-table">
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
                        <td className="ui-table__num">{l.lap_number ?? '—'}</td>
                        <td className="ui-table__num f1-num-strong">{fmtLap(l.lap_duration)}</td>
                        <td className="ui-table__num">{fmtLap(l.duration_sector_1)}</td>
                        <td className="ui-table__num">{fmtLap(l.duration_sector_2)}</td>
                        <td className="ui-table__num">{fmtLap(l.duration_sector_3)}</td>
                        <td className="ui-table__num">{l.st_speed ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {lapRows.length > 8 ? (
              <div className="f1-muted f1-note-small">8 из {lapRows.length}</div>
            ) : null}

            <SourceBar
              source={laps.source}
              fetchedAt={laps.fetchedAt}
              stale={laps.stale}
              onRefresh={laps.reload}
              refreshing={laps.loading}
            />
          </Panel>
        ) : null}

        {selectedSession && selectedDriver ? (
          <Panel className="f1-session-panel" aria-label="Отрезки и пит-стопы">
            <PanelHeader
              title="Отрезки и пит-стопы"
              action={
                <CircleDot size={16} color="var(--color-text-secondary)" aria-hidden="true" />
              }
            />
            {stints.loading && !stints.data ? (
              <State kind="loading" title="Загрузка отрезков…" />
            ) : null}
            {stints.error && !stints.data ? (
              <State
                kind="error"
                title="Отрезки недоступны"
                action={<RetryButton onClick={stints.reload} details={stints.error} />}
              />
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
                        className={`f1-stint-seg f1-tyre f1-tyre--${tyreClass(s.compound)}`}
                        style={{ '--stint-grow': width } as F1Style}
                        title={`${s.compound ?? 'Compound?'} · круги ${start}–${end}`}
                      >
                        {compoundLabel(s.compound)}
                      </div>
                    );
                  })}
                </div>
                <div className="f1-legend">
                  <span>
                    <i className="f1-tyre f1-tyre--soft" />
                    Мягкие
                  </span>
                  <span>
                    <i className="f1-tyre f1-tyre--medium" />
                    Средние
                  </span>
                  <span>
                    <i className="f1-tyre f1-tyre--hard" />
                    Жёсткие
                  </span>
                  <span>
                    <i className="f1-tyre f1-tyre--inter" />
                    Промежуточные
                  </span>
                  <span>
                    <i className="f1-tyre f1-tyre--wet" />
                    Дождевые
                  </span>
                  {stintTotal > 0 ? <span className="f1-muted">до {stintTotal} круга</span> : null}
                </div>
              </>
            ) : null}

            {pits.loading && !pits.data ? (
              <State kind="loading" title="Загрузка пит-стопов…" />
            ) : null}
            {pits.error && !pits.data ? (
              <State
                kind="error"
                title="Пит-стопы недоступны"
                action={<RetryButton onClick={pits.reload} details={pits.error} />}
              />
            ) : null}
            {pits.data && pitRows.length === 0 ? (
              <div className="f1-muted f1-note-small">Пит-стопы не зафиксированы.</div>
            ) : null}
            {pitRows.length > 0 ? (
              <div className="ui-table-scroll">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Круг</th>
                      <th>Длительность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pitRows.map((p, i) => (
                      <tr key={`${p.lap_number ?? i}-${i}`}>
                        <td className="ui-table__num">{p.lap_number ?? '—'}</td>
                        <td className="ui-table__num">
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
          </Panel>
        ) : null}
      </div>
      {!selectedSession &&
      !meetings.loading &&
      !sessions.loading &&
      !sessions.error &&
      meetingList.length > 0 &&
      !noCompletedSession ? (
        <State kind="empty" title="Выберите сессию" />
      ) : null}
    </div>
  );
}
