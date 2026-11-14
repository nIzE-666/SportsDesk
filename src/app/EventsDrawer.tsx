import { useEffect, useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import { EventCenter, type SportsEvent } from '../features/events/EventCenter';
import { useModalFocus } from '../lib/useModalFocus';

interface EventsDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenEvent: (event: SportsEvent) => void;
  /** Where focus goes after closing, normally the rail bell. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** The event center of the five-section frame: a dialog over the current page. */
export function EventsDrawer({ open, onClose, onOpenEvent, returnFocusRef }: EventsDrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, open, onClose);
  useEffect(() => {
    if (!open) return;
    return () => returnFocusRef?.current?.focus();
  }, [open, returnFocusRef]);
  if (!open) return null;
  return (
    <div
      className="events-drawer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="events-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="events-drawer-title"
      >
        <div className="events-drawer-head">
          <h2 id="events-drawer-title">События</h2>
          <button
            type="button"
            className="icon-button events-drawer-close"
            aria-label="Закрыть события"
            title="Закрыть"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="events-drawer-body">
          <EventCenter onOpen={onOpenEvent} />
        </div>
      </div>
    </div>
  );
}
