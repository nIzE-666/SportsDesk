import { useState } from 'react';
import { isDiaryEntry, parseTags, type DiaryEntry } from './diaryModel';
import { saveDiaryEntry } from './diaryStore';

export function DiaryEntryForm({
  entry,
  writable,
  onSaved,
  onCancel,
}: {
  entry: DiaryEntry;
  writable: boolean;
  onSaved: (entry: DiaryEntry) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(entry.event.title),
    [sport, setSport] = useState(entry.event.sport);
  const [season, setSeason] = useState(entry.event.season ?? ''),
    [eventDate, setEventDate] = useState(entry.event.eventDate?.slice(0, 10) ?? '');
  const [watchedOn, setWatchedOn] = useState(entry.watchedOn),
    [rating, setRating] = useState(entry.rating === null ? '' : String(entry.rating));
  const [note, setNote] = useState(entry.note),
    [tags, setTags] = useState(entry.tags.join(', '));
  const [error, setError] = useState('');
  return (
    <form
      className="diary-editor panel"
      aria-label="Запись о просмотре"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        try {
          const next: DiaryEntry = {
            ...entry,
            event: {
              ...entry.event,
              title: title.trim(),
              sport,
              season: season.trim() || null,
              eventDate: entry.event.reference ? entry.event.eventDate : eventDate || null,
            },
            watchedOn,
            note,
            tags: parseTags(tags),
            rating: rating === '' ? null : Number(rating),
          };
          if (!isDiaryEntry(next))
            throw new Error('Проверьте название, дату просмотра и оценку от 1 до 10.');
          onSaved(saveDiaryEntry(next));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Не удалось сохранить запись.');
        }
      }}
    >
      <h3>
        {entry.note || entry.rating !== null ? 'Моя запись о просмотре' : 'Отметить просмотр'}
      </h3>
      <p className="muted small">
        Сохранение подтверждает вашу ручную отметку. Открытие события или канала ничего не отмечает
        автоматически.
      </p>
      <div className="diary-form-grid">
        <label className="diary-wide">
          Событие
          <input
            aria-label="Название события"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {!entry.event.reference && (
          <label>
            Вид спорта
            <select
              aria-label="Вид спорта записи"
              value={sport}
              onChange={(e) => setSport(e.target.value as typeof sport)}
            >
              <option value="football">Футбол</option>
              <option value="f1">Формула 1</option>
            </select>
          </label>
        )}
        <label>
          Дата просмотра
          <input
            aria-label="Дата просмотра"
            type="date"
            required
            value={watchedOn}
            onChange={(e) => setWatchedOn(e.target.value)}
          />
        </label>
        <label>
          Сезон
          <input
            aria-label="Сезон записи"
            maxLength={30}
            placeholder={sport === 'football' ? '2026/2027' : '2026'}
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          />
        </label>
        {!entry.event.reference && (
          <label>
            Дата события, если известна
            <input
              aria-label="Дата события"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </label>
        )}
        <label>
          Личная оценка
          <select
            aria-label="Личная оценка"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          >
            <option value="">Без оценки</option>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1} из 10
              </option>
            ))}
          </select>
        </label>
        <label className="diary-wide">
          Теги через запятую
          <input
            aria-label="Теги записи"
            value={tags}
            maxLength={300}
            onChange={(e) => setTags(e.target.value)}
            placeholder="друзья, любимая команда"
          />
        </label>
        <label className="diary-wide">
          Заметка
          <textarea
            aria-label="Заметка о просмотре"
            rows={4}
            maxLength={1500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="muted small">{note.length} / 1500</span>
        </label>
      </div>
      {error && (
        <p className="diary-notice" role="alert">
          {error}
        </p>
      )}
      {!writable && (
        <p className="diary-notice">Сохранение недоступно. Проверьте состояние дневника.</p>
      )}
      <div className="diary-actions">
        <button className="ghost-btn" type="submit" disabled={!writable}>
          Сохранить отметку
        </button>
        <button className="ghost-btn" type="button" onClick={onCancel}>
          Отменить редактирование
        </button>
      </div>
    </form>
  );
}
