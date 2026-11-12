import { useRef, useState } from 'react';
import { useViewState } from '../../lib/useViewState';
import { formatDate, getUserTimezone } from '../football/storage';
import { SpoilerGate } from '../spoilers/SpoilerGate';
import { spoilerKey, useSpoilerSet } from '../spoilers/spoilerStore';
import { settle, usePredictions } from '../games/predictions';
import { DiaryEntryForm } from './DiaryEntryForm';
import { diarySpoiler } from './DiaryMarkButton';
import { EmptyBlock } from '../../components/StateViews';
import { deleteDiaryEntry, importDiary, useDiary } from './diaryStore';
import {
  diaryFilterActive,
  diaryFilterControls,
  diaryReadError,
  diarySeasons,
  diaryTiles,
  filterDiary,
  newDiaryEntry,
  parseDiaryText,
  summarizeDiary,
  todayInTimezone,
  validDay,
  EMPTY_DIARY_FILTER,
  MAX_DIARY_BYTES,
  type DiaryEntry,
  type DiaryFilter,
  type DiaryReference,
  type DiaryStore,
  type DiaryTileId,
} from './diaryModel';
import './diary.css';

const EMPTY_FILTER = EMPTY_DIARY_FILTER;
const TILE_LABELS: Record<DiaryTileId, string> = {
  total: 'Просмотров',
  football: 'Футбол',
  f1: 'Формула 1',
  average: 'Средняя личная оценка',
};
const sportName = (sport: string) => (sport === 'football' ? 'Футбол' : 'Формула 1');
const number = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
function EntryGate({ entry, children }: { entry: DiaryEntry; children: React.ReactNode }) {
  const target = diarySpoiler(entry.event);
  return target ? (
    <SpoilerGate kind={target.kind} id={target.id}>
      {children}
    </SpoilerGate>
  ) : (
    <>{children}</>
  );
}
export function DiaryView({ onOpen }: { onOpen: (reference: DiaryReference) => void }) {
  const state = useDiary(),
    { items: predictions } = usePredictions(),
    spoilers = useSpoilerSet();
  const fileInput = useRef<HTMLInputElement>(null);
  const timezone = getUserTimezone();
  const [filter, setFilter] = useViewState<DiaryFilter>(
    'diary.filters',
    EMPTY_FILTER,
    (v) =>
      !!v &&
      typeof v === 'object' &&
      Object.keys(EMPTY_FILTER).every(
        (k) => k in v && typeof (v as Record<string, unknown>)[k] === 'string',
      ) &&
      ['All', 'football', 'f1'].includes((v as DiaryFilter).sport),
  );
  const [editing, setEditing] = useState<DiaryEntry | null>(null),
    [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [page, setPage] = useState(1);
  const [preview, setPreview] = useState<DiaryStore | null>(null),
    [overwrite, setOverwrite] = useState(false);
  const invalidDates =
    (filter.from && !validDay(filter.from)) ||
    (filter.to && !validDay(filter.to)) ||
    (filter.from && filter.to && filter.from > filter.to);
  const entries = invalidDates ? [] : filterDiary(state.store.entries, filter);
  const isHidden = (entry: DiaryEntry) => {
    const target = diarySpoiler(entry.event);
    return target ? spoilers.has(spoilerKey(target.kind, target.id)) : false;
  };
  const visibleForStats = entries.filter((e) => !isHidden(e)),
    seasons = diarySeasons(visibleForStats);
  const summary = summarizeDiary(entries, visibleForStats),
    tiles = diaryTiles(summary),
    controls = diaryFilterControls(state.store.entries, filter, isHidden),
    filtered = diaryFilterActive(filter),
    showPanel =
      controls.sport ||
      controls.seasons.length > 0 ||
      controls.dates ||
      controls.tags.length > 0 ||
      controls.search ||
      (filtered && entries.length > 0);
  const pageCount = Math.max(1, Math.ceil(entries.length / 25)),
    activePage = Math.min(page, pageCount);
  const shown = entries.slice((activePage - 1) * 25, activePage * 25);
  const set = (patch: Partial<DiaryFilter>) => {
    setFilter({ ...filter, ...patch });
    setPage(1);
  };
  const resetFilters = () => {
    setFilter(EMPTY_FILTER);
    setPage(1);
  };
  const attempt = (run: () => void) => {
    setError('');
    try {
      run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Действие не удалось.');
    }
  };
  const open = (entry: DiaryEntry) => {
    if (entry.event.reference) onOpen(entry.event.reference);
  };
  const newEntry = () => {
    setMessage('');
    setEditing(
      newDiaryEntry(
        { sport: 'football', title: '', season: null, eventDate: null, reference: null },
        todayInTimezone(getUserTimezone()),
        crypto.randomUUID(),
      ),
    );
  };
  const common =
    preview?.entries.filter((e) => state.store.entries.some((current) => current.id === e.id))
      .length ?? 0;
  return (
    <section className="diary-view" aria-label="Дневник просмотра">
      <header className="diary-heading">
        <div>
          <h1>Дневник просмотра</h1>
          <p className="muted">Ваши отметки и заметки хранятся на этом компьютере.</p>
        </div>
        <div className="diary-actions">
          <button className="ghost-btn" disabled={!state.writable || !!editing} onClick={newEntry}>
            Добавить просмотр вручную
          </button>
          {state.store.entries.length > 0 && (
            <button
              className="ghost-btn"
              disabled={!state.writable || !state.store.entries.length}
              onClick={() =>
                attempt(() => {
                  const blob = new Blob([JSON.stringify(state.store)], {
                      type: 'application/json',
                    }),
                    url = URL.createObjectURL(blob),
                    a = document.createElement('a');
                  a.href = url;
                  a.download = `sportsdesk-diary-${todayInTimezone(getUserTimezone())}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setMessage(
                    'Экспорт дневника подготовлен. Он содержит все записи, включая скрытые заметки.',
                  );
                })
              }
            >
              Экспортировать дневник
            </button>
          )}
        </div>
      </header>
      {state.error && (
        <p className="diary-notice" role="alert">
          {state.error}
        </p>
      )}
      {error && (
        <p className="diary-notice" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="diary-notice" role="status">
          {message}
        </p>
      )}
      {editing && (
        <EntryGate entry={editing}>
          <DiaryEntryForm
            key={editing.id}
            entry={editing}
            writable={state.writable}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setMessage('Запись сохранена. Данные источника не изменены.');
            }}
          />
        </EntryGate>
      )}
      {tiles.length > 0 && (
        <div className="diary-summary" aria-label="Итоги просмотра">
          {tiles.map((tile) => (
            <div key={tile.id}>
              <strong>{number(tile.value)}</strong>
              <span>
                {tile.id === 'total' && filtered ? 'Просмотров по фильтру' : TILE_LABELS[tile.id]}
                {tile.id === 'average' ? ` · оценено: ${summary.rated}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {showPanel && (
        <section className="panel diary-filter-panel" aria-label="Фильтры дневника">
          <div className="diary-form-grid">
            {controls.sport && (
              <label>
                Вид спорта
                <select
                  aria-label="Фильтр по спорту"
                  value={filter.sport}
                  onChange={(e) => set({ sport: e.target.value as DiaryFilter['sport'] })}
                >
                  <option value="All">Все виды спорта</option>
                  <option value="football">Футбол</option>
                  <option value="f1">Формула 1</option>
                </select>
              </label>
            )}
            {controls.seasons.length > 0 && (
              <label>
                Сезон
                <select
                  aria-label="Фильтр по сезону"
                  value={filter.season}
                  onChange={(e) => set({ season: e.target.value })}
                >
                  <option value="All">Все сезоны</option>
                  {controls.seasons.map((s) => (
                    <option key={s} value={s}>
                      {s === 'Unknown' ? 'Без сезона' : s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {controls.dates && (
              <>
                <label>
                  Просмотрено с
                  <input
                    aria-label="Просмотрено с"
                    type="date"
                    value={filter.from}
                    onChange={(e) => set({ from: e.target.value })}
                  />
                </label>
                <label>
                  Просмотрено по
                  <input
                    aria-label="Просмотрено по"
                    type="date"
                    value={filter.to}
                    onChange={(e) => set({ to: e.target.value })}
                  />
                </label>
              </>
            )}
            {controls.tags.length > 0 && (
              <label>
                Тег
                <select
                  aria-label="Фильтр по тегу"
                  value={filter.tag}
                  onChange={(e) => set({ tag: e.target.value })}
                >
                  <option value="">Все теги</option>
                  {controls.tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {controls.search && (
              <label>
                Поиск
                <input
                  aria-label="Поиск по дневнику"
                  type="search"
                  value={filter.query}
                  onChange={(e) => set({ query: e.target.value })}
                  placeholder="Событие, заметка или тег"
                />
              </label>
            )}
          </div>
          {filtered && entries.length > 0 && (
            <button className="ghost-btn" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          )}
          {invalidDates && (
            <p className="diary-notice" role="alert">
              Проверьте даты: начало периода должно быть не позже окончания.
            </p>
          )}
        </section>
      )}
      <section className="diary-records" aria-label="История просмотров">
        {state.store.entries.length > 0 && (
          <div className="diary-heading">
            <h2>
              Мои просмотры · {filtered ? `${entries.length} из ` : ''}
              {state.store.entries.length}
            </h2>
          </div>
        )}
        {!state.store.entries.length ? (
          <div className="panel">
            <h3>Сохраните первый просмотр</h3>
            <p>В карточке матча или гонки нажмите «Отметить просмотр».</p>
          </div>
        ) : !entries.length ? (
          <EmptyBlock title="Таких просмотров нет">
            <button className="ghost-btn" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          </EmptyBlock>
        ) : (
          shown.map((entry) => {
            const ref = entry.event.reference,
              prediction =
                ref?.kind === 'football'
                  ? predictions.find((p) => p.matchId === ref.matchId)
                  : undefined;
            const settled = prediction ? settle(prediction) : null;
            return (
              <article className="panel diary-entry" key={entry.id}>
                <div className="diary-heading">
                  <div>
                    <span className="muted small">
                      {sportName(entry.event.sport)} ·{' '}
                      {isHidden(entry) ? 'Результат скрыт' : (entry.event.season ?? 'Без сезона')}
                    </span>
                    <h3>{isHidden(entry) ? 'Событие без спойлеров' : entry.event.title}</h3>
                    <p className="muted small">
                      Просмотрено {formatDate(entry.watchedOn, timezone)}
                      {entry.event.eventDate
                        ? ` · Событие ${formatDate(entry.event.eventDate, timezone)}`
                        : ''}
                    </p>
                  </div>
                  <div className="diary-actions">
                    {ref ? (
                      <button className="ghost-btn" onClick={() => open(entry)}>
                        Открыть событие
                      </button>
                    ) : (
                      <span className="muted small">Без привязки к источнику</span>
                    )}
                    <button
                      className="ghost-btn"
                      disabled={!!editing || !state.writable}
                      onClick={() => {
                        setEditing(entry);
                        setMessage('');
                      }}
                    >
                      Изменить запись
                    </button>
                    <button
                      className="ghost-btn"
                      disabled={!state.writable}
                      onClick={() => setDeleting(entry.id)}
                    >
                      Удалить запись
                    </button>
                  </div>
                </div>
                <EntryGate entry={entry}>
                  <div className="diary-entry-body">
                    <span className="diary-rating">
                      Моя оценка: {entry.rating === null ? 'без оценки' : `${entry.rating} / 10`}
                    </span>
                    {entry.note && <p className="diary-note">{entry.note}</p>}
                    {!!entry.tags.length && (
                      <ul className="diary-tags" aria-label="Теги записи">
                        {entry.tags.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    )}
                    {prediction && (
                      <p className="diary-prediction">
                        Угадай счёт · мой прогноз {prediction.home}:{prediction.away}
                        {settled?.state === 'scored'
                          ? ` · очки: ${settled.points}`
                          : settled?.state === 'void'
                            ? ' · Не учитывается'
                            : ' · Ожидает итога'}
                        . Прогноз хранится отдельно от дневника.
                      </p>
                    )}
                  </div>
                </EntryGate>
                {deleting === entry.id && (
                  <div className="diary-notice" role="alert">
                    <p>Удалить эту личную запись? Данные события и прогноз останутся.</p>
                    <div className="diary-actions">
                      <button
                        className="ghost-btn"
                        onClick={() =>
                          attempt(() => {
                            deleteDiaryEntry(entry.id);
                            setDeleting(null);
                            if (editing?.id === entry.id) setEditing(null);
                            setMessage('Запись удалена из дневника.');
                          })
                        }
                      >
                        Подтвердить удаление записи
                      </button>
                      <button className="ghost-btn" onClick={() => setDeleting(null)}>
                        Оставить запись
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
        {pageCount > 1 && (
          <nav className="diary-actions" aria-label="Страницы дневника">
            <button
              className="ghost-btn"
              disabled={activePage === 1}
              onClick={() => setPage(activePage - 1)}
            >
              Предыдущие записи
            </button>
            <span>
              {activePage} / {pageCount}
            </span>
            <button
              className="ghost-btn"
              disabled={activePage === pageCount}
              onClick={() => setPage(activePage + 1)}
            >
              Следующие записи
            </button>
          </nav>
        )}
      </section>
      {seasons.length > 1 && (
        <section className="panel diary-season-stats" aria-label="Статистика просмотра по сезонам">
          <h2>По сезонам</h2>
          <p className="muted small">
            Статистика по текущим фильтрам. Скрытые записи не участвуют в оценках и таблице сезонов.
          </p>
          <div className="diary-table-wrap">
            <table>
              <caption>Ваша история по сезонам</caption>
              <thead>
                <tr>
                  <th scope="col">Спорт</th>
                  <th scope="col">Сезон</th>
                  <th scope="col">Просмотры</th>
                  <th scope="col">Оценки</th>
                  <th scope="col">Средняя оценка</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((s) => (
                  <tr key={`${s.sport}:${s.season}`}>
                    <td>{sportName(s.sport)}</td>
                    <td>{s.season ?? 'Не указан'}</td>
                    <td>{s.count}</td>
                    <td>{s.rated}</td>
                    <td>{number(s.average)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel diary-import" aria-label="Перенос дневника">
        <h2>Перенести дневник</h2>
        <p className="muted">
          Экспорт — только записи дневника. Полная копия профиля — в настройках.
        </p>
        <div className="diary-actions">
          <button
            className="ghost-btn"
            disabled={!state.writable || !!editing}
            onClick={() => fileInput.current?.click()}
          >
            Выбрать JSON-файл
          </button>
          <span className="muted small">JSON · до 190 КБ</span>
        </div>
        <input
          ref={fileInput}
          hidden
          aria-label="Импорт дневника"
          type="file"
          accept=".json,application/json"
          disabled={!state.writable || !!editing}
          onChange={async (e) => {
            const input = e.currentTarget,
              file = input.files?.[0];
            if (!file) return;
            setError('');
            setPreview(null);
            try {
              if (file.size > MAX_DIARY_BYTES) throw new Error('Файл дневника слишком большой.');
              const text = await file.text(),
                data = parseDiaryText(text);
              if (!data) throw new Error(diaryReadError(text));
              setPreview(data);
              setOverwrite(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Файл не удалось прочитать.');
            } finally {
              input.value = '';
            }
          }}
        />
        {preview && (
          <div className="diary-notice">
            <p>
              Записей в файле: {preview.entries.length}, новых: {preview.entries.length - common},
              совпадающих: {common}. Текущие совпадения сохраняются, пока вы явно не выберете
              замену.
            </p>
            {common > 0 && (
              <label className="diary-checkbox">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                />
                Заменить совпадающие записи данными из файла
              </label>
            )}
            <div className="diary-actions">
              <button
                className="ghost-btn"
                disabled={!!editing || !state.writable}
                onClick={() =>
                  attempt(() => {
                    importDiary(preview, overwrite);
                    setPreview(null);
                    setMessage('Импорт дневника завершён.');
                  })
                }
              >
                Подтвердить импорт дневника
              </button>
              <button className="ghost-btn" onClick={() => setPreview(null)}>
                Отменить импорт
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
