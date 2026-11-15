import { useViewState } from '../../lib/useViewState';
import { Button, Panel, PanelHeader, StatTile, Tabs } from '../../kit';
import { useApiResource } from './api';
import { parseQualifying, parseRaceResults } from './parsing';
import { RetryButton, SourceBar, State } from './shared';
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
  const refresh = () => {
    results.reload();
    qualifying.reload();
    if (hasSprint) sprint.reload();
  };
  return (
    <Panel className="race-weekend" aria-label={`Уикенд ${racePresentation(race).title}`}>
      <PanelHeader
        title={`${racePresentation(race).flag} ${racePresentation(race).title}`}
        action={
          !aggregated ? (
            <Button small variant="quiet" onClick={refresh}>
              Обновить уикенд
            </Button>
          ) : undefined
        }
      />
      <span className="f1-muted">
        {race.Circuit.circuitName} · Этап {race.round} · {getTimeZone()}
      </span>
      <div className="weekend-schedule">
        {sessions.map((session) => (
          <StatTile
            key={session.id}
            label={session.label}
            value={
              session.start
                ? formatDateTime(session.start)
                : session.date
                  ? formatHumanDate(session.date, getTimeZone())
                  : undefined
            }
            note={!session.start && session.date ? 'Время не объявлено' : undefined}
          />
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
            <State
              kind="error"
              title="Часть очков недоступна"
              action={
                <RetryButton
                  onClick={refresh}
                  details={results.error ?? sprint.error ?? undefined}
                />
              }
            />
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
            <State
              kind="error"
              title="Результаты недоступны"
              action={<RetryButton onClick={active.reload} details={active.error} />}
            />
          )}
          {active.data && !active.data.length && !active.loading && (
            <State
              kind="empty"
              title="Результаты пока не опубликованы"
              message="Итоги появятся после сессии."
            />
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
    </Panel>
  );
}
