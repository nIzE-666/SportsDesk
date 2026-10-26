// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { DesignChooser, DesignToggle } from '../components/DesignChooser';
import { DESIGN_KEY, readInterfaceDesign } from './interfaceDesign';

it('synchronizes controls after another window changes or clears the preference, and tolerates unknown values', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem(DESIGN_KEY, 'unknown-future-design');
  expect(readInterfaceDesign()).toBe('classic');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <>
          <DesignToggle />
          <DesignChooser />
        </>,
      ),
    );
    expect(host.querySelector<HTMLInputElement>('input[value="classic"]')?.checked).toBe(true);
    await act(async () => {
      localStorage.setItem(DESIGN_KEY, 'broadcast');
      window.dispatchEvent(new StorageEvent('storage', { key: DESIGN_KEY, newValue: 'broadcast' }));
    });
    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector<HTMLInputElement>('input[value="broadcast"]')?.checked).toBe(true);
    await act(async () => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector<HTMLInputElement>('input[value="classic"]')?.checked).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  }
});
