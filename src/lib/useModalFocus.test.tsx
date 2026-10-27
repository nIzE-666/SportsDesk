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
it('gives focus and Escape only to the top modal when another dialog opens later', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    closeFirst = vi.fn(),
    closeSecond = vi.fn();
  function Modal({ name, close }: { name: string; close: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useModalFocus(ref, true, close);
    return (
      <div ref={ref}>
        <button>{name}</button>
      </div>
    );
  }
  try {
    await act(async () => root.render(<Modal name="Первый" close={closeFirst} />));
    await act(async () =>
      root.render(
        <>
          <Modal name="Первый" close={closeFirst} />
          <Modal name="Второй" close={closeSecond} />
        </>,
      ),
    );
    expect(document.activeElement?.textContent).toBe('Второй');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closeFirst).not.toHaveBeenCalled();
    expect(closeSecond).toHaveBeenCalledOnce();
    await act(async () => root.render(<Modal name="Первый" close={closeFirst} />));
    expect(document.activeElement?.textContent).toBe('Первый');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
