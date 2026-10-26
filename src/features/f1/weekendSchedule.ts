import type { JolpicaRace, JolpicaSession } from './types';
export interface WeekendSession {
  id: string;
  label: string;
  date: string | null;
  time: string | null;
  start: Date | null;
}
export function weekendSchedule(race: JolpicaRace): WeekendSession[] {
  const out: WeekendSession[] = [];
  const add = (id: string, label: string, value: JolpicaSession | undefined) => {
    if (!value) return;
    const date = value.date ?? null,
      time = value.time ?? null;
    const iso =
      date && time && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}:\d{2}Z$/.test(time)
        ? `${date}T${time}`
        : null;
    const parsed = iso ? new Date(iso) : null;
    out.push({
      id,
      label,
      date,
      time,
      start:
        parsed &&
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 19) === iso?.slice(0, 19)
          ? parsed
          : null,
    });
  };
  add('fp1', 'Практика 1', race.FirstPractice);
  add('fp2', 'Практика 2', race.SecondPractice);
  add('fp3', 'Практика 3', race.ThirdPractice);
  add('sprint-qualifying', 'Спринт-квалификация', race.SprintQualifying ?? race.SprintShootout);
  add('sprint', 'Спринт', race.Sprint);
  add('qualifying', 'Квалификация', race.Qualifying);
  add('race', 'Гонка', { date: race.date, time: race.time });
  return out.sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));
}
