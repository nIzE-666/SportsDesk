/** Формы слова для числа: [1, 2–4, 5 и больше], например ['матч', 'матча', 'матчей']. */
export type PluralForms = readonly [one: string, few: string, many: string];

export const MATCHES: PluralForms = ['матч', 'матча', 'матчей'];
export const PLAYERS: PluralForms = ['игрок', 'игрока', 'игроков'];
export const STAGES: PluralForms = ['этап', 'этапа', 'этапов'];
export const LAPS: PluralForms = ['круг', 'круга', 'кругов'];
export const LAP_PAIRS: PluralForms = ['пара', 'пары', 'пар'];

/** «1 матч», «2 матча», «5 матчей», «11 матчей», «21 матч». */
export function pluralRu(count: number, forms: PluralForms): string {
  const whole = Math.abs(Math.trunc(count));
  const tail = whole % 100;
  if (tail >= 11 && tail <= 14) return forms[2];
  const last = whole % 10;
  return last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
}

/** Число вместе со словом: «2 матча». */
export const countRu = (count: number, forms: PluralForms): string =>
  `${count} ${pluralRu(count, forms)}`;
