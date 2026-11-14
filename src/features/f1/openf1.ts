import { asArray } from './api';
import type {
  OpenF1Driver,
  OpenF1Lap,
  OpenF1Meeting,
  OpenF1Pit,
  OpenF1Session,
  OpenF1Stint,
} from './types';

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseMeetings(payload: unknown): OpenF1Meeting[] {
  const out: OpenF1Meeting[] = [];
  for (const raw of asArray(payload)) {
    const row = obj(raw);
    if (!row) continue;
    const key = num(row.meeting_key);
    if (key === null) continue;
    out.push({
      meeting_key: key,
      meeting_name: str(row.meeting_name),
      meeting_official_name: str(row.meeting_official_name),
      location: str(row.location),
      country_name: str(row.country_name),
      country_code: str(row.country_code),
      circuit_short_name: str(row.circuit_short_name),
      date_start: str(row.date_start),
      date_end: str(row.date_end),
      year: num(row.year) ?? undefined,
    });
  }
  return out.sort((a, b) => (b.date_start ?? '').localeCompare(a.date_start ?? ''));
}

function parseSessions(payload: unknown): OpenF1Session[] {
  const out: OpenF1Session[] = [];
  for (const raw of asArray(payload)) {
    const row = obj(raw);
    if (!row) continue;
    const sessionKey = num(row.session_key);
    const meetingKey = num(row.meeting_key);
    if (sessionKey === null || meetingKey === null) continue;
    out.push({
      session_key: sessionKey,
      meeting_key: meetingKey,
      session_name: str(row.session_name),
      session_type: str(row.session_type),
      date_start: str(row.date_start),
      date_end: str(row.date_end),
      status: str(row.status),
      year: num(row.year) ?? undefined,
      circuit_short_name: str(row.circuit_short_name),
      location: str(row.location),
      country_name: str(row.country_name),
    });
  }
  return out.sort((a, b) => (a.date_start ?? '').localeCompare(b.date_start ?? ''));
}

function parseDrivers(payload: unknown): OpenF1Driver[] {
  const out: OpenF1Driver[] = [];
  const seen = new Set<number>();
  for (const raw of asArray(payload)) {
    const row = obj(raw);
    if (!row) continue;
    const number = num(row.driver_number);
    if (number === null || seen.has(number)) continue;
    seen.add(number);
    out.push({
      driver_number: number,
      full_name: str(row.full_name),
      first_name: str(row.first_name),
      last_name: str(row.last_name),
      name_acronym: str(row.name_acronym),
      team_name: str(row.team_name),
      team_colour: str(row.team_colour),
      headshot_url: typeof row.headshot_url === 'string' ? row.headshot_url : null,
      session_key: num(row.session_key) ?? undefined,
      meeting_key: num(row.meeting_key) ?? undefined,
    });
  }
  return out.sort((a, b) => a.driver_number - b.driver_number);
}

function parseLaps(payload: unknown): OpenF1Lap[] {
  const out: OpenF1Lap[] = [];
  for (const raw of asArray(payload)) {
    const row = obj(raw);
    if (!row) continue;
    const driverNumber = num(row.driver_number);
    if (driverNumber === null) continue;
    out.push({
      driver_number: driverNumber,
      lap_number: num(row.lap_number) ?? undefined,
      lap_duration: num(row.lap_duration),
      duration_sector_1: num(row.duration_sector_1),
      duration_sector_2: num(row.duration_sector_2),
      duration_sector_3: num(row.duration_sector_3),
      st_speed: num(row.st_speed),
      is_pit_out_lap: row.is_pit_out_lap === true,
      date_start: str(row.date_start),
      session_key: num(row.session_key) ?? undefined,
    });
  }
  return out;
}

function parseStints(payload: unknown): OpenF1Stint[] {
  const out: OpenF1Stint[] = [];
  for (const raw of asArray(payload)) {
    const row = obj(raw);
    if (!row) continue;
    const driverNumber = num(row.driver_number);
    if (driverNumber === null) continue;
    out.push({
      driver_number: driverNumber,
      stint_number: num(row.stint_number) ?? undefined,
      lap_start: num(row.lap_start) ?? undefined,
      lap_end: num(row.lap_end) ?? undefined,
      compound: str(row.compound) ?? null,
      tyre_age_at_start: num(row.tyre_age_at_start),
      session_key: num(row.session_key) ?? undefined,
    });
  }
  return out.sort((a, b) => (a.stint_number ?? 0) - (b.stint_number ?? 0));
}

function parsePits(payload: unknown): OpenF1Pit[] {
  const out: OpenF1Pit[] = [];
  for (const raw of asArray(payload)) {
    const row = obj(raw);
    if (!row) continue;
    const driverNumber = num(row.driver_number);
    if (driverNumber === null) continue;
    out.push({
      driver_number: driverNumber,
      lap_number: num(row.lap_number) ?? undefined,
      pit_duration: num(row.pit_duration),
      session_key: num(row.session_key) ?? undefined,
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
