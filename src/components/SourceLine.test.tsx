// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SourceLine } from './SourceLine';

const openExternal = vi.fn<(url: string) => Promise<void>>(async () => undefined);
vi.mock('../lib/bridge', () => ({ openExternal: (url: string) => openExternal(url) }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  openExternal.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('shows one line with readable sources, update time and the stale note', async () => {
  await act(async () =>
    root.render(
      <SourceLine
        sources={['pitch', 'jolpica']}
        fetchedAt="2026-11-10T09:15:00Z"
        stale
        timezone="UTC"
      />,
    ),
  );
  expect(host.querySelectorAll('.source-foot')).toHaveLength(1);
  const text = host.textContent ?? '';
  expect(text).toContain('Данные: PitchAPI, Jolpica');
  expect(text).toMatch(/обновлено .*(09:15)/);
  expect(text).toContain('сохранённые данные могут быть устаревшими');
});

it('says "не ранее" for the oldest of several requests and omits an unknown time', async () => {
  await act(async () =>
    root.render(<SourceLine sources={['openf1']} fetchedAt="2026-11-10T09:15:00Z" oldest />),
  );
  expect(host.textContent).toContain('обновлено не ранее');
  await act(async () => root.render(<SourceLine sources={['openf1']} fetchedAt={null} />));
  expect(host.textContent).toBe('Данные: OpenF1');
  await act(async () => root.render(<SourceLine sources={[]} />));
  expect(host.textContent).toBe('');
});

it('keeps SportScore as an external attribution link', async () => {
  await act(async () => root.render(<SourceLine sources={['pitch', 'sportscore']} />));
  const link = host.querySelector('button');
  expect(link?.textContent).toContain('Powered by SportScore');
  await act(async () => link!.click());
  expect(openExternal).toHaveBeenCalledWith('https://sportscore.com');
  expect(host.textContent).toContain('Данные: PitchAPI, Powered by SportScore');
});
