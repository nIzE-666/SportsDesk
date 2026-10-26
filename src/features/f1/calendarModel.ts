import type { JolpicaRace } from './types';
import { weekendSchedule } from './weekendSchedule';

const TITLES: Record<string, [string, string]> = {
  'Australian Grand Prix': ['Гран-при Австралии', 'AU'],
  'Chinese Grand Prix': ['Гран-при Китая', 'CN'],
  'Japanese Grand Prix': ['Гран-при Японии', 'JP'],
  'Bahrain Grand Prix': ['Гран-при Бахрейна', 'BH'],
  'Saudi Arabian Grand Prix': ['Гран-при Саудовской Аравии', 'SA'],
  'Miami Grand Prix': ['Гран-при Майами', 'US'],
  'Canadian Grand Prix': ['Гран-при Канады', 'CA'],
  'Monaco Grand Prix': ['Гран-при Монако', 'MC'],
  'Spanish Grand Prix': ['Гран-при Испании', 'ES'],
  'Barcelona Grand Prix': ['Гран-при Барселоны', 'ES'],
  'Austrian Grand Prix': ['Гран-при Австрии', 'AT'],
  'British Grand Prix': ['Гран-при Великобритании', 'GB'],
  'Belgian Grand Prix': ['Гран-при Бельгии', 'BE'],
  'Hungarian Grand Prix': ['Гран-при Венгрии', 'HU'],
  'Dutch Grand Prix': ['Гран-при Нидерландов', 'NL'],
  'Italian Grand Prix': ['Гран-при Италии', 'IT'],
  'Azerbaijan Grand Prix': ['Гран-при Азербайджана', 'AZ'],
  'Singapore Grand Prix': ['Гран-при Сингапура', 'SG'],
  'United States Grand Prix': ['Гран-при США', 'US'],
  'Mexico City Grand Prix': ['Гран-при Мехико', 'MX'],
  'Mexican Grand Prix': ['Гран-при Мексики', 'MX'],
  'São Paulo Grand Prix': ['Гран-при Сан-Паулу', 'BR'],
  'Sao Paulo Grand Prix': ['Гран-при Сан-Паулу', 'BR'],
  'Brazilian Grand Prix': ['Гран-при Бразилии', 'BR'],
  'Las Vegas Grand Prix': ['Гран-при Лас-Вегаса', 'US'],
  'Qatar Grand Prix': ['Гран-при Катара', 'QA'],
  'Abu Dhabi Grand Prix': ['Гран-при Абу-Даби', 'AE'],
  'Emilia Romagna Grand Prix': ['Гран-при Эмилии-Романьи', 'IT'],
};
export function racePresentation(race: JolpicaRace) {
  const [title, country] = TITLES[race.raceName] ?? [race.raceName, ''];
  const flag = country
    ? [...country].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('')
    : '🏁';
  return { title, country, flag };
}
export function raceStart(race: JolpicaRace): Date | null {
  return weekendSchedule(race).find((s) => s.id === 'race')?.start ?? null;
}
export function calendarPhase(race: JolpicaRace, now: number): 'upcoming' | 'past' {
  const start = raceStart(race);
  // The label is about the schedule, never a claim that results are published.
  return (
    start
      ? start.getTime() + 3 * 60 * 60_000 < now
      : /^\d{4}-\d{2}-\d{2}$/.test(race.date) &&
        race.date < new Date(now).toISOString().slice(0, 10)
  )
    ? 'past'
    : 'upcoming';
}
export function orderedCalendar(races: JolpicaRace[]) {
  return [...new Map(races.map((r) => [`${r.season}:${r.round}`, r])).values()].sort(
    (a, b) => a.date.localeCompare(b.date) || Number(a.round) - Number(b.round),
  );
}
export function calendarMonth(race: JolpicaRace, timeZone: string) {
  const exact = raceStart(race);
  const date = exact ?? new Date(`${race.date}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return 'Дата уточняется';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      month: 'long',
      year: 'numeric',
      timeZone: exact ? timeZone : 'UTC',
    }).format(date);
  } catch {
    return race.date.slice(0, 7);
  }
}
