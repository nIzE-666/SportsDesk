// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSelect, type SearchSelectOption } from './SearchSelect';

const OPTIONS: SearchSelectOption[] = [
  { value: 'odegaard', label: 'Martin Ødegaard', group: 'Арсенал' },
  { value: 'saka', label: 'Bukayo Saka', group: 'Арсенал' },
  { value: 'palmer', label: 'Cole Palmer', group: 'Челси' },
  { value: 'james', label: 'Reece James', group: 'Челси' },
  { value: 'muller', label: 'Thomas Müller', group: 'Бавария' },
];

let host: HTMLDivElement, root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Harness({
  initial = '',
  onChange = () => {},
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SearchSelect
      ariaLabel="Игрок"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      placeholder="Выберите игрока"
    />
  );
}

const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
const options = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')];

async function render(element: React.ReactNode) {
  await act(async () => root.render(element));
}

async function focus() {
  await act(async () => input().focus());
}

async function type(value: string) {
  const field = input();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(name: string) {
  await act(async () =>
    input().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })),
  );
}

async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('SearchSelect', () => {
  it('is an ARIA combobox with a grouped listbox', async () => {
    await render(<Harness />);
    const field = input();
    expect(field.getAttribute('role')).toBe('combobox');
    expect(field.getAttribute('aria-label')).toBe('Игрок');
    expect(field.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="listbox"]')).toBeNull();

    await focus();
    expect(field.getAttribute('aria-expanded')).toBe('true');
    const listbox = host.querySelector('[role="listbox"]')!;
    expect(listbox.id).toBe(field.getAttribute('aria-controls'));
    expect(listbox.getAttribute('aria-label')).toBe('Список вариантов');
    expect(options()).toHaveLength(5);
    expect(
      [...host.querySelectorAll('[role="group"]')].map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Арсенал', 'Челси', 'Бавария']);
    expect(field.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
  });

  it('shows the current choice and marks its option as selected', async () => {
    await render(<Harness initial="palmer" />);
    expect(input().value).toBe('Cole Palmer');
    await focus();
    expect(
      options().filter((option) => option.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
    expect(
      options()
        .find((option) => option.textContent === 'Cole Palmer')
        ?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('filters case-insensitively and hides groups without matches', async () => {
    await render(<Harness />);
    await focus();
    await type('SAKA');
    expect(options().map((option) => option.textContent)).toEqual(['Bukayo Saka']);
    expect(host.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Арсенал');
  });

  it('ignores accents when filtering', async () => {
    await render(<Harness />);
    await focus();
    await type('odegaard');
    expect(options().map((option) => option.textContent)).toEqual(['Martin Ødegaard']);
    await type('MÜLLER');
    expect(options().map((option) => option.textContent)).toEqual(['Thomas Müller']);
  });

  it('matches several words in any order', async () => {
    await render(<Harness />);
    await focus();
    await type('odegaard martin');
    expect(options().map((option) => option.textContent)).toEqual(['Martin Ødegaard']);
  });

  it('says nothing was found and recovers when the query is cleared', async () => {
    await render(<Harness />);
    await focus();
    await type('zzz');
    expect(options()).toHaveLength(0);
    expect(host.textContent).toContain('Ничего не найдено');
    expect(input().getAttribute('aria-activedescendant')).toBeNull();
    await type('');
    expect(options()).toHaveLength(5);
    expect(host.textContent).not.toContain('Ничего не найдено');
  });

  it('moves with the arrow keys and chooses with Enter', async () => {
    const onChange = vi.fn();
    await render(<Harness onChange={onChange} />);
    await focus();
    await key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    await key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[2]!.id);
    await key('ArrowUp');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    await key('Enter');
    expect(onChange).toHaveBeenCalledWith('saka');
    expect(input().value).toBe('Bukayo Saka');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('wraps the arrow keys at the ends of the list', async () => {
    await render(<Harness />);
    await focus();
    await key('ArrowUp');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[4]!.id);
    await key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
  });

  it('closes on Escape without changing the previous choice', async () => {
    const onChange = vi.fn();
    await render(<Harness initial="saka" onChange={onChange} />);
    await focus();
    await type('palmer');
    expect(options()).toHaveLength(1);
    await key('Escape');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(input().value).toBe('Bukayo Saka');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes when Tab leaves the field', async () => {
    await render(<Harness />);
    await focus();
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    await key('Tab');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('chooses with the mouse and clears the choice', async () => {
    const onChange = vi.fn();
    await render(<Harness onChange={onChange} />);
    await focus();
    await click(options().find((option) => option.textContent === 'Cole Palmer')!);
    expect(onChange).toHaveBeenCalledWith('palmer');
    expect(input().value).toBe('Cole Palmer');
    expect(host.querySelector('[role="listbox"]')).toBeNull();

    const clear = host.querySelector<HTMLButtonElement>('.search-select-clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Очистить выбор');
    await click(clear);
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(input().value).toBe('');
    expect(host.querySelector('.search-select-clear')).toBeNull();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('hides the clearing control for a required choice', async () => {
    await render(
      <SearchSelect
        ariaLabel="Сезон"
        value="2026/2027"
        options={[{ value: '2026/2027', label: '2026/2027' }]}
        onChange={() => {}}
        clearable={false}
      />,
    );
    expect(host.querySelector('.search-select-clear')).toBeNull();
    expect(input().value).toBe('2026/2027');
  });

  it('closes when the click lands outside', async () => {
    await render(<Harness />);
    await focus();
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    await act(async () => document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
});
