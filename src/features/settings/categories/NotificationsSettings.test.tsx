// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationsSettings } from './NotificationsSettings';

vi.mock('../../../lib/bridge', () => ({
  notify: vi.fn(async () => undefined),
  rpc: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const switchInput = (text: string) =>
  [...host.querySelectorAll<HTMLLabelElement>('.ui-switch')]
    .find((label) => label.querySelector('.ui-switch__label')?.textContent?.trim() === text)
    ?.querySelector<HTMLInputElement>('input');

async function render() {
  await act(async () => root.render(<NotificationsSettings />));
}

it('greys the dependent switches while the master switch is off and keeps their values', async () => {
  localStorage.setItem('sportsdesk.notifications.enabled', '0');
  await render();

  const master = switchInput('Уведомления')!;
  const f1 = switchInput('Напоминать о сессиях Формулы-1')!;
  const goals = switchInput('Голы и изменения счёта')!;
  const quiet = switchInput('Приостановить уведомления в выбранные часы')!;
  expect(master.checked).toBe(false);
  expect(f1.checked).toBe(true);
  expect(goals.checked).toBe(true);
  for (const input of [f1, goals, quiet]) expect(input.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('#quiet-start')?.disabled).toBe(true);
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].every(
      (button) => button.disabled,
    ),
  ).toBe(true);

  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
  await act(async () => {
    master.click();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(switchInput('Уведомления')?.checked).toBe(true);
  expect(switchInput('Напоминать о сессиях Формулы-1')?.checked).toBe(true);
  expect(switchInput('Голы и изменения счёта')?.checked).toBe(true);
  for (const text of [
    'Напоминать о сессиях Формулы-1',
    'Голы и изменения счёта',
    'Приостановить уведомления в выбранные часы',
  ])
    expect(switchInput(text)?.disabled).toBe(false);
  expect(host.querySelector<HTMLInputElement>('#quiet-start')?.disabled).toBe(false);
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].some(
      (button) => button.disabled,
    ),
  ).toBe(false);
  expect(localStorage.getItem('sportsdesk.notifications.enabled')).toBe('1');
});
