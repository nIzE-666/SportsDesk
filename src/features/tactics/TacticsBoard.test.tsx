// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { tacticLineups, tacticMatch } from '../../test/fixtures/tactics';
import { viewState } from '../../lib/viewState';
import { TacticsBoard } from './TacticsBoard';
import { TACTICS_KEY, schemeFromLineups } from './tacticsModel';
import { saveScheme } from './tacticsStore';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  viewState.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(payload: typeof tacticLineups | null = tacticLineups) {
  await act(async () =>
    root.render(<TacticsBoard key={tacticMatch.id} detail={tacticMatch} payload={payload} />),
  );
}
async function click(label: string) {
  const b = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.textContent?.trim() === label || el.getAttribute('aria-label') === label,
  );
  expect(b, label).toBeDefined();
  await act(async () => b!.click());
}
async function input(label: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(label: string, value: string) {
  const el = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const saved = () => JSON.parse(localStorage.getItem(TACTICS_KEY)!);

it('creates a private copy, marks source confirmation and makes unpositioned players available', async () => {
  await render();
  await click('Создать из состава');
  expect(host.querySelectorAll('.tactics-player')).toHaveLength(4);
  expect(host.textContent).toContain('предварительный состав');
  expect(host.textContent).toContain('подтверждённый состав');
  await select('Выбранный игрок', JSON.stringify(['arsenal', 'missing']));
  expect(host.textContent).toContain('исходная позиция не указана');
  await click('Разместить в центре');
  expect(host.querySelectorAll('.tactics-player')).toHaveLength(5);
  expect(
    tacticLineups.home.starters.find((p) => p.player_id === 'missing')?.pitch_x,
  ).toBeUndefined();
});
it('moves by keyboard and numeric coordinates, undoes one action and resets to the source', async () => {
  await render();
  await click('Создать из состава');
  const p = host.querySelector<HTMLButtonElement>('.tactics-player')!;
  const left = () =>
    parseFloat(p.style.getPropertyValue('--player-position').split(/\s+/)[3] ?? '');
  const start = left();
  await act(async () =>
    p.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(left()).toBeCloseTo(start + 2);
  await click('Отменить действие');
  expect(left()).toBeCloseTo(start);
  await input('Вдоль поля, %', '72');
  expect(left()).toBe(72);
  await click('Сбросить доску');
  expect(left()).toBeCloseTo(start);
});
it('creates and removes arrows without pointer precision and supports undo', async () => {
  await render();
  await click('Создать из состава');
  await click('Добавить стрелку по координатам');
  expect(host.querySelectorAll('.tactics-arrows line')).toHaveLength(1);
  await click('Удалить стрелку 1');
  expect(host.querySelectorAll('.tactics-arrows line')).toHaveLength(0);
  await click('Отменить действие');
  expect(host.querySelectorAll('.tactics-arrows line')).toHaveLength(1);
  await input('x1', '-1');
  await click('Добавить стрелку по координатам');
  expect(host.textContent).toContain('от 0 до 100');
});
it('temporarily shows original positions without changing the draft', async () => {
  await render();
  await click('Создать из состава');
  await click('Игрок Bukayo Saka, Arsenal');
  await input('Вдоль поля, %', '70');
  await click('Сравнить с исходной');
  const left = () =>
    parseFloat(
      host
        .querySelector<HTMLButtonElement>('.tactics-player')!
        .style.getPropertyValue('--player-position')
        .split(/\s+/)[3] ?? '',
    );
  expect(left()).toBeCloseTo(36.68);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Вдоль поля, %"]')!.disabled).toBe(
    true,
  );
  await click('Вернуться к моей схеме');
  expect(left()).toBe(70);
});
it('saves several named schemes, replaces the current ID and restores after remount', async () => {
  await render();
  await click('Создать из состава');
  await input('Название схемы', 'Высокий прессинг');
  await select('Привязка схемы', 'team:arsenal');
  await click('Сохранить схему');
  await click('Сохранить схему');
  expect(saved().schemes).toHaveLength(1);
  await click('Сохранить копию');
  expect(saved().schemes).toHaveLength(2);
  await act(async () => root.render(<div />));
  viewState.reset();
  sessionStorage.clear();
  await render(null);
  expect(host.textContent).toContain('Высокий прессинг');
  await click('Открыть Высокий прессинг');
  expect(host.querySelectorAll('.tactics-player')).toHaveLength(4);
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="Привязка схемы"]')?.value).toBe(
    'team:arsenal',
  );
});
it('asks before replacing dirty edits and confirms deletion', async () => {
  await render();
  await click('Создать из состава');
  await input('Название схемы', 'Схема A');
  await click('Сохранить схему');
  await input('Название схемы', 'Несохранено');
  await click('Открыть Схема A');
  expect(host.textContent).toContain('без сохранения изменений');
  await click('Остаться на доске');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Название схемы"]')?.value).toBe(
    'Несохранено',
  );
  await click('Открыть Схема A');
  await click('Продолжить');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Название схемы"]')?.value).toBe(
    'Схема A',
  );
  await click('Удалить Схема A');
  expect(saved().schemes).toHaveLength(1);
  await click('Продолжить');
  expect(saved().schemes).toHaveLength(0);
});
it('retains a draft between tab mounts, including a temporarily empty title', async () => {
  await render();
  await click('Создать из состава');
  await input('Название схемы', '');
  expect(host.querySelector('.tactics-pitch')).not.toBeNull();
  await act(async () => root.render(<div />));
  await render();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Название схемы"]')?.value).toBe(
    '',
  );
  expect(host.querySelector('.tactics-pitch')).not.toBeNull();
});
it('keeps a draft stable when the provider lineup changes', async () => {
  await render();
  await click('Создать из состава');
  await act(async () =>
    root.render(
      <TacticsBoard
        key={tacticMatch.id}
        detail={tacticMatch}
        payload={{
          ...tacticLineups,
          home: { ...tacticLineups.home, confirmed: true, starters: [] },
        }}
      />,
    ),
  );
  expect(host.querySelectorAll('.tactics-player')).toHaveLength(4);
  expect(host.textContent).toContain('предварительный состав');
});
it('protects future data and reports a failed local save while retaining edits', async () => {
  localStorage.setItem(TACTICS_KEY, JSON.stringify({ version: 2, schemes: [] }));
  await render();
  expect(host.textContent).toContain('более новой версией');
  await click('Создать из состава');
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить схему')!.disabled,
  ).toBe(true);
});
it('provides a view of all saved schemes so unrelated old schemes can be managed', async () => {
  saveScheme({
    ...schemeFromLineups(tacticMatch, tacticLineups, 'old'),
    binding: { kind: 'match', id: tacticMatch.id },
    title: 'Старый матч',
  });
  await act(async () =>
    root.render(
      <TacticsBoard
        detail={{
          ...tacticMatch,
          id: 'next',
          home_team: { id: 'other', name: 'Other' },
          away_team: { id: 'another', name: 'Another' },
        }}
        payload={null}
      />,
    ),
  );
  expect(host.querySelector('.tactics-library')?.textContent).not.toContain('Старый матч');
  await click('Показать все сохранённые схемы');
  expect(host.querySelector('.tactics-library')?.textContent).toContain('Старый матч');
});
