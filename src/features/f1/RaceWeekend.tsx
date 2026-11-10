import { useViewState } from '../../lib/useViewState';
import { useApiResource } from './api';
import { parseQualifying, parseRaceResults } from './parsing';
import { SourceBar, State } from './shared';
import { formatDateTime, getTimeZone } from './time';
import type { JolpicaRace } from './types';
import { QualifyingResultsTable, RaceResultsTable, WeekendPointsTable } from './WeekendResults';
import { weekendSchedule } from './weekendSchedule';
import { racePresentation } from './calendarModel';
import { DiaryMarkButton } from '../diary/DiaryMarkButton';
import { f1DiaryEvent } from '../diary/diaryModel';
import { useSourceSummaryAvailable } from './SourceSummary';

type Tab = 'qualifying' | 'sprint' | 'race' | 'points';
function sprintRows(payload: unknown) {
  const data = payload as { MRData?: { RaceTable?: { Races?: Array<Record<string, unknown>> } } };
  return (
    parseRaceResults({
      MRData: {
        RaceTable: {
          Races:
            data?.MRData?.RaceTable?.Races?.map((r) => ({ ...r, Results: r.SprintResults })) ?? [],
        },
      },
    })[0]?.Results ?? []
  );
}
export function RaceWeekend({ race }: { race: JolpicaRace }) {
  const aggregated = useSourceSummaryAvailable();
  const base = `${race.season}/${race.round}`,
    hasSprint = !!race.Sprint;
  const [tab, setTab] = useViewState<Tab>(`f1.${base}.weekend.tab`, 'race', (v) =>
    ['qualifying', 'sprint', 'race', 'points'].includes(String(v)),
  );
  const results = useApiResource(
    `${base}-race`,
    `${base}/results.json?limit=100`,
    (p) => parseRaceResults(p)[0]?.Results ?? [],
  );
  const sprint = useApiResource(
    `${base}-sprint`,
    hasSprint ? `${base}/sprint.json?limit=100` : null,
    sprintRows,
  );
  const qualifying = useApiResource(
    `${base}-qualifying`,
    `${base}/qualifying.json?limit=100`,
    parseQualifying,
  );
  const active = tab === 'qualifying' ? qualifying : tab === 'sprint' ? sprint : results;
  const sessions = weekendSchedule(race);
  const rows = tab === 'qualifying' ? qualifying.data : sprint.data;
  const refresh = () => {
    results.reload();
    qualifying.reload();
    if (hasSprint) sprint.reload();
  };
  return (
    <section className="f1-card race-weekend" aria-label={`Уикенд ${race.raceName}`}>
      <div className="f1-card-head">
        <div>
          <div className="f1-eyebrow">ВЕСЬ УИКЕНД · РАУНД {race.round}</div>
          <h2 className="f1-title">{racePresentation(race).title}</h2>
          <span className="f1-muted">
            {race.Circuit.circuitName} · {getTimeZone()}
          </span>
        </div>
        {!aggregated && (
          <button className="ghost-btn" onClick={refresh}>
            Обновить уикенд
          </button>
        )}
      </div>
      <div className="weekend-schedule">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={session.id === 'race' ? 'weekend-session main-session' : 'weekend-session'}
          >
            <small>{session.label}</small>
            <strong>
              {session.start
                ? formatDateTime(session.start)
                : (session.date ?? 'Дата не объявлена')}
            </strong>
            {!session.start && <span className="muted small">Время не объявлено</span>}
          </div>
        ))}
      </div>
      <DiaryMarkButton
        event={{ ...f1DiaryEvent(race), title: `${racePresentation(race).title} · гонка` }}
        label="Отметить просмотр гонки"
      />
      <div className="f1-tabs" role="tablist" aria-label="Результаты уикенда">
        {(
          [
            { id: 'qualifying', label: 'Квалификация' },
            { id: 'sprint', label: 'Спринт' },
            { id: 'race', label: 'Гонка' },
            { id: 'points', label: 'Очки уикенда' },
          ] as const
        ).map((item) => (
          <button
            className="f1-tab"
            role="tab"
            key={item.id}
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'points' ? (
        <>
          {(results.loading || sprint.loading) && (
            <p className="muted small">Обновляем результаты…</p>
          )}
          {(results.error || sprint.error) && (
            <State kind="error" title="Часть очков недоступна">
              {results.error ?? sprint.error}{' '}
              <button className="text-link" onClick={refresh}>
                Повторить
              </button>
            </State>
          )}
          {results.data?.length || sprint.data?.length ? (
            <WeekendPointsTable
              race={results.data ?? []}
              sprint={sprint.data ?? []}
              sprintScheduled={hasSprint}
            />
          ) : (
            <State kind="empty" title="Очки ещё не опубликованы" />
          )}
          <p className="muted small">
            Сумма опубликованных результатов гонки и спринта. Квалификация очков не приносит. Если
            сессия ещё не завершена или её данные недоступны, итог может быть неполным.
          </p>
        </>
      ) : tab === 'sprint' && !hasSprint ? (
        <State kind="empty" title="Спринт не указан в расписании этого этапа" />
      ) : (
        <>
          {active.loading && !active.data && (
            <State kind="loading" title="Загружаем результаты сессии…" />
          )}
          {active.error && (
            <State kind="error" title="Результаты недоступны">
              {active.error}{' '}
              <button className="text-link" onClick={active.reload}>
                Повторить
              </button>
            </State>
          )}
          {active.data && !active.data.length && !active.loading && (
            <State kind="empty" title="Результаты пока не опубликованы">
              Расписание и публикация итогов обновляются источником отдельно.
            </State>
          )}
          {tab === 'qualifying' && qualifying.data?.length ? (
            <QualifyingResultsTable rows={qualifying.data} />
          ) : null}
          {tab === 'race' && results.data?.length ? <RaceResultsTable rows={results.data} /> : null}
          {tab === 'sprint' && sprint.data?.length ? <RaceResultsTable rows={sprint.data} /> : null}
        </>
      )}
      <SourceBar
        source={results.source}
        fetchedAt={results.fetchedAt}
        stale={results.stale}
        onRefresh={results.reload}
        refreshing={results.loading}
      />
      <SourceBar
        source={qualifying.source}
        fetchedAt={qualifying.fetchedAt}
        stale={qualifying.stale}
        onRefresh={qualifying.reload}
        refreshing={qualifying.loading}
      />
      {hasSprint && (
        <SourceBar
          source={sprint.source}
          fetchedAt={sprint.fetchedAt}
          stale={sprint.stale}
          onRefresh={sprint.reload}
          refreshing={sprint.loading}
        />
      )}
    </section>
  );
}
