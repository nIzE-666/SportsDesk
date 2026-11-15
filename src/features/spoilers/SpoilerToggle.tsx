import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../../kit';
import { hideResult, revealResult, useResultHidden, type SpoilerKind } from './spoilerStore';

/** Кнопка «Без спойлеров» / «Показать результат» для конкретного события. */
export function SpoilerToggle({
  kind,
  id,
  label,
  eventTime,
  compact = false,
}: {
  kind: SpoilerKind;
  id: string;
  label?: string;
  eventTime?: string;
  compact?: boolean;
}) {
  const hidden = useResultHidden(kind, id);
  return (
    <Button
      small
      variant="quiet"
      className={`spoiler-toggle${compact ? ' spoiler-toggle--compact' : ''}`}
      aria-pressed={hidden}
      title={hidden ? 'Результат скрыт до явного показа' : 'Скрыть результат этого события'}
      icon={hidden ? <Eye size={14} /> : <EyeOff size={14} />}
      onClick={(e) => {
        e.stopPropagation();
        if (hidden) revealResult(kind, id);
        else hideResult({ kind, id, label, eventTime });
      }}
    >
      {hidden ? 'Показать результат' : 'Без спойлеров'}
    </Button>
  );
}
