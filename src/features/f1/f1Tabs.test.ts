import { describe, expect, it } from 'vitest';
import { F1_ANALYSIS_MODES, F1_TABS, f1TabFor, type TabId } from './f1Tabs';

describe('f1Tabs', () => {
  it('lists four tabs with Russian labels and icons', () => {
    expect(F1_TABS.map((tab) => tab.label)).toEqual(['Обзор', 'Календарь', 'Зачёты', 'Анализ']);
    for (const tab of F1_TABS) expect(tab.icon).toBeTruthy();
  });

  it('puts compare, pace and session under the analysis tab', () => {
    expect(f1TabFor('compare').label).toBe('Анализ');
    expect(f1TabFor('pace').label).toBe('Анализ');
    expect(f1TabFor('session').label).toBe('Анализ');
    expect(f1TabFor('overview').label).toBe('Обзор');
    expect(f1TabFor('calendar').label).toBe('Календарь');
    expect(f1TabFor('standings').label).toBe('Зачёты');
  });

  it('maps every id to exactly one of the four tabs', () => {
    const expected: Record<TabId, string> = {
      overview: 'overview',
      calendar: 'calendar',
      standings: 'standings',
      compare: 'analysis',
      pace: 'analysis',
      session: 'analysis',
    };
    for (const [id, tab] of Object.entries(expected)) {
      expect(f1TabFor(id as TabId).id).toBe(tab);
    }
  });

  it('names the three analysis modes', () => {
    expect(F1_ANALYSIS_MODES.map((mode) => mode.id)).toEqual(['compare', 'pace', 'session']);
    expect(F1_ANALYSIS_MODES.map((mode) => mode.label)).toEqual([
      'Сравнение пилотов',
      'Темп по кругам',
      'Центр сессии',
    ]);
    for (const mode of F1_ANALYSIS_MODES) expect(mode.icon).toBeTruthy();
  });
});
