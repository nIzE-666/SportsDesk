// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventsDrawer } from './EventsDrawer';

vi.mock('../features/events/EventCenter', () => ({
  EventCenter: ({ onOpen }: { onOpen: (event: { id: string }) => void }) => (
    <div className="event-center">
      <p>События за последние 30 дней.</p>
      <button onClick={() => onOpen({ id: 'event-1' })}>Открыть матч</button>
    </div>
  ),
}));

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

function Harness({ onOpenEvent }: { onOpenEvent?: (event: { id: string }) => void }) {
  const [open, setOpen] = useState(false);
  const bell = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={bell} onClick={() => setOpen(true)}>
        События
      </button>
      <EventsDrawer
        open={open}
        onClose={() => setOpen(false)}
        onOpenEvent={onOpenEvent ?? (() => {})}
        returnFocusRef={bell}
      />
    </>
  );
}

const bell = () => host.querySelector<HTMLButtonElement>('button')!;
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');
const closeButton = () => host.querySelector<HTMLButtonElement>('[aria-label="Закрыть события"]')!;

async function render(onOpenEvent?: (event: { id: string }) => void) {
  await act(async () => root.render(<Harness onOpenEvent={onOpenEvent} />));
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('opens as a labelled modal dialog and closes on Escape and on a click outside', async () => {
  await render();
  await act(async () => bell().click());
  expect(dialog()?.getAttribute('aria-modal')).toBe('true');
  expect(host.querySelector('#events-drawer-title')?.textContent).toBe('События');
  expect(document.activeElement).toBe(closeButton());

  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(bell());

  await act(async () => bell().click());
  await act(async () => host.querySelector<HTMLElement>('.events-drawer-backdrop')!.click());
  expect(dialog()).toBeNull();
});

it('keeps Tab inside the drawer and gives focus back to the bell', async () => {
  await render();
  await act(async () => bell().click());
  const buttons = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')];
  const first = buttons[0]!,
    last = buttons.at(-1)!;
  expect(document.activeElement).toBe(first);

  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(last);
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(first);

  await act(async () => closeButton().click());
  expect(document.activeElement).toBe(bell());
});

it('passes an opened event to the frame without closing on its own', async () => {
  const open = vi.fn();
  await render(open);
  await act(async () => bell().click());
  await act(async () =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Открыть матч')!
      .click(),
  );
  expect(open).toHaveBeenCalledWith({ id: 'event-1' });
  expect(dialog()).not.toBeNull();
});
