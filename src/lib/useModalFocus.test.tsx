// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useModalFocus } from './useModalFocus';
it('traps keyboard focus, closes on Escape and restores the previous focus', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    close = vi.fn();
  function Modal() {
    const ref = useRef<HTMLElement>(null);
    useModalFocus(ref, true, close);
    return (
      <section ref={ref} tabIndex={-1}>
        <button>Первый</button>
        <button>Последний</button>
      </section>
    );
  }
  await act(async () => root.render(<Modal />));
  const buttons = host.querySelectorAll('button');
  expect(document.activeElement).toBe(buttons[0]);
  buttons[1]!.focus();
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(buttons[0]);
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(buttons[1]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(document.activeElement).toBe(trigger);
  host.remove();
  trigger.remove();
});
