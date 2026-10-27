import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { InvalidArgs } from './history';

type Event = {
  id: string;
  sport: 'football' | 'f1';
  kind: string;
  title: string;
  body: string;
  occurredAt: number;
  read: boolean;
  matchId?: string;
  leagueId?: string;
  season?: string;
  round?: string;
};
const defaultPath = join(process.cwd(), 'node_modules', '.cache', 'sportsdesk-dev', 'events.json');
export class EventStore {
  constructor(private readonly path = defaultPath) {}
  private read(): Event[] {
    try {
      const raw = readFileSync(this.path, 'utf8');
      if (raw.length > 4 * 1024 * 1024) throw new Error('Список событий слишком большой.');
      const events: unknown = JSON.parse(raw);
      if (!Array.isArray(events)) throw new Error('Список событий не читается.');
      if (
        events.some(
          (e) =>
            !e ||
            typeof e !== 'object' ||
            typeof e.id !== 'string' ||
            !e.id ||
            Buffer.byteLength(e.id, 'utf8') > 1024 ||
            !['football', 'f1'].includes(e.sport) ||
            typeof e.kind !== 'string' ||
            typeof e.title !== 'string' ||
            typeof e.body !== 'string' ||
            typeof e.read !== 'boolean' ||
            !Number.isFinite(e.occurredAt) ||
            Math.abs(e.occurredAt) > 8.64e15,
        )
      )
        throw new Error('Список событий не читается.');
      return (events as Event[])
        .filter(
          (e) => typeof e.occurredAt === 'number' && e.occurredAt >= Date.now() - 30 * 86400000,
        )
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .slice(0, 500);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  dispatch(command: string, args: Record<string, unknown>): unknown {
    if (command === 'event_center_list') return this.read();
    if (
      command !== 'event_center_mark_read' ||
      !Array.isArray(args.ids) ||
      args.ids.length > 500 ||
      !args.ids.every(
        (id: unknown) =>
          typeof id === 'string' && id.length > 0 && Buffer.byteLength(id, 'utf8') <= 1024,
      )
    )
      throw new InvalidArgs('Некорректные идентификаторы событий.');
    const ids = new Set(args.ids);
    const events = this.read().map((e) => (ids.has(e.id) ? { ...e, read: true } : e));
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(events), 'utf8');
    renameSync(temp, this.path);
    return null;
  }
}
