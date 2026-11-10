import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  validOfflineSeason,
  summarizeSeason,
  MAX_OFFLINE_SEASONS,
  seasonKey,
  type OfflineSeason,
} from '../src/features/offline/offlineModel';

export class InvalidArgs extends Error {}
const defaultPath = join(process.cwd(), 'node_modules', '.cache', 'sportsdesk-dev', 'history.json');
type Row = {
  id: string;
  leagueId: string;
  leagueName: string;
  season: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  status: string;
  date: string;
  round: string;
};
const str = (value: unknown): value is string => typeof value === 'string';
const obj = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const output = ({ leagueName: _leagueName, ...row }: Row) => row;

export class HistoryStore {
  constructor(private readonly path = defaultPath) {}
  private readDocument(): { rows: Row[]; packages: OfflineSeason[] } {
    try {
      const raw = readFileSync(this.path, 'utf8');
      if (raw.length > 128 * 1024 * 1024) throw new Error('История слишком большая.');
      const data: unknown = JSON.parse(raw);
      if (Array.isArray(data)) return { rows: data as Row[], packages: [] };
      if (
        !obj(data) ||
        data.version !== 2 ||
        !Array.isArray(data.rows) ||
        !Array.isArray(data.packages) ||
        data.packages.length > MAX_OFFLINE_SEASONS ||
        !data.packages.every(validOfflineSeason)
      )
        throw new Error('История не читается или создана новой версией.');
      return { rows: data.rows as Row[], packages: data.packages };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], packages: [] };
      throw error;
    }
  }
  private read(): Row[] {
    return this.readDocument().rows;
  }
  private write(rows: Row[], packages = this.readDocument().packages): void {
    if (rows.length > 500_000) throw new Error('Слишком много матчей в истории.');
    const data = JSON.stringify({ version: 2, rows, packages });
    if (data.length > 128 * 1024 * 1024) throw new Error('История слишком большая.');
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, data, 'utf8');
    renameSync(temp, this.path);
  }
  dispatch(command: string, args: Record<string, unknown>): unknown {
    if (command.startsWith('offline_')) {
      const doc = this.readDocument();
      if (command === 'offline_list')
        return doc.packages
          .map(summarizeSeason)
          .sort((a, b) => compare(b.season, a.season) || compare(a.leagueName, b.leagueName));
      if (command === 'offline_put') {
        const p = args.package;
        if (!validOfflineSeason(p)) throw new InvalidArgs('Некорректный офлайн-пакет.');
        const packages = doc.packages.filter(
          (x) => seasonKey(x.leagueId, x.season) !== seasonKey(p.leagueId, p.season),
        );
        if (packages.length >= MAX_OFFLINE_SEASONS)
          throw new InvalidArgs('Лимит 60 офлайн-сезонов.');
        const rows = new Map(
          doc.rows.map((r) => [JSON.stringify([r.leagueId, r.season, r.id]), r]),
        );
        for (const m of p.matches)
          rows.set(JSON.stringify([p.leagueId, p.season, m.id]), {
            id: m.id,
            leagueId: p.leagueId,
            leagueName: p.leagueName,
            season: p.season,
            homeId: m.homeId,
            homeName: m.homeName,
            awayId: m.awayId,
            awayName: m.awayName,
            homeScore: m.homeScore ?? -1,
            awayScore: m.awayScore ?? -1,
            status: m.status,
            date: m.date,
            round: m.round,
          });
        this.write([...rows.values()], [...packages, p]);
        return summarizeSeason(p);
      }
      if (!str(args.leagueId) || !str(args.season))
        throw new InvalidArgs('Не указаны лига и сезон.');
      const p = doc.packages.find((x) => x.leagueId === args.leagueId && x.season === args.season);
      if (command === 'offline_get') return p ?? null;
      if (command === 'offline_pin') {
        if (!p || typeof args.pinned !== 'boolean')
          throw new InvalidArgs('Не указан пакет или закрепление.');
        p.pinned = args.pinned;
      } else if (command === 'offline_remove') {
        if (p?.pinned) throw new InvalidArgs('Сначала открепите сезон.');
        doc.packages = doc.packages.filter((x) => x !== p);
      } else throw new InvalidArgs('Неизвестная команда.');
      this.write(doc.rows, doc.packages);
      return null;
    }
    if (command === 'history_upsert') {
      const b = args.batch;
      if (
        !obj(b) ||
        !str(b.leagueId) ||
        !str(b.leagueName) ||
        !str(b.season) ||
        !Array.isArray(b.matches)
      )
        throw new InvalidArgs('Некорректные параметры истории.');
      if (!b.matches.length) throw new InvalidArgs('Пустой список матчей.');
      if (b.matches.length > 2000)
        throw new InvalidArgs('Слишком много матчей за один вызов (максимум 2000).');
      if (!b.leagueId.trim() || !b.season.trim())
        throw new InvalidArgs('Не указана лига или сезон.');
      const incoming: Row[] = b.matches.map((m: unknown) => {
        if (
          !obj(m) ||
          !['id', 'homeId', 'homeName', 'awayId', 'awayName', 'status'].every((k) => str(m[k])) ||
          !['date', 'round'].every((k) => m[k] === undefined || str(m[k])) ||
          !['homeScore', 'awayScore'].every(
            (k) => m[k] == null || (typeof m[k] === 'number' && Number.isSafeInteger(m[k])),
          )
        )
          throw new InvalidArgs('Некорректный матч.');
        return {
          id: m.id as string,
          leagueId: b.leagueId as string,
          leagueName: b.leagueName as string,
          season: b.season as string,
          homeId: m.homeId as string,
          homeName: m.homeName as string,
          awayId: m.awayId as string,
          awayName: m.awayName as string,
          homeScore: (m.homeScore as number | null | undefined) ?? -1,
          awayScore: (m.awayScore as number | null | undefined) ?? -1,
          status: m.status as string,
          date: (m.date as string | undefined) ?? '',
          round: (m.round as string | undefined) ?? '',
        };
      });
      const rows = this.read();
      const index = new Map(rows.map((r, i) => [JSON.stringify([r.leagueId, r.season, r.id]), i]));
      for (const row of incoming) {
        const key = JSON.stringify([row.leagueId, row.season, row.id]);
        const i = index.get(key);
        if (i === undefined) {
          index.set(key, rows.length);
          rows.push(row);
        } else {
          const old = rows[i]!;
          rows[i] = {
            ...old,
            homeScore: row.homeScore,
            awayScore: row.awayScore,
            status: row.status,
            date: row.date,
            round: row.round,
          };
        }
      }
      this.write(rows);
      return {
        leagueId: b.leagueId,
        leagueName: b.leagueName,
        season: b.season,
        matches: incoming.length,
      };
    }
    if (command === 'history_seasons') {
      const groups = new Map<
        string,
        { leagueId: string; leagueName: string; season: string; matches: number }
      >();
      for (const r of this.read()) {
        const key = JSON.stringify([r.leagueId, r.season]);
        const g = groups.get(key);
        if (g) {
          g.matches++;
          if (compare(r.leagueName, g.leagueName) > 0) g.leagueName = r.leagueName;
        } else
          groups.set(key, {
            leagueId: r.leagueId,
            leagueName: r.leagueName,
            season: r.season,
            matches: 1,
          });
      }
      return [...groups.values()].sort(
        (a, b) => compare(b.season, a.season) || compare(a.leagueName, b.leagueName),
      );
    }
    let rows: Row[];
    if (command === 'history_season_matches') {
      if (!str(args.leagueId) || !args.leagueId.trim() || !str(args.season) || !args.season.trim())
        throw new InvalidArgs('Не указана лига или сезон.');
      rows = this.read().filter(
        (r) =>
          r.leagueId === (args.leagueId as string).trim() &&
          r.season === (args.season as string).trim(),
      );
      rows.sort((a, b) => compare(a.date, b.date) || compare(a.id, b.id));
    } else if (command === 'history_head_to_head') {
      if (!str(args.teamA) || !args.teamA.trim() || !str(args.teamB) || !args.teamB.trim())
        throw new InvalidArgs('Не указаны команды.');
      const a = args.teamA.trim(),
        b = args.teamB.trim();
      rows = this.read().filter(
        (r) => (r.homeId === a && r.awayId === b) || (r.homeId === b && r.awayId === a),
      );
      rows.sort((a, b) => compare(b.date, a.date) || compare(b.id, a.id));
      rows = rows.slice(0, 200);
    } else if (command === 'history_team_matches') {
      if (!str(args.teamId) || !args.teamId.trim() || typeof args.finishedOnly !== 'boolean')
        throw new InvalidArgs('Не указана команда.');
      const id = args.teamId.trim();
      rows = this.read().filter(
        (r) =>
          (r.homeId === id || r.awayId === id) &&
          (!args.finishedOnly || (r.status === 'finished' && r.homeScore >= 0 && r.awayScore >= 0)),
      );
      rows.sort((a, b) => compare(b.date, a.date) || compare(b.id, a.id));
      rows = rows.slice(0, 200);
    } else throw new InvalidArgs('Неизвестная команда.');
    return rows.map(output);
  }
}
