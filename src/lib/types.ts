export type Source = 'pitch' | 'sportscore' | 'espn' | 'jolpica' | 'openf1';

export interface ApiReply {
  payload: any;
  source: string;
  fetchedAt: string;
  stale: boolean;
}

export interface SecretStatus {
  pitch: boolean;
  kino: boolean;
}

export interface KinoChannel {
  id: number;
  title: string;
  logo?: string;
  url?: string;
}
