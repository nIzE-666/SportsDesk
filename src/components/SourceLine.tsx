import { ExternalLink } from 'lucide-react';
import { Fragment } from 'react';
import { formatUpdatedAt, getUserTimezone } from '../features/football/storage';
import { openExternal } from '../lib/bridge';
import { sourceLabels } from '../lib/sourceLabels';

interface Props {
  /** Источники страницы: ключи («pitch», «jolpica») или названия. */
  sources: readonly string[];
  /** Когда получены данные. Без значения время не показывается. */
  fetchedAt?: string | null;
  /** Показаны сохранённые данные, которые могли устареть. */
  stale?: boolean;
  /** Время относится к самому старому из нескольких запросов страницы. */
  oldest?: boolean;
  timezone?: string;
  role?: 'status';
}

/**
 * Единственная строка об источнике внизу страницы: «Данные: PitchAPI · обновлено 18:42».
 * SportScore остаётся ссылкой «Powered by SportScore» — так требует его источник.
 */
export function SourceLine({
  sources,
  fetchedAt,
  stale = false,
  oldest = false,
  timezone,
  role,
}: Props) {
  const names = sourceLabels(sources);
  if (!names.length) return null;
  const updated = fetchedAt ? formatUpdatedAt(fetchedAt, timezone ?? getUserTimezone()) : null;
  return (
    <div className="source-foot muted small" role={role}>
      <span>
        Данные:{' '}
        {names.map((name, index) => (
          <Fragment key={name}>
            {index > 0 && ', '}
            {name === 'SportScore' ? (
              <button
                type="button"
                className="link-btn"
                onClick={() => void openExternal('https://sportscore.com').catch(() => undefined)}
              >
                Powered by SportScore <ExternalLink size={12} />
              </button>
            ) : (
              name
            )}
          </Fragment>
        ))}
        {updated && updated !== '—' ? ` · обновлено${oldest ? ' не ранее' : ''} ${updated}` : ''}
        {stale ? ' · сохранённые данные могут быть устаревшими' : ''}
      </span>
    </div>
  );
}
