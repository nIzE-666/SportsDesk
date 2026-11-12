import type { ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import { SPOILER_MASK, revealResult, useResultHidden, type SpoilerKind } from './spoilerStore';

/** Показывает маску вместо счёта, пока результат события скрыт. */
export function HiddenScore({
  kind,
  id,
  mask = SPOILER_MASK,
  children,
}: {
  kind: SpoilerKind;
  id: string | null | undefined;
  mask?: ReactNode;
  children: ReactNode;
}) {
  const hidden = useResultHidden(kind, id);
  return <>{hidden ? mask : children}</>;
}

/**
 * Закрывает раскрывающее результат содержимое (события, статистику, оценки),
 * пока событие отмечено «без спойлеров». bypass — для ещё не начавшихся событий.
 */
export function SpoilerGate({
  kind,
  id,
  bypass = false,
  children,
}: {
  kind: SpoilerKind;
  id: string | null | undefined;
  bypass?: boolean;
  children: ReactNode;
}) {
  const hidden = useResultHidden(kind, id);
  if (!hidden || bypass || !id) return <>{children}</>;
  return (
    <div className="panel spoiler-gate" role="status">
      <EyeOff size={18} />
      <div>
        <strong>Результат скрыт</strong>
        <p className="muted small">События, статистика и оценки скрыты.</p>
      </div>
      <button type="button" className="ghost-btn" onClick={() => revealResult(kind, id)}>
        Показать результат
      </button>
    </div>
  );
}
