// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { EventCenter } from './EventCenter';
import { rpc } from '../../lib/bridge';
vi.mock('../../lib/bridge', () => ({ rpc: vi.fn(), isTauriRuntime: () => false }));
it('filters durable events, opens the exact target, and does not acknowledge failed writes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const football = {
    id: 'score|m',
    sport: 'football',
    kind: 'goal',
    title: 'Изменение счёта',
    body: 'Arsenal — Chelsea',
    occurredAt: Date.now(),
    read: false,
    matchId: 'm',
  };
  const f1 = {
    ...football,
    id: 'f1|7',
    sport: 'f1',
    title: 'Скоро гонка',
    season: '2026',
    round: '7',
    matchId: undefined,
  };
  vi.mocked(rpc).mockImplementation(async (command) => {
    if (command === 'event_center_list') return [football, f1];
    throw new Error('Запись недоступна');
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    open = vi.fn();
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
  try {
    await act(async () => root.render(<EventCenter onOpen={open} />));
    expect(host.querySelectorAll('article.unread')).toHaveLength(2);
    await act(async () => button('Прочитать все').click());
    expect(host.textContent).toContain('Запись недоступна');
    expect(host.querySelectorAll('article.unread')).toHaveLength(2);
    vi.mocked(rpc).mockResolvedValue(undefined);
    await act(async () => button('Формула 1').click());
    expect(host.querySelectorAll('article')).toHaveLength(1);
    await act(async () => button('Открыть уикенд').click());
    expect(open).toHaveBeenCalledWith(f1);
    expect(rpc).toHaveBeenLastCalledWith('event_center_mark_read', { ids: ['f1|7'] });
    expect(host.querySelectorAll('article.unread')).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
