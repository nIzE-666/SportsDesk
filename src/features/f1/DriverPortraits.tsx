import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/bridge';
import { useDataRecovery } from '../../lib/useDataRecovery';
import { PersonAvatar } from '../../components/PersonAvatar';
import { useSeason } from './SeasonContext';
import type { OpenF1Driver, OpenF1Session } from './types';

export function portraitName(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  // Jolpica uses his full legal given name; OpenF1 uses the racing name.
  return normalized === 'andrea kimi antonelli' ? 'kimi antonelli' : normalized;
}

export function portraitMap(drivers: OpenF1Driver[]): Map<string, string> {
  const grouped = new Map<string, Set<string>>();
  for (const driver of drivers) {
    const name =
      [driver.first_name, driver.last_name].filter(Boolean).join(' ') || driver.full_name || '';
    if (!name || !driver.headshot_url || !/^https:\/\//i.test(driver.headshot_url)) continue;
    const key = portraitName(name);
    const urls = grouped.get(key) ?? new Set<string>();
    urls.add(driver.headshot_url);
    grouped.set(key, urls);
  }
  // Ambiguous identities must never borrow another driver's photo by number.
  return new Map(
    [...grouped].filter(([, urls]) => urls.size === 1).map(([key, urls]) => [key, [...urls][0]!]),
  );
}

const cache = new Map<number, { until: number; promise: Promise<Map<string, string>> }>();
async function fetchPortraits(year: number) {
  const sessionsReply = await api('openf1', `sessions?year=${year}&session_name=Race`);
  const sessions = Array.isArray(sessionsReply.payload)
    ? (sessionsReply.payload as OpenF1Session[])
    : [];
  // Leave the paid live window; no unbounded per-driver requests.
  const latest = sessions
    .filter(
      (s) => s.year === year && s.date_end && Date.parse(s.date_end) < Date.now() - 60 * 60_000,
    )
    .sort((a, b) => (b.date_end ?? '').localeCompare(a.date_end ?? ''))[0];
  if (!latest) return new Map<string, string>();
  const reply = await api('openf1', `drivers?session_key=${latest.session_key}`);
  return portraitMap(Array.isArray(reply.payload) ? reply.payload : []);
}
function loadPortraits(year: number) {
  const hit = cache.get(year);
  if (hit && hit.until > Date.now()) return hit.promise;
  const promise = fetchPortraits(year).catch((error) => {
    cache.delete(year);
    throw error;
  });
  cache.set(year, { until: Date.now() + 60 * 60_000, promise });
  return promise;
}
const Portraits = createContext<Map<string, string>>(new Map());
export function DriverPortraitsProvider({ children }: { children: ReactNode }) {
  const { year } = useSeason();
  const [result, setResult] = useState<{ year: number; photos: Map<string, string> } | null>(null);
  const [revision, setRevision] = useState(0);
  useDataRecovery(
    (key) =>
      key === `openf1:sessions?year=${year}&session_name=Race` ||
      key.startsWith('openf1:drivers?session_key='),
    () => {
      cache.delete(year);
      setRevision((n) => n + 1);
    },
  );
  useEffect(() => {
    let active = true;
    void loadPortraits(year)
      .then((photos) => {
        if (active) setResult({ year, photos });
      })
      .catch(() => {
        if (active) setResult({ year, photos: new Map() });
      });
    return () => {
      active = false;
    };
  }, [year, revision]);
  return (
    <Portraits.Provider value={result?.year === year ? result.photos : new Map()}>
      {children}
    </Portraits.Provider>
  );
}
export function DriverPortrait({ name, size = 36 }: { name: string; size?: number }) {
  const photos = useContext(Portraits);
  return <PersonAvatar name={name} src={photos.get(portraitName(name))} size={size} />;
}
