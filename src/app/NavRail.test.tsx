// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Section } from '../lib/navigation';
import { NavRail } from './NavRail';

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

const button = (text: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('.nav-rail button')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
};

async function renderRail(
  route: Parameters<typeof NavRail>[0]['route'],
  onChangeSection: (section: Section) => void = () => {},
) {
  await act(async () =>
    root.render(
      <NavRail
        route={route}
        onChangeSection={onChangeSection}
        onOpenEvents={() => {}}
        onOpenSettings={() => {}}
      />,
    ),
  );
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('shows five sections and the two bottom items', async () => {
  await renderRail({ kind: 'today', mode: 'today' });
  const nav = host.querySelector('nav[aria-label="Разделы"]');
  expect(nav).not.toBeNull();
  expect([...nav!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
    'Сегодня',
    'Футбол',
    'Формула 1',
    'Смотреть',
    'Моё',
    'События',
    'Настройки',
  ]);
});

it('marks only the active section and opens the remembered place on click', async () => {
  const change = vi.fn();
  await renderRail({ kind: 'football', competitionId: 'l_4WFCIZ', tab: 'standings' }, change);
  expect(button('Футбол').getAttribute('aria-current')).toBe('page');
  expect(button('Сегодня').getAttribute('aria-current')).toBeNull();
  await act(async () => button('Сегодня').click());
  expect(change).toHaveBeenCalledWith('today');
});

it('marks settings and events as current service pages', async () => {
  await renderRail({ kind: 'settings' });
  expect(button('Настройки').getAttribute('aria-current')).toBe('page');
  expect(button('События').getAttribute('aria-current')).toBeNull();
  const events = vi.fn(),
    settings = vi.fn();
  await act(async () =>
    root.render(
      <NavRail
        route={{ kind: 'events' }}
        onChangeSection={() => {}}
        onOpenEvents={events}
        onOpenSettings={settings}
      />,
    ),
  );
  expect(button('События').getAttribute('aria-current')).toBe('page');
  await act(async () => button('Настройки').click());
  expect(settings).toHaveBeenCalledTimes(1);
});
