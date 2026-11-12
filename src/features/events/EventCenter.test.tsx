// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { EventCenter } from './EventCenter';
import { rpc } from '../../lib/bridge';
vi.mock('../../lib/bridge', () => ({ rpc: vi.fn(), isTauriRuntime: () => false }));
it('hides event filters when there are no events', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(rpc).mockResolvedValue([]);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EventCenter onOpen={vi.fn()} />));
    expect(host.querySelector('.event-toolbar')).toBeNull();
    expect(host.textContent).toContain('Пока нет событий');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
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

const base = {
  sport: 'football',
  kind: 'goal',
  title: 'Изменение счёта',
  body: 'Arsenal — Chelsea',
  occurredAt: Date.now(),
  read: false,
};
const goal = (id: string, read = false) => ({ ...base, id, read, matchId: id });
const race = (id: string, read = false) => ({
  ...base,
  id,
  read,
  sport: 'f1',
  title: 'Скоро гонка',
  season: '2026',
  round: '7',
});
async function mount(events: unknown[]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(rpc).mockImplementation(async (command) =>
    command === 'event_center_list' ? events : undefined,
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EventCenter onOpen={vi.fn()} />));
  return {
    host,
    root,
    texts: (selector: string) =>
      [...host.querySelectorAll(selector)].map((el) => el.textContent?.trim()),
    button: (text: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it('shows events of one sport without sport or unread filters, but keeps "read all"', async () => {
  const view = await mount([goal('a'), goal('b')]);
  try {
    expect(view.host.querySelectorAll('article')).toHaveLength(2);
    expect(view.host.querySelector('[aria-label="Фильтр событий"]')).toBeNull();
    expect(view.texts('.event-toolbar button')).toEqual(['Прочитать все']);
  } finally {
    await view.unmount();
  }
});
it('offers sport filters only when both sports have events, and unread only when it splits them', async () => {
  const view = await mount([goal('a'), race('b')]);
  try {
    expect(view.texts('[aria-label="Фильтр событий"] button')).toEqual([
      'Все',
      'Футбол',
      'Формула 1',
    ]);
    await act(async () => view.button('Открыть матч').click());
    expect(view.texts('[aria-label="Фильтр событий"] button')).toEqual([
      'Все',
      'Непрочитанные · 1',
      'Футбол',
      'Формула 1',
    ]);
  } finally {
    await view.unmount();
  }
});
it('shows nothing to mark or filter once everything is read', async () => {
  const view = await mount([goal('a', true), goal('b', true)]);
  try {
    expect(view.host.querySelectorAll('article')).toHaveLength(2);
    expect(view.host.querySelector('.event-toolbar')).toBeNull();
    expect(view.host.querySelector('.state-block')).toBeNull();
  } finally {
    await view.unmount();
  }
});
it('says everything is read with one way back when the unread filter has nothing left', async () => {
  const view = await mount([goal('a'), goal('b', true)]);
  try {
    await act(async () => view.button('Непрочитанные · 1').click());
    expect(view.host.querySelectorAll('article')).toHaveLength(1);
    await act(async () => view.button('Прочитать все').click());
    expect(view.host.querySelectorAll('article')).toHaveLength(0);
    expect(view.host.querySelectorAll('.state-block')).toHaveLength(1);
    expect(view.host.querySelector('.state-block')?.textContent).toContain('Всё прочитано');
    // The selected filter stays visible, "read all" is gone.
    expect(view.texts('[aria-label="Фильтр событий"] button')).toEqual([
      'Все',
      'Непрочитанные · 0',
    ]);
    expect(view.button('Прочитать все')).toBeUndefined();
    await act(async () => view.button('Показать все события').click());
    expect(view.host.querySelectorAll('article')).toHaveLength(2);
    expect(view.host.querySelector('.state-block')).toBeNull();
    expect(view.host.querySelector('.event-toolbar')).toBeNull();
  } finally {
    await view.unmount();
  }
});
it('says no such events exist, with one way back, when a sport filter outlives its events', async () => {
  const view = await mount([goal('a'), race('b')]);
  try {
    await act(async () => view.button('Формула 1').click());
    expect(view.host.querySelectorAll('article')).toHaveLength(1);
    vi.mocked(rpc).mockImplementation(async (command) =>
      command === 'event_center_list' ? [goal('a')] : undefined,
    );
    await act(async () => view.button('Обновить').click());
    expect(view.host.querySelectorAll('article')).toHaveLength(0);
    expect(view.host.querySelector('.state-block')?.textContent).toContain('Таких событий нет');
    expect(view.texts('[aria-label="Фильтр событий"] button')).toEqual([
      'Все',
      'Футбол',
      'Формула 1',
    ]);
    await act(async () => view.button('Показать все события').click());
    expect(view.host.querySelectorAll('article')).toHaveLength(1);
  } finally {
    await view.unmount();
  }
});
it('keeps one short phrase and no filters when there are no events at all', async () => {
  const view = await mount([]);
  try {
    expect(view.host.querySelectorAll('.state-block')).toHaveLength(1);
    expect(view.host.querySelector('.state-block')?.textContent).toContain('Пока нет событий');
    expect(view.host.querySelector('.event-toolbar')).toBeNull();
    expect(view.host.querySelectorAll('.state-block button')).toHaveLength(0);
  } finally {
    await view.unmount();
  }
});
