import { expect, it } from 'vitest';
import { weekendSchedule } from './weekendSchedule';
import type { JolpicaRace } from './types';
const race: JolpicaRace = {
  season: '2026',
  round: '1',
  raceName: 'Test',
  date: '2026-06-01',
  time: '12:00:00Z',
  Circuit: { circuitId: 'test', circuitName: 'Test' },
};
it('orders provided sessions and treats sprint qualifying aliases as one session', () => {
  const sessions = weekendSchedule({
    ...race,
    Qualifying: { date: '2026-05-31', time: '12:00:00Z' },
    Sprint: { date: '2026-05-30', time: '12:00:00Z' },
    SprintQualifying: { date: '2026-05-29', time: '12:00:00Z' },
    SprintShootout: { date: '2026-05-29', time: '12:00:00Z' },
  });
  expect(sessions.map((s) => s.id)).toEqual(['sprint-qualifying', 'sprint', 'qualifying', 'race']);
});
it('never turns unknown times or impossible dates into a midnight or normalized start', () => {
  expect(weekendSchedule({ ...race, time: undefined })[0]?.start).toBeNull();
  expect(weekendSchedule({ ...race, date: '2026-02-30' })[0]?.start).toBeNull();
  expect(weekendSchedule({ ...race, time: '24:00:00Z' })[0]?.start).toBeNull();
});
