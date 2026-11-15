import { useEffect, useRef, type RefObject } from 'react';
import { EventCenter, type SportsEvent } from '../features/events/EventCenter';
import { Dialog } from '../kit';

interface EventsDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenEvent: (event: SportsEvent) => void;
  /** Where focus goes after closing, normally the rail bell. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** The event center of the five-section frame: a dialog over the current page. */
export function EventsDrawer({ open, onClose, onOpenEvent, returnFocusRef }: EventsDrawerProps) {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) returnFocusRef?.current?.focus();
    wasOpen.current = open;
  }, [open, returnFocusRef]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="События"
      closeLabel="Закрыть события"
      className="events-drawer"
    >
      <EventCenter onOpen={onOpenEvent} />
    </Dialog>
  );
}
