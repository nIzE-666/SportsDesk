/** Человеческие названия источников данных: так их видно в строке «Данные: …». */
const LABELS: Record<string, string> = {
  pitch: 'PitchAPI',
  pitchapi: 'PitchAPI',
  sportscore: 'SportScore',
  livescore: 'LiveScore',
  espn: 'ESPN',
  jolpica: 'Jolpica',
  openf1: 'OpenF1',
};

/** Ключ источника («jolpica») → название («Jolpica»). Незнакомые значения остаются как есть. */
export function sourceLabel(source: string): string {
  const trimmed = source.trim();
  return LABELS[trimmed.toLowerCase()] ?? trimmed;
}

/** Уникальные названия по порядку появления; составные значения «A / B» разделяются. */
export function sourceLabels(sources: readonly string[]): string[] {
  const names = sources
    .flatMap((source) => source.split(/\s*\/\s*/u))
    .map(sourceLabel)
    .filter(Boolean);
  return [...new Set(names)];
}
