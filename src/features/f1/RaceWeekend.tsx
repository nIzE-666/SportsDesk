import { useViewState } from '../../lib/useViewState';
import { Button, Tabs } from '../../kit';
import { useApiResource } from './api';
import { parseQualifying, parseRaceResults } from './parsing';
import { SourceBar, State } from './shared';
import { formatHumanDate } from '../../lib/humanDate';
import { formatDateTime, getTimeZone } from './time';
import type { JolpicaRace } from './types';
import { QualifyingResultsTable, RaceResultsTable, WeekendPointsTable } from './WeekendResults';
import { weekendSchedule } from './weekendSchedule';
import { racePresentation } from './calendarModel';
import { DiaryMarkButton } from '../diary/DiaryMarkButton';
import { f1DiaryEvent } from '../diary/diaryModel';
import { useSourceSummaryAvailable } from './SourceSummary';

type Tab = 'qualifying' | 'sprint' | 'race' | 'points';
const WEEKEND_TABS = [
  { id: 'qualifying', label: 'Квалификация' },
  { id: 'sprint', label: 'Спринт' },
  { id: 'race', label: 'Гонка' },
  { id: 'points', label: 'Очки уикенда' },
] as const;
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
    <section className="f1-card race-weekend" aria-label={`Уикенд ${racePresentation(race).title}`}>
      <div className="f1-card-head">
        <div>
          <div className="f1-eyebrow">ВЕСЬ УИКЕНД · РАУНД {race.round}</div>
          <h2 className="f1-title">{racePresentation(race).title}</h2>
          <span className="f1-muted">
            {race.Circuit.circuitName} · {getTimeZone()}
          </span>
        </div>
        {!aggregated && <Button onClick={refresh}>Обновить уикенд</Button>}
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
                : session.date
                  ? formatHumanDate(session.date, getTimeZone())
                  : 'Дата не объявлена'}
            </strong>
            {!session.start && <span className="muted small">Время не объявлено</span>}
          </div>
        ))}
      </div>
      <DiaryMarkButton
        event={{ ...f1DiaryEvent(race), title: `${racePresentation(race).title} · гонка` }}
        label="Отметить просмотр гонки"
      />
      <Tabs
        items={WEEKEND_TABS}
        ariaLabel="Результаты уикенда"
        active={tab}
        onChange={(id) => setTab(id as Tab)}
      />
      {tab === 'points' ? (
        <>
          {(results.loading || sprint.loading) && (
            <p className="muted small">Обновляем результаты…</p>
          )}
          {(results.error || sprint.error) && (
            <State kind="error" title="Часть очков недоступна">
              {results.error ?? sprint.error}{' '}
              <Button variant="quiet" small onClick={refresh}>
                Повторить
              </Button>
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
          <p className="muted small" title="Пока сессии не завершены, итог может быть неполным.">
            Сумма очков гонки и спринта.
          </p>
        </>
      ) : tab === 'sprint' && !hasSprint ? (
        <State kind="empty" title="Спринта в расписании нет" />
      ) : (
        <>
          {active.loading && !active.data && (
            <State kind="loading" title="Загружаем результаты сессии…" />
          )}
          {active.error && (
            <State kind="error" title="Результаты недоступны">
              {active.error}{' '}
              <Button variant="quiet" small onClick={active.reload}>
                Повторить
              </Button>
            </State>
          )}
          {active.data && !active.data.length && !active.loading && (
            <State kind="empty" title="Результаты пока не опубликованы">
              Итоги появятся после сессии.
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
