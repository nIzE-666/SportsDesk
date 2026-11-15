import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/** The repo has no Testing Library: tests render with react-dom and act. */
export function createTestHost() {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return {
    host,
    render: async (node: ReactNode) => {
      await act(async () => root.render(node));
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

export async function pressKey(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

export async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
