import { useApiResource } from './api';
import { parseSchedule } from './parsing';
import { useSeason } from './SeasonContext';
import { RetryButton, SourceBar, State } from './shared';
import { CalendarBoard } from './CalendarBoard';

export function Calendar() {
  const { year } = useSeason();
  const schedule = useApiResource(`${year}-calendar`, `${year}.json?limit=100`, parseSchedule);
  return (
    <div className="calendar-page">
      {schedule.loading && !schedule.data && <State kind="loading" title="Загрузка календаря…" />}
      {schedule.error && !schedule.data && (
        <State
          kind="error"
          title="Календарь недоступен"
          action={<RetryButton onClick={schedule.reload} details={schedule.error} />}
        />
      )}
      {schedule.data && <CalendarBoard races={schedule.data.races} year={year} />}
      <SourceBar
        source={schedule.source}
        fetchedAt={schedule.fetchedAt}
        stale={schedule.stale}
        onRefresh={schedule.reload}
        refreshing={schedule.loading}
      />
    </div>
  );
}
