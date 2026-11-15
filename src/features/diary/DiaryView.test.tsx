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
import { DIARY_KEY, footballDiaryEvent, type DiaryEntry } from './diaryModel';
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
  expect(host.querySelector('.diary-summary')).toBeNull();
  expect(host.querySelector('.diary-filter-panel')).toBeNull();
  expect(host.querySelector('.diary-season-stats')).toBeNull();
  expect(host.querySelector('.diary-import')).not.toBeNull();
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
  // A single view has nothing to filter, summarise or split by season.
  expect(host.querySelector('.diary-filter-panel')).toBeNull();
  expect(host.querySelector('.diary-summary')).toBeNull();
  expect(host.querySelector('.diary-season-stats')).toBeNull();
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
  // Only the open race is left, so there is no season table to split it into.
  expect(host.querySelector('.diary-season-stats')).toBeNull();
  await click('Показать результат');
  expect(host.textContent).toContain(diaryFootballEntry.note);
  expect(host.querySelector('.diary-summary')?.textContent).toContain('8,5');
  expect(host.querySelector('.diary-season-stats')?.textContent).toContain('2026/2027');
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

const manualEntry = (i: number, patch: Partial<DiaryEntry> = {}): DiaryEntry => ({
  ...diaryFootballEntry,
  id: `manual:view-${i}`,
  event: { ...diaryFootballEntry.event, title: `Матч ${i}`, reference: null },
  tags: [],
  rating: null,
  ...patch,
});
async function renderWith(entries: DiaryEntry[]) {
  localStorage.setItem(DIARY_KEY, JSON.stringify({ version: 1, entries }));
  await act(async () => root.render(<DiaryView onOpen={onOpen} />));
}
const tileTexts = () =>
  [...host.querySelectorAll('.diary-summary > div')].map((el) => el.textContent ?? '');
const filterLabels = () =>
  [...host.querySelectorAll('.diary-filter-panel [aria-label]')].map((el) =>
    el.getAttribute('aria-label'),
  );
const resetButtons = () =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Сбросить фильтры');

it('shows one saved view without tiles, filters or a season table', async () => {
  await renderWith([diaryFootballEntry]);
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(1);
  expect(host.querySelector('.diary-summary')).toBeNull();
  expect(host.querySelector('.diary-filter-panel')).toBeNull();
  expect(host.querySelector('.diary-season-stats')).toBeNull();
  expect(host.querySelector('.diary-records h2')?.textContent).toBe('Мои просмотры · 1');
  expect(host.querySelector('.diary-import')).not.toBeNull();
});
it('shows several views of one sport without zero tiles or filters that change nothing', async () => {
  await renderWith([
    manualEntry(1, { rating: 7, tags: ['друзья'] }),
    manualEntry(2, { rating: 8, tags: ['друзья', 'вечер'] }),
    manualEntry(3, { rating: null, tags: ['друзья'] }),
  ]);
  expect(tileTexts()).toEqual(['Просмотров3', 'Средняя личная оценка7,5оценено: 2']);
  expect(host.textContent).not.toContain('Формула 1');
  expect(filterLabels()).toEqual(['Фильтр по тегу', 'Поиск по дневнику']);
  expect(host.querySelector('.diary-season-stats')).toBeNull();
  expect(host.querySelector('.diary-records h2')?.textContent).toBe('Мои просмотры · 3');
  // No filter is set yet, so there is nothing to reset.
  expect(resetButtons()).toHaveLength(0);
});
it('keeps a tag filter out of the way while every view carries the same tag', async () => {
  await renderWith([manualEntry(1, { tags: ['друзья'] }), manualEntry(2, { tags: ['друзья'] })]);
  expect(filterLabels()).toEqual(['Поиск по дневнику']);
});
it('shows matches and races with every tile and a split by season', async () => {
  await renderWith(diaryFixture.entries);
  expect(tileTexts()).toEqual([
    'Просмотров2',
    'Футбол1',
    'Формула 11',
    'Средняя личная оценка8,5оценено: 2',
  ]);
  expect(filterLabels()).toEqual([
    'Фильтр по спорту',
    'Фильтр по сезону',
    'Просмотрено с',
    'Просмотрено по',
    'Фильтр по тегу',
    'Поиск по дневнику',
  ]);
  expect(host.querySelectorAll('.diary-season-stats tbody tr')).toHaveLength(2);
  expect(resetButtons()).toHaveLength(0);
});
it('counts what the filter leaves and offers a reset only while a filter is set', async () => {
  await renderWith(diaryFixture.entries);
  await change('Фильтр по спорту', 'football');
  expect(host.querySelector('.diary-records h2')?.textContent).toBe('Мои просмотры · 1 из 2');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(1);
  // One view is left: no tiles, no season table, but the controls stay to undo the filter.
  expect(host.querySelector('.diary-summary')).toBeNull();
  expect(host.querySelector('.diary-season-stats')).toBeNull();
  expect(resetButtons()).toHaveLength(1);
  await click('Сбросить фильтры');
  expect(host.querySelector('.diary-records h2')?.textContent).toBe('Мои просмотры · 2');
  expect(resetButtons()).toHaveLength(0);
});
it('says so once and offers one reset when the filters leave nothing', async () => {
  await renderWith(diaryFixture.entries);
  await change('Поиск по дневнику', 'такого нет нигде');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(0);
  expect(host.querySelector('.diary-summary')).toBeNull();
  expect(host.querySelector('.diary-season-stats')).toBeNull();
  expect(host.querySelectorAll('.state-block')).toHaveLength(1);
  expect(host.querySelector('.state-block')?.textContent).toContain('Таких просмотров нет');
  // The panel stays so the filters can be adjusted, but only the empty state offers the reset.
  expect(host.querySelector('.diary-filter-panel')).not.toBeNull();
  expect(resetButtons()).toHaveLength(1);
  expect(host.querySelector('.state-block')?.contains(resetButtons()[0] ?? null)).toBe(true);
  await click('Сбросить фильтры');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(2);
  expect(host.querySelector('.state-block')).toBeNull();
});
it('recovers from a remembered filter that no longer matches any view', async () => {
  sessionStorage.setItem(
    'sportsdesk.view.diary.filters',
    JSON.stringify({ sport: 'f1', from: '', to: '', season: 'All', tag: '', query: '' }),
  );
  await renderWith([manualEntry(1)]);
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(0);
  expect(host.querySelector('.state-block')?.textContent).toContain('Таких просмотров нет');
  expect(resetButtons()).toHaveLength(1);
  await click('Сбросить фильтры');
  expect(host.querySelectorAll('.diary-entry')).toHaveLength(1);
});
