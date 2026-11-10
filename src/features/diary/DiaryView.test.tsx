// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  diaryFixture,
  diaryFootballEntry,
  diaryMatch,
  diaryRaceEntry,
} from '../../test/fixtures/diary';
import { viewState } from '../../lib/viewState';
import { hideResult } from '../spoilers/spoilerStore';
import { PREDICTIONS_KEY, type Prediction } from '../games/predictions';
import { DiaryView } from './DiaryView';
import { DiaryMarkButton } from './DiaryMarkButton';
import { DIARY_KEY, footballDiaryEvent } from './diaryModel';
import { readDiary } from './diaryStore';
let host: HTMLDivElement, root: Root;
const onOpen = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  onOpen.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function renderView(seed = true) {
  if (seed) localStorage.setItem(DIARY_KEY, JSON.stringify(diaryFixture));
  await act(async () => root.render(<DiaryView onOpen={onOpen} />));
}
async function click(label: string, within: ParentNode = host) {
  const b = [...within.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.textContent?.trim() === label || el.getAttribute('aria-label') === label,
  );
  expect(b, label).toBeDefined();
  await act(async () => b!.click());
}
async function change(label: string, value: string) {
  const e = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  expect(e, label).not.toBeNull();
  await act(async () => {
    const proto =
      e instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : e instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(e, value);
    e.dispatchEvent(
      new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
function card(title: string) {
  return [...host.querySelectorAll<HTMLElement>('.diary-entry')].find(
    (el) => el.querySelector('h3')?.textContent === title,
  )!;
}

it('does not mark an event watched when its card or editing form is merely opened', async () => {
  await act(async () => root.render(<DiaryMarkButton event={footballDiaryEvent(diaryMatch)} />));
  expect(localStorage.getItem(DIARY_KEY)).toBeNull();
  await click('Отметить просмотр');
  expect(localStorage.getItem(DIARY_KEY)).toBeNull();
  await change('Заметка о просмотре', 'Моя заметка');
  expect(localStorage.getItem(DIARY_KEY)).toBeNull();
  await click('Сохранить отметку');
  expect(readDiary().store.entries).toHaveLength(1);
  expect(readDiary().store.entries[0]?.note).toBe('Моя заметка');
});
it('preserves the personal snapshot while provider names change', async () => {
  localStorage.setItem(DIARY_KEY, JSON.stringify(diaryFixture));
  await act(async () =>
    root.render(
      <DiaryMarkButton
        event={footballDiaryEvent({
          ...diaryMatch,
          home_team: { ...diaryMatch.home_team, name: 'Исправленное имя' },
        })}
      />,
    ),
  );
  await click('Изменить запись о просмотре');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Название события"]')?.value).toBe(
    diaryFootballEntry.event.title,
  );
  await click('Сохранить отметку');
  expect(readDiary().store.entries).toHaveLength(2);
});
it('does not carry an unfinished note into a different event', async () => {
  await act(async () => root.render(<DiaryMarkButton event={footballDiaryEvent(diaryMatch)} />));
  await click('Отметить просмотр');
  await change('Заметка о просмотре', 'Не сохранять в другом матче');
  await act(async () =>
    root.render(<DiaryMarkButton event={footballDiaryEvent({ ...diaryMatch, id: 'other' })} />),
  );
  expect(host.querySelector('textarea')).toBeNull();
  expect(localStorage.getItem(DIARY_KEY)).toBeNull();
});
it('filters personal views by sport and inclusive watch dates', async () => {
  await renderView();
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(2);
  await change('Фильтр по спорту', 'f1');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(1);
  await change('Просмотрено по', '2026-11-08');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(0);
  await click('Сбросить фильтры');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(2);
  await change('Фильтр по тегу', 'тактика');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(1);
});
it('creates an offline manual record with a rating and tags without inventing a source reference', async () => {
  await renderView(false);
  await click('Добавить просмотр вручную');
  await change('Название события', 'Архивная гонка');
  await change('Вид спорта записи', 'f1');
  await change('Дата просмотра', '2026-11-09');
  await change('Сезон записи', '2008');
  await change('Личная оценка', '7');
  await change('Теги записи', 'архив, дождь');
  await change('Заметка о просмотре', 'Хочу пересмотреть финиш.');
  await click('Сохранить отметку');
  expect(readDiary().store.entries[0]).toMatchObject({
    rating: 7,
    tags: ['архив', 'дождь'],
    event: { reference: null, sport: 'f1', season: '2008' },
  });
  expect(host.textContent).toContain('Без привязки к источнику');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(1);
});
it('opens exact football and F1 references without a provider refresh', async () => {
  await renderView();
  await click('Открыть событие', card(diaryFootballEntry.event.title));
  expect(onOpen).toHaveBeenLastCalledWith(diaryFootballEntry.event.reference);
  await click('Открыть событие', card(diaryRaceEntry.event.title));
  expect(onOpen).toHaveBeenLastCalledWith(diaryRaceEntry.event.reference);
});
it('hides private notes, ratings and their seasonal statistics until the result is revealed', async () => {
  await act(async () => hideResult({ kind: 'football', id: diaryMatch.id }));
  localStorage.setItem(
    DIARY_KEY,
    JSON.stringify({
      ...diaryFixture,
      entries: [
        {
          ...diaryFootballEntry,
          event: { ...diaryFootballEntry.event, title: 'Победа 6:0' },
          tags: ['разгром'],
        },
        diaryRaceEntry,
      ],
    }),
  );
  await renderView(false);
  expect(host.textContent).not.toContain('Победа 6:0');
  expect(host.querySelector('[aria-label="Фильтр по тегу"]')?.textContent).not.toContain('разгром');
  expect(host.textContent).not.toContain(diaryFootballEntry.note);
  expect(host.querySelector('.diary-summary')?.textContent).toContain('9');
  expect(host.querySelector('.diary-season-stats')?.textContent).not.toContain('2026/2027');
  await click('Показать результат');
  expect(host.textContent).toContain(diaryFootballEntry.note);
  expect(host.querySelector('.diary-summary')?.textContent).toContain('8,5');
});
it('requires explicit deletion and leaves game predictions untouched', async () => {
  await renderView();
  localStorage.setItem(PREDICTIONS_KEY, 'unchanged');
  await click('Удалить запись', card(diaryFootballEntry.event.title));
  expect(readDiary().store.entries).toHaveLength(2);
  await click('Оставить запись');
  expect(readDiary().store.entries).toHaveLength(2);
  await click('Удалить запись', card(diaryFootballEntry.event.title));
  await click('Подтвердить удаление записи');
  expect(readDiary().store.entries.map((e) => e.id)).toEqual([diaryRaceEntry.id]);
  expect(localStorage.getItem(PREDICTIONS_KEY)).toBe('unchanged');
});
it('shows a related score prediction as separate data, without changing it', async () => {
  const prediction: Prediction = {
    matchId: diaryMatch.id,
    leagueId: 'l_4WFCIZ',
    home: 1,
    away: 1,
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    kickoff: '2026-11-08T18:00:00Z',
    createdAt: '2026-11-07T00:00:00Z',
    updatedAt: '2026-11-07T00:00:00Z',
    rules: 1,
    result: { home: 1, away: 1, seenAt: '2026-11-08T21:00:00Z' },
  };
  const raw = JSON.stringify({ version: 1, items: [prediction] });
  localStorage.setItem(PREDICTIONS_KEY, raw);
  await renderView();
  expect(host.querySelector('.diary-prediction')?.textContent).toContain('мой прогноз 1:1');
  expect(localStorage.getItem(PREDICTIONS_KEY)).toBe(raw);
});
it('keeps the editor and stored note intact after a failed save', async () => {
  await renderView();
  await click('Изменить запись', card(diaryFootballEntry.event.title));
  await change('Заметка о просмотре', 'Изменения ещё в форме');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await click('Сохранить отметку');
  expect(host.textContent).toContain('Изменения остались в форме');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Изменения ещё в форме');
  expect(readDiary().store.entries.find((e) => e.id === diaryFootballEntry.id)?.note).toBe(
    diaryFootballEntry.note,
  );
});
