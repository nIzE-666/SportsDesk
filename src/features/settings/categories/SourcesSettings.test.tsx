// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rpc } from '../../../lib/bridge';
import { LIVE_SOURCE_KEY } from '../../football/liveData';
import { SourcesSettings } from './SourcesSettings';

vi.mock('../../../lib/bridge', () => ({
  rpc: vi.fn(),
  isTauriRuntime: () => false,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  vi.mocked(rpc).mockResolvedValue({ pitch: true, kino: false, kinoClient: false });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => root.render(<SourcesSettings />));
  await act(async () => {
    await Promise.resolve();
  });
}

const sourceSelect = () => host.querySelector<HTMLSelectElement>('#live-source');

it('offers three live source choices and stores the chosen one', async () => {
  await render();
  const select = sourceSelect();
  expect(select).not.toBeNull();
  expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual([
    'Авто (LiveScore, при сбое ESPN)',
    'Только LiveScore',
    'Только ESPN',
  ]);
  expect(select?.value).toBe('auto');
  expect(host.textContent).toContain('неофициальные бесплатные источники');

  await act(async () => {
    if (!select) return;
    select.value = 'espn';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(localStorage.getItem(LIVE_SOURCE_KEY)).toBe('espn');

  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(sourceSelect()?.value).toBe('espn');
});

it('reads an unknown saved value as the automatic choice', async () => {
  localStorage.setItem(LIVE_SOURCE_KEY, 'something-else');
  await render();
  expect(sourceSelect()?.value).toBe('auto');
});
