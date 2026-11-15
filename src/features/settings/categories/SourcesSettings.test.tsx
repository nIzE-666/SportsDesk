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

const sourceChoices = () =>
  [...host.querySelectorAll<HTMLElement>('[role="radio"]')].map((item) => item.textContent);
const chosenSource = () =>
  host.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.textContent;

it('offers three live source choices and stores the chosen one', async () => {
  await render();
  expect(sourceChoices()).toEqual(['Авто', 'Только LiveScore', 'Только ESPN']);
  expect(chosenSource()).toBe('Авто');
  expect(host.textContent).toContain('неофициальные бесплатные источники');

  const espn = [...host.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (item) => item.textContent === 'Только ESPN',
  );
  await act(async () => espn!.click());
  expect(localStorage.getItem(LIVE_SOURCE_KEY)).toBe('espn');

  const limits = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.includes('Ограничения источников'),
  );
  await act(async () => limits!.click());
  expect(host.textContent).toContain('Данные могут быть неполными');

  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(chosenSource()).toBe('Только ESPN');
});

it('reads an unknown saved value as the automatic choice', async () => {
  localStorage.setItem(LIVE_SOURCE_KEY, 'something-else');
  await render();
  expect(chosenSource()).toBe('Авто');
});
