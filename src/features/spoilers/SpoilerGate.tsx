import type { ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import { Button, EmptyState } from '../../kit';
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
    <EmptyState
      className="spoiler-gate"
      icon={<EyeOff size={20} />}
      message={
        <>
          <strong>Результат скрыт</strong> События, статистика и оценки скрыты.
        </>
      }
      action={
        <Button small onClick={() => revealResult(kind, id)}>
          Показать результат
        </Button>
      }
    />
  );
}
