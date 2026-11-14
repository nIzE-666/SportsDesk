// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LEAGUE_MODULES, readModules } from '../../../lib/modules';
import { ModulesSettings } from './ModulesSettings';

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
});

const checkboxFor = (text: string) =>
  [...host.querySelectorAll('label')]
    .find((label) => label.textContent?.includes(text))
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]');

async function render() {
  await act(async () => root.render(<ModulesSettings />));
}

it('shows a switch for every module and groups the league switches', async () => {
  await render();
  const group = host.querySelector('[role="group"][aria-label="Лиги"]');
  expect(group).not.toBeNull();
  expect(group?.querySelector('h3')?.textContent).toBe('Лиги');
  for (const league of LEAGUE_MODULES) {
    expect(group?.textContent).toContain(league.label);
    expect(checkboxFor(league.label)?.checked).toBe(true);
  }
  for (const label of [
    'Просмотр',
    'Еврокубки и сборные',
    'Прогнозы',
    'Игры',
    'Атмосфера',
    'Дневник',
    'Тактическая доска',
  ]) {
    expect(checkboxFor(label)?.checked).toBe(true);
  }
  expect(host.querySelectorAll('.module-switch input[type="checkbox"]')).toHaveLength(
    7 + LEAGUE_MODULES.length,
  );
});

it('writes a switch and shows the atmosphere options only while atmosphere is on', async () => {
  await render();
  expect(host.querySelector('[aria-label="Эффекты и звуки"]')).not.toBeNull();

  const watch = checkboxFor('Просмотр')!;
  await act(async () => watch.click());
  expect(checkboxFor('Просмотр')?.checked).toBe(false);
  expect(readModules().watch).toBe(false);

  const atmosphere = checkboxFor('Атмосфера')!;
  await act(async () => atmosphere.click());
  expect(readModules().atmosphere).toBe(false);
  expect(host.querySelector('[aria-label="Эффекты и звуки"]')).toBeNull();

  await act(async () => checkboxFor('Атмосфера')!.click());
  expect(readModules().atmosphere).toBe(true);
  expect(host.querySelector('[aria-label="Эффекты и звуки"]')).not.toBeNull();
  expect(host.textContent).toContain('Реплики вымышлены.');
});
