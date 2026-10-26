// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { useApiResource } from './api';
vi.mock('../../lib/bridge', () => ({ api: vi.fn() }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const reply = (value: string) => ({
  payload: value,
  source: 'jolpica',
  fetchedAt: '2026-10-21T00:00:00Z',
  stale: false,
});
function Screen({ path }: { path: string }) {
  const state = useApiResource(path, path, (value) => String(value));
  return (
    <>
      <p>{state.data ?? 'Загрузка'}</p>
      <span>{state.error}</span>
      <button onClick={state.reload}>Обновить</button>
    </>
  );
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it('never labels the previous season data as the newly selected season while loading or on failure', async () => {
  vi.mocked(api).mockResolvedValueOnce(reply('Сезон 2025'));
  await act(async () => root.render(<Screen path="2025.json" />));
  expect(host.textContent).toContain('Сезон 2025');
  let reject!: (error: Error) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  await act(async () => root.render(<Screen path="2024.json" />));
  expect(host.textContent).not.toContain('Сезон 2025');
  await act(async () => reject(new Error('Источник недоступен')));
  expect(host.textContent).toContain('Источник недоступен');
  expect(host.textContent).not.toContain('Сезон 2025');
});
it('retains valid same-season data when a manual refresh fails', async () => {
  vi.mocked(api).mockResolvedValueOnce(reply('Сезон 2025'));
  await act(async () => root.render(<Screen path="2025.json" />));
  vi.mocked(api).mockRejectedValueOnce(new Error('Нет сети'));
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(host.textContent).toContain('Сезон 2025');
  expect(host.textContent).toContain('Нет сети');
});
