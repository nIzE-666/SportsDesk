import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  statLabel,
  statGroupLabel,
  statsPeriodLabel,
  formatTeamStat,
  formatDistanceStat,
} from './statLabels';
const match = JSON.parse(
  readFileSync(new URL('../../test/fixtures/final-stats.json', import.meta.url), 'utf8'),
).data;
it('translates every group, period and metric in the real five-period final response', () => {
  for (const p of match.periods) {
    expect(statsPeriodLabel(p.period)).toMatch(/[а-я]/i);
    for (const group of p.groups) {
      expect(statGroupLabel(group.group_name).replace(/xGOT|xG|xA/g, '')).not.toMatch(/[a-z]/i);
      for (const metric of group.items)
        expect(statLabel(metric.key, metric.title).replace(/xGOT|xG|xA/g, '')).not.toMatch(
          /[a-z]/i,
        );
    }
  }
});
it('displays metres as kilometres with Russian decimal notation without changing zero or missing values', () => {
  expect(formatTeamStat('141069', 'distance')).toBe('141,069 км');
  expect(formatTeamStat('0', 'integer')).toBe('0');
  expect(formatTeamStat('', 'integer')).toBe('—');
  expect(formatTeamStat('21 (58%)', 'integerWithPercentage')).toBe('21 (58%)');
  expect(formatTeamStat('1.25', 'double')).toBe('1,25');
  expect(formatDistanceStat(2078, 11053)).toBe('2,078 км (18,8%)');
  expect(statLabel('top_speed', 'Top speed')).toBe('Максимальная скорость');
});
