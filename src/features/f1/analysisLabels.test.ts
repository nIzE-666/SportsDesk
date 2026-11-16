import { describe, expect, it } from 'vitest';
import { resultStatusLabel, sessionLabel, sessionNameLabel } from './analysisLabels';

describe('session names', () => {
  it.each([
    ['Race', 'Гонка'],
    ['Qualifying', 'Квалификация'],
    ['Sprint', 'Спринт'],
    ['Sprint Qualifying', 'Квалификация спринта'],
    ['Sprint Shootout', 'Квалификация спринта'],
    ['Practice 1', 'Практика 1'],
    ['Practice 2', 'Практика 2'],
    ['Practice 3', 'Практика 3'],
    ['RACE', 'Гонка'],
    ['qualifying', 'Квалификация'],
  ])('translates %s', (source, expected) => {
    expect(sessionNameLabel(source)).toBe(expected);
  });

  it('keeps an unknown name as it is', () => {
    expect(sessionNameLabel('Warm Up')).toBe('Warm Up');
  });

  it('returns nothing for a missing or blank name', () => {
    expect(sessionNameLabel(undefined)).toBeNull();
    expect(sessionNameLabel(null)).toBeNull();
    expect(sessionNameLabel('  ')).toBeNull();
  });

  it('does not add a date separator when the date is missing', () => {
    expect(sessionLabel({ session_key: 1, meeting_key: 2, session_name: 'Race' })).toBe('Гонка');
  });

  it('joins the translated name and the date', () => {
    expect(
      sessionLabel({
        session_key: 1,
        meeting_key: 2,
        session_name: 'Qualifying',
        date_start: '2026-10-02T04:00:00Z',
      }),
    ).toMatch(/^Квалификация · /u);
  });
});

describe('race result statuses', () => {
  it.each([
    ['Finished', 'Финиш'],
    ['+1 Lap', '+1 круг'],
    ['+2 Laps', '+2 круга'],
    ['+5 Laps', '+5 кругов'],
    ['+11 Laps', '+11 кругов'],
    ['+21 Laps', '+21 круг'],
    ['DNF', 'Сход'],
    ['Accident', 'Авария'],
    ['Collision', 'Столкновение'],
    ['Engine', 'Двигатель'],
    ['Gearbox', 'Коробка передач'],
    ['Disqualified', 'Дисквалификация'],
    ['Did not start', 'Не стартовал'],
    ['Withdrew', 'Снялся'],
  ])('translates %s', (source, expected) => {
    expect(resultStatusLabel(source)).toBe(expected);
  });

  it('keeps an unknown status as it comes', () => {
    expect(resultStatusLabel('Safety car finished')).toBe('Safety car finished');
  });

  it('returns nothing for a missing or blank status', () => {
    expect(resultStatusLabel(undefined)).toBeNull();
    expect(resultStatusLabel(null)).toBeNull();
    expect(resultStatusLabel('  ')).toBeNull();
  });
});
