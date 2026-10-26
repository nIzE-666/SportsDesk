import { useCallback, useEffect, useState } from 'react';
import { useDataRecovery } from '../../lib/useDataRecovery';
import type { WeekendSeason } from './weekendData';
import { fetchWeekendSeason } from './weekendData';

export function useWeekendSeason(year: number) {
  const [stored, setStored] = useState<{ year: number; data: WeekendSeason } | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null),
    [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  useDataRecovery(
    (key) => key.startsWith(`jolpica:${year}/`) && /\/(results|qualifying|sprint)\.json/.test(key),
    reload,
  );
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    void fetchWeekendSeason(year)
      .then((data) => {
        if (active) setStored({ year, data });
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : 'Не удалось загрузить уикенды сезона.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [year, tick]);
  return { data: stored?.year === year ? stored.data : null, busy, error, reload };
}
