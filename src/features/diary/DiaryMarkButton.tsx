import { useState } from 'react';
import { formatHumanDate } from '../../lib/humanDate';
import { getUserTimezone } from '../football/storage';
import { useResultHidden, f1SpoilerId } from '../spoilers/spoilerStore';
import {
  diaryEventKey,
  newDiaryEntry,
  todayInTimezone,
  type DiaryEntry,
  type DiaryEvent,
} from './diaryModel';
import { useDiary } from './diaryStore';
import { DiaryEntryForm } from './DiaryEntryForm';
import './diary.css';

export function diarySpoiler(event: DiaryEvent) {
  const ref = event.reference;
  return ref
    ? ref.kind === 'football'
      ? { kind: 'football' as const, id: ref.matchId }
      : { kind: 'f1' as const, id: f1SpoilerId(ref.season, ref.round) }
    : null;
}
export function DiaryMarkButton(props: { event: DiaryEvent; label?: string }) {
  return <DiaryMarkState key={diaryEventKey(props.event) ?? props.event.title} {...props} />;
}
function DiaryMarkState({
  event,
  label = 'Отметить просмотр',
}: {
  event: DiaryEvent;
  label?: string;
}) {
  const { store, writable, error } = useDiary();
  const target = diarySpoiler(event),
    hidden = useResultHidden(target?.kind ?? 'football', target?.id);
  const existing = store.entries.find((e) => e.id === diaryEventKey(event));
  const [editing, setEditing] = useState<DiaryEntry | null>(null),
    [message, setMessage] = useState('');
  return (
    <div className="diary-mark">
      <div className="diary-actions">
        <button
          className="ghost-btn"
          disabled={hidden || !writable || !!editing}
          onClick={() => {
            setMessage('');
            setEditing(
              existing ??
                newDiaryEntry(event, todayInTimezone(getUserTimezone()), crypto.randomUUID()),
            );
          }}
        >
          {existing ? 'Изменить запись о просмотре' : label}
        </button>
        {existing && !hidden && (
          <span className="muted small">
            Просмотрено · {formatHumanDate(existing.watchedOn, getUserTimezone())}
          </span>
        )}
        {hidden && (
          <span className="muted small">Дневник доступен после раскрытия результата.</span>
        )}
      </div>
      {error && (
        <p className="diary-notice" role="status">
          {error}
        </p>
      )}
      {message && (
        <p className="diary-notice" role="status">
          {message}
        </p>
      )}
      {editing && !hidden && (
        <DiaryEntryForm
          key={editing.id}
          entry={editing}
          writable={writable}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage('Просмотр сохранён в личном дневнике.');
          }}
        />
      )}
    </div>
  );
}
