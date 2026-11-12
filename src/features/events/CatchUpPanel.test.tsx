// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CatchUpPanel, parseCatchUpSummary } from './CatchUpPanel';
import { rpc } from '../../lib/bridge';
vi.mock('../../lib/bridge', () => ({ rpc: vi.fn(), isTauriRuntime: () => false }));

const item = {
  id: 'football|end|m1',
  sport: 'football',
  kind: 'end',
  title: 'Матч завершён',
  body: 'Arsenal 2 : 1 Chelsea',
  occurredAt: Date.UTC(2026, 10, 8, 15),
  read: false,
  matchId: 'm1',
};
const summary = {
  from: Date.UTC(2026, 10, 6),
  to: Date.UTC(2026, 10, 9),
  truncated: true,
  footballIncomplete: true,
  f1Incomplete: false,
  items: [item],
};

it('validates the summary payload', () => {
  expect(parseCatchUpSummary(summary)?.items).toHaveLength(1);
  expect(parseCatchUpSummary(null)).toBeNull();
  expect(parseCatchUpSummary({ ...summary, to: 'x' })).toBeNull();
  expect(parseCatchUpSummary({ ...summary, items: [{ ...item, sport: 'tennis' }] })).toBeNull();
});

it('shows missed results with honest notes, opens targets and dismisses', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'catchup_summary') return summary;
    return undefined;
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    open = vi.fn();
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
  try {
    await act(async () => root.render(<CatchUpPanel onOpen={open} />));
    expect(host.textContent).toContain('Пока вас не было');
    expect(host.textContent).toContain('Arsenal 2 : 1 Chelsea');
    expect(host.textContent).toContain('последние 72 часа');
    expect(host.textContent).toContain('неполные данные');
    expect(host.textContent).not.toContain('Формула 1: итоги');
    await act(async () => button('Открыть матч').click());
    expect(open).toHaveBeenCalledWith(item);
    await act(async () => button('Скрыть').click());
    expect(rpc).toHaveBeenLastCalledWith('catchup_dismiss');
    expect(host.textContent).toBe('');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('renders nothing for an invalid or empty summary', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(rpc).mockResolvedValue({
    ...summary,
    items: [],
    footballIncomplete: false,
    truncated: false,
  });
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CatchUpPanel />));
    expect(host.textContent).toBe('');
  } finally {
    await act(async () => root.unmount());
  }
});
