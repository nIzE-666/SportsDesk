import { extractMRData, asArray } from './api';
import type {
  JolpicaRace,
  JolpicaCircuit,
  JolpicaDriver,
  JolpicaConstructor,
  JolpicaDriverStanding,
  JolpicaConstructorStanding,
  JolpicaResultEntry,
  JolpicaQualifyingEntry,
  JolpicaRaceResultRow,
  JolpicaPitStop,
  JolpicaLapTiming,
} from './types';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

export function parseCircuit(v: unknown): JolpicaCircuit | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o.circuitId);
  const name = str(o.circuitName);
  if (!id || !name) return null;
  const loc = obj(o.Location);
  return {
    circuitId: id,
    circuitName: name,
    url: str(o.url),
    Location: loc
      ? {
          lat: str(loc.lat),
          long: str(loc.long),
          locality: str(loc.locality),
          country: str(loc.country),
        }
      : undefined,
  };
}

export function parseRace(v: unknown): JolpicaRace | null {
  const o = obj(v);
  if (!o) return null;
  const circuit = parseCircuit(o.Circuit);
  const round = str(o.round);
  const raceName = str(o.raceName);
  const date = str(o.date);
  const season = str(o.season);
  if (!circuit || !round || !raceName || !date || !season) return null;
  const session = (k: string) => {
    const s = obj(o[k]);
    if (!s) return undefined;
    return { date: str(s.date), time: str(s.time) };
  };
  return {
    season,
    round,
    raceName,
    Circuit: circuit,
    date,
    time: str(o.time),
    url: str(o.url),
    FirstPractice: session('FirstPractice'),
    SecondPractice: session('SecondPractice'),
    ThirdPractice: session('ThirdPractice'),
    Qualifying: session('Qualifying'),
    Sprint: session('Sprint'),
    SprintQualifying: session('SprintQualifying'),
    SprintShootout: session('SprintShootout'),
  };
}

export function parseDriver(v: unknown): JolpicaDriver | null {
  const o = obj(v);
  if (!o) return null;
  const driverId = str(o.driverId);
  const givenName = str(o.givenName);
  const familyName = str(o.familyName);
  if (!driverId || !givenName || !familyName) return null;
  return {
    driverId,
    givenName,
    familyName,
    permanentNumber: str(o.permanentNumber),
    code: str(o.code),
    url: str(o.url),
    dateOfBirth: str(o.dateOfBirth),
    nationality: str(o.nationality),
  };
}

export function parseConstructor(v: unknown): JolpicaConstructor | null {
  const o = obj(v);
  if (!o) return null;
  const constructorId = str(o.constructorId);
  const name = str(o.name);
  if (!constructorId || !name) return null;
  return { constructorId, name, url: str(o.url), nationality: str(o.nationality) };
}

// --- Schedule ---
export function parseSchedule(payload: unknown): { season: string | null; races: JolpicaRace[] } {
  const mr = extractMRData(payload);
  const table = obj(mr?.RaceTable);
  if (!table) return { season: null, races: [] };
  const races = asArray(table.Races)
    .map(parseRace)
    .filter((x): x is JolpicaRace => !!x)
    .sort((a, b) => Number(a.round) - Number(b.round));
  return { season: str(table.season) ?? null, races };
}

// --- Driver standings ---
export function parseDriverStandings(payload: unknown): {
  season: string | null;
  round: string | null;
  standings: JolpicaDriverStanding[];
} {
  const mr = extractMRData(payload);
  const table = obj(mr?.StandingsTable);
  if (!table) return { season: null, round: null, standings: [] };
  const lists = asArray(table.StandingsLists);
  const list = obj(lists[0]);
  if (!list)
    return { season: str(table.season) ?? null, round: str(table.round) ?? null, standings: [] };
  const standings: JolpicaDriverStanding[] = [];
  for (const raw of asArray(list.DriverStandings)) {
    const o = obj(raw);
    if (!o) continue;
    const d = parseDriver(o.Driver);
    if (!d) continue;
    const cons = asArray(o.Constructors)
      .map(parseConstructor)
      .filter((c): c is JolpicaConstructor => !!c);
    standings.push({
      Driver: d,
      Constructors: cons,
      position: str(o.position),
      positionText: str(o.positionText),
      points: str(o.points),
      wins: str(o.wins),
    });
  }
  return {
    season: str(list.season) ?? str(table.season) ?? null,
    round: str(list.round) ?? str(table.round) ?? null,
    standings,
  };
}

// --- Constructor standings ---
export function parseConstructorStandings(payload: unknown): {
  season: string | null;
  round: string | null;
  standings: JolpicaConstructorStanding[];
} {
  const mr = extractMRData(payload);
  const table = obj(mr?.StandingsTable);
  if (!table) return { season: null, round: null, standings: [] };
  const lists = asArray(table.StandingsLists);
  const list = obj(lists[0]);
  if (!list)
    return { season: str(table.season) ?? null, round: str(table.round) ?? null, standings: [] };
  const standings: JolpicaConstructorStanding[] = [];
  for (const raw of asArray(list.ConstructorStandings)) {
    const o = obj(raw);
    if (!o) continue;
    const c = parseConstructor(o.Constructor);
    if (!c) continue;
    standings.push({
      Constructor: c,
      position: str(o.position),
      positionText: str(o.positionText),
      points: str(o.points),
      wins: str(o.wins),
    });
  }
  return {
    season: str(list.season) ?? str(table.season) ?? null,
    round: str(list.round) ?? str(table.round) ?? null,
    standings,
  };
}

// --- Single-race results ---
export function parseRaceResults(payload: unknown): JolpicaRaceResultRow[] {
  const mr = extractMRData(payload);
  const table = obj(mr?.RaceTable);
  if (!table) return [];
  const rows: JolpicaRaceResultRow[] = [];
  for (const raw of asArray(table.Races)) {
    const o = obj(raw);
    if (!o) continue;
    const circuit = parseCircuit(o.Circuit);
    if (!circuit) continue;
    const results: JolpicaResultEntry[] = [];
    for (const r of asArray(o.Results)) {
      const ro = obj(r);
      if (!ro) continue;
      const d = parseDriver(ro.Driver);
      const c = parseConstructor(ro.Constructor);
      if (!d || !c) continue;
      const fastest = obj(ro.FastestLap);
      const flTime = fastest ? obj(fastest.Time) : null;
      const avgSpeed = fastest ? obj(fastest.AverageSpeed) : null;
      const time = obj(ro.Time);
      results.push({
        number: str(ro.number),
        position: str(ro.position),
        positionText: str(ro.positionText),
        points: str(ro.points),
        Driver: d,
        Constructor: c,
        grid: str(ro.grid),
        laps: str(ro.laps),
        status: str(ro.status),
        Time: time ? { millis: str(time.millis), time: str(time.time) } : undefined,
        FastestLap: fastest
          ? {
              rank: str(fastest.rank),
              lap: str(fastest.lap),
              Time: flTime ? { time: str(flTime.time) } : undefined,
              AverageSpeed: avgSpeed
                ? { units: str(avgSpeed.units), speed: str(avgSpeed.speed) }
                : undefined,
            }
          : undefined,
      });
    }
    rows.push({
      season: str(o.season) ?? '',
      round: str(o.round) ?? '',
      raceName: str(o.raceName) ?? '',
      Circuit: circuit,
      date: str(o.date) ?? '',
      time: str(o.time),
      Results: results,
    });
  }
  return rows;
}

export function parseQualifying(payload: unknown): JolpicaQualifyingEntry[] {
  const mr = extractMRData(payload);
  const table = obj(mr?.RaceTable);
  if (!table) return [];
  const races = asArray(table.Races);
  const race = obj(races[0]);
  if (!race) return [];
  const entries: JolpicaQualifyingEntry[] = [];
  for (const raw of asArray(race.QualifyingResults)) {
    const o = obj(raw);
    if (!o) continue;
    const d = parseDriver(o.Driver);
    const c = parseConstructor(o.Constructor);
    if (!d || !c) continue;
    entries.push({
      number: str(o.number),
      position: str(o.position),
      Driver: d,
      Constructor: c,
      Q1: str(o.Q1),
      Q2: str(o.Q2),
      Q3: str(o.Q3),
    });
  }
  return entries;
}

export function parsePitStops(payload: unknown): JolpicaPitStop[] {
  const mr = extractMRData(payload);
  const table = obj(mr?.RaceTable);
  if (!table) return [];
  const races = asArray(table.Races);
  const race = obj(races[0]);
  if (!race) return [];
  const out: JolpicaPitStop[] = [];
  for (const raw of asArray(race.PitStops)) {
    const o = obj(raw);
    if (!o) continue;
    const driverId = str(o.driverId);
    if (!driverId) continue;
    out.push({ driverId, lap: str(o.lap), duration: str(o.duration), stop: str(o.stop) });
  }
  return out;
}

export function parseLaps(payload: unknown): Record<string, JolpicaLapTiming[]> {
  // Tolerant: { MRData.RaceTable.Races[0].Laps: [{ number, Timings: [...] }] }
  const mr = extractMRData(payload);
  const table = obj(mr?.RaceTable);
  if (!table) return {};
  const races = asArray(table.Races);
  const race = obj(races[0]);
  if (!race) return {};
  const byDriver: Record<string, JolpicaLapTiming[]> = {};
  for (const raw of asArray(race.Laps)) {
    const o = obj(raw);
    if (!o) continue;
    const lapNum = str(o.number);
    for (const t of asArray(o.Timings)) {
      const to = obj(t);
      if (!to) continue;
      const id = str(to.driverId);
      if (!id) continue;
      (byDriver[id] ??= []).push({
        number: lapNum,
        position: str(to.position),
        time: str(to.time),
      });
    }
  }
  return byDriver;
}

// A race is considered finished if its date is before now (best-effort).
export function isFinished(race: JolpicaRace, now: Date = new Date()): boolean {
  const dt = new Date(`${race.date}T${race.time ?? '23:59:59Z'}`);
  if (Number.isNaN(dt.getTime())) return false;
  // add 3h grace for the race to actually complete
  return now.getTime() > dt.getTime() + 3 * 60 * 60 * 1000;
}

export function isUpcoming(race: JolpicaRace, now: Date = new Date()): boolean {
  const dt = new Date(`${race.date}T${race.time ?? '00:00:00Z'}`);
  if (Number.isNaN(dt.getTime())) return false;
  return now.getTime() < dt.getTime();
}

export function nextRace(races: JolpicaRace[], now: Date = new Date()): JolpicaRace | null {
  for (const r of races) {
    if (!isFinished(r, now)) return r;
  }
  return null;
}

export function latestFinished(races: JolpicaRace[], now: Date = new Date()): JolpicaRace | null {
  let latest: JolpicaRace | null = null;
  for (const r of races) {
    if (isFinished(r, now) && (!latest || Number(r.round) > Number(latest.round))) latest = r;
  }
  return latest;
}

export function positionText(t?: string | null): string {
  if (!t) return '—';
  if (t === 'R') return 'Сход';
  if (t === 'D') return 'DSQ';
  if (t === 'E') return 'DNS';
  if (t === 'W') return 'DNQ';
  if (t === 'F') return 'DNQ';
  return t;
}

export function statusIsFinish(status?: string): boolean {
  if (!status) return false;
  return /^finished$/i.test(status) || /^\+\d+ lap/i.test(status);
}

export function classifyResult(
  status?: string,
  positionText?: string,
): 'finished' | 'dnf' | 'dns' | 'dsq' | 'unknown' {
  const s = (status ?? '').toLowerCase();
  if (positionText === 'D') return 'dsq';
  if (positionText === 'E') return 'dns';
  if (s.includes('disqualified')) return 'dsq';
  if (s.includes('did not start') || s.includes('withdrew')) return 'dns';
  if (s === 'finished' || /^\+\d+ lap/.test(s)) return 'finished';
  if (s.includes('did not qualify') || s.includes('not classified')) return 'unknown';
  if (s.length > 0) return 'dnf';
  return 'unknown';
}
