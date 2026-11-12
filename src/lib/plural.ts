/** Russian plural form for a count: 1 событие, 2 события, 5 событий, 21 событие. */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const hundred = Math.abs(count) % 100;
  const unit = hundred % 10;
  if (hundred > 10 && hundred < 20) return many;
  if (unit === 1) return one;
  return unit >= 2 && unit <= 4 ? few : many;
}
