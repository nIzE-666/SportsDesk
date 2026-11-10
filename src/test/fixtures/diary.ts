import {
  footballDiaryEvent,
  f1DiaryEvent,
  newDiaryEntry,
  type DiaryEntry,
} from '../../features/diary/diaryModel';
import { tacticMatch } from './tactics';
import type { JolpicaRace } from '../../features/f1/types';
export const diaryMatch = {
  ...tacticMatch,
  season: '2026/2027',
  league: { id: 'l_4WFCIZ', name: 'Premier League' },
};
export const diaryRace: JolpicaRace = {
  season: '2026',
  round: '3',
  raceName: 'Japanese Grand Prix',
  date: '2026-11-08',
  time: '12:00:00Z',
  Circuit: {
    circuitId: 'suzuka',
    circuitName: 'Suzuka Circuit',
    Location: { country: 'Japan', locality: 'Suzuka' },
  },
};
const stamp = '2026-11-09T00:00:00Z';
export const diaryFootballEntry: DiaryEntry = {
  ...newDiaryEntry(footballDiaryEvent(diaryMatch), '2026-11-08', 'fixture', stamp),
  note: 'Смотрели с друзьями. Запомнился высокий прессинг после перерыва.',
  tags: ['друзья', 'тактика'],
  rating: 8,
};
export const diaryRaceEntry: DiaryEntry = {
  ...newDiaryEntry(
    { ...f1DiaryEvent(diaryRace), title: 'Гран-при Японии · гонка' },
    '2026-11-09',
    'race',
    stamp,
  ),
  note: 'Интересно было сравнить темп на разных шинах. Хочу пересмотреть второй отрезок.',
  tags: ['шины', 'пересмотреть'],
  rating: 9,
};
export const diaryFixture = { version: 1 as const, entries: [diaryFootballEntry, diaryRaceEntry] };
