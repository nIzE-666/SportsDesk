// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { GlobalSearch } from './GlobalSearch';
import { rememberSearchItems } from '../lib/searchIndex';
import { useModalFocus } from '../lib/useModalFocus';
it('opens by Ctrl+K, activates the exact result by Enter and restores focus with Escape', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  const host = document.createElement('div');
  host.className = 'app-root';
  document.body.append(host);
  const root = createRoot(host),
    navigate = vi.fn();
  try {
    rememberSearchItems([
      {
        key: 'channel:7',
        title: 'Sky Sports F1',
        subtitle: 'Канал',
        target: { kind: 'channel', id: 7 },
      },
    ]);
    await act(async () => root.render(<GlobalSearch onNavigate={navigate} />));
    const trigger = host.querySelector('button')!;
    trigger.focus();
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
      ),
    );
    const input = host.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Sky');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('[role=option]').length).toBe(1);
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', id: 7 });
    expect(host.querySelector('[role=dialog]')).toBeNull();
    await act(async () => trigger.click());
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(document.activeElement).toBe(trigger);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  }
});
it('does not open over another modal dialog', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  host.className = 'app-root';
  document.body.append(host);
  const root = createRoot(host);
  function ExistingModal() {
    const ref = useRef<HTMLDivElement>(null);
    useModalFocus(ref, true, () => {});
    return (
      <div role="dialog" aria-modal="true" ref={ref}>
        <button>Что нового</button>
      </div>
    );
  }
  try {
    await act(async () =>
      root.render(
        <>
          <GlobalSearch onNavigate={() => {}} />
          <ExistingModal />
        </>,
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
      ),
    );
    expect(host.querySelectorAll('[role=dialog]')).toHaveLength(1);
    expect(document.activeElement?.textContent).toBe('Что нового');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
