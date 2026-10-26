// Module-local defensive types for Jolpica and OpenF1 payloads.
// Intentionally permissive: upstream can be partial.

export interface JolpicaCircuit {
  circuitId: string;
  circuitName: string;
  url?: string;
  Location?: { lat?: string; long?: string; locality?: string; country?: string };
}

export interface JolpicaSession {
  date?: string;
  time?: string;
}

export interface JolpicaRace {
  season: string;
  round: string;
  url?: string;
  raceName: string;
  Circuit: JolpicaCircuit;
  date: string;
  time?: string;
  FirstPractice?: JolpicaSession;
  SecondPractice?: JolpicaSession;
  ThirdPractice?: JolpicaSession;
  Qualifying?: JolpicaSession;
  Sprint?: JolpicaSession;
  SprintQualifying?: JolpicaSession;
  SprintShootout?: JolpicaSession;
}

export interface JolpicaDriver {
  driverId: string;
  permanentNumber?: string;
  code?: string;
  url?: string;
  givenName: string;
  familyName: string;
  dateOfBirth?: string;
  nationality?: string;
}

export interface JolpicaConstructor {
  constructorId: string;
  url?: string;
  name: string;
  nationality?: string;
}

export interface JolpicaDriverStanding {
  position?: string;
  positionText?: string;
  points?: string;
  wins?: string;
  Driver: JolpicaDriver;
  Constructors?: JolpicaConstructor[];
}

export interface JolpicaConstructorStanding {
  position?: string;
  positionText?: string;
  points?: string;
  wins?: string;
  Constructor: JolpicaConstructor;
}

export interface JolpicaResultEntry {
  number?: string;
  position?: string;
  positionText?: string;
  points?: string;
  Driver: JolpicaDriver;
  Constructor: JolpicaConstructor;
  grid?: string;
  laps?: string;
  status?: string;
  Time?: { millis?: string; time?: string };
  FastestLap?: {
    rank?: string;
    lap?: string;
    Time?: { time?: string };
    AverageSpeed?: { units?: string; speed?: string };
  };
  grid_?: string;
}

export interface JolpicaQualifyingEntry {
  number?: string;
  position?: string;
  Driver: JolpicaDriver;
  Constructor: JolpicaConstructor;
  Q1?: string;
  Q2?: string;
  Q3?: string;
}

export interface JolpicaRaceResultRow {
  season: string;
  round: string;
  raceName: string;
  Circuit: JolpicaCircuit;
  date: string;
  time?: string;
  Results: JolpicaResultEntry[];
}

export interface JolpicaLapTiming {
  number?: string;
  position?: string;
  time?: string;
}

export interface JolpicaPitStop {
  driverId: string;
  lap?: string;
  duration?: string;
  stop?: string;
}

// OpenF1 permissive shapes.
export interface OpenF1Meeting {
  meeting_key: number;
  meeting_name?: string;
  meeting_official_name?: string;
  location?: string;
  country_name?: string;
  country_code?: string;
  circuit_short_name?: string;
  date_start?: string;
  date_end?: string;
  year?: number;
}

export interface OpenF1Session {
  session_key: number;
  meeting_key: number;
  session_name?: string;
  session_type?: string;
  date_start?: string;
  date_end?: string;
  status?: string;
  year?: number;
  circuit_short_name?: string;
  location?: string;
  country_name?: string;
}

export interface OpenF1Driver {
  driver_number: number;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  name_acronym?: string;
  team_name?: string;
  team_colour?: string;
  headshot_url?: string | null;
  session_key?: number;
  meeting_key?: number;
}

export interface OpenF1Lap {
  driver_number: number;
  lap_number?: number;
  lap_duration?: number | null;
  duration_sector_1?: number | null;
  duration_sector_2?: number | null;
  duration_sector_3?: number | null;
  i1_speed?: number | null;
  is_pit_out_lap?: boolean;
  st_speed?: number | null;
  date_start?: string;
  session_key?: number;
}

export interface OpenF1Stint {
  driver_number: number;
  stint_number?: number;
  lap_start?: number;
  lap_end?: number;
  compound?: string | null;
  tyre_age_at_start?: number | null;
  session_key?: number;
}

export interface OpenF1Pit {
  driver_number: number;
  lap_number?: number;
  pit_duration?: number | null;
  session_key?: number;
}

export interface OpenF1Weather {
  air_temperature?: number | null;
  track_temperature?: number | null;
  humidity?: number | null;
  rainfall?: number | null;
  wind_speed?: number | null;
  date?: string;
}
