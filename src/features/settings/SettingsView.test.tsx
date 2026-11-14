// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viewState } from '../../lib/viewState';
import { isSettingsCategory } from './categories';
import { SettingsView } from './SettingsView';

vi.mock('./categories/GeneralSettings', () => ({
  GeneralSettings: () => <p>Основное содержимое</p>,
}));
vi.mock('./categories/FavoritesSettings', () => ({
  FavoritesSettings: () => <p>Избранное содержимое</p>,
}));
vi.mock('./categories/NotificationsSettings', () => ({
  NotificationsSettings: () => <p>Уведомления содержимое</p>,
}));
vi.mock('./categories/AppearanceSettings', () => ({
  AppearanceSettings: () => <p>Внешний вид содержимое</p>,
}));
vi.mock('./categories/ModulesSettings', () => ({
  ModulesSettings: () => <p>Модули содержимое</p>,
}));
vi.mock('./categories/WatchSettings', () => ({
  WatchSettings: () => <p>Просмотр содержимое</p>,
}));
vi.mock('./categories/DataSettings', () => ({
  DataSettings: () => <p>Данные содержимое</p>,
}));
vi.mock('./categories/SourcesSettings', () => ({
  SourcesSettings: () => <p>Источники содержимое</p>,
}));
vi.mock('./categories/AboutSettings', () => ({
  AboutSettings: () => <p>О программе содержимое</p>,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  viewState.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const categoryButton = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Категории настроек"] button')].find(
    (button) => button.textContent?.trim() === label,
  );
const current = () =>
  host.querySelector('nav[aria-label="Категории настроек"] [aria-current="true"]')?.textContent;
const heading = () => host.querySelector('.settings-category > h2')?.textContent;

async function click(label: string) {
  const button = categoryButton(label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it('switches the category, marks only the current one and remembers the choice', async () => {
  await act(async () => root.render(<SettingsView />));

  expect(heading()).toBe('Основное');
  expect(host.textContent).toContain('Основное содержимое');
  expect(current()).toBe('Основное');
  expect(
    host.querySelectorAll('nav[aria-label="Категории настроек"] button[aria-current="true"]'),
  ).toHaveLength(1);
  expect(categoryButton('Основное')?.getAttribute('aria-current')).toBe('true');
  expect(categoryButton('Данные')?.hasAttribute('aria-current')).toBe(false);

  await click('Данные');
  expect(heading()).toBe('Данные');
  expect(host.textContent).toContain('Данные содержимое');
  expect(current()).toBe('Данные');
  expect(viewState.read('settings.category', 'general', isSettingsCategory)).toBe('data');

  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<SettingsView />));
  expect(heading()).toBe('Данные');
  expect(current()).toBe('Данные');
});

it('reports a category change without keeping state when the category is controlled', async () => {
  const onCategoryChange = vi.fn();
  await act(async () =>
    root.render(<SettingsView category="general" onCategoryChange={onCategoryChange} />),
  );

  await click('Источники');
  expect(onCategoryChange).toHaveBeenCalledWith('sources');
  expect(heading()).toBe('Основное');
  expect(current()).toBe('Основное');
  expect(viewState.read('settings.category', 'general', isSettingsCategory)).toBe('general');

  await act(async () =>
    root.render(<SettingsView category="sources" onCategoryChange={onCategoryChange} />),
  );
  expect(heading()).toBe('Источники');
  expect(host.textContent).toContain('Источники содержимое');
  expect(current()).toBe('Источники');
});

it('starts from the saved category and still notifies a listener in the uncontrolled mode', async () => {
  const onCategoryChange = vi.fn();
  viewState.write('settings.category', 'appearance');

  await act(async () => root.render(<SettingsView onCategoryChange={onCategoryChange} />));
  expect(heading()).toBe('Внешний вид');
  expect(host.textContent).toContain('Внешний вид содержимое');

  await click('Модули');
  expect(onCategoryChange).toHaveBeenCalledWith('modules');
  expect(heading()).toBe('Модули');
  expect(viewState.read('settings.category', 'general', isSettingsCategory)).toBe('modules');
});
