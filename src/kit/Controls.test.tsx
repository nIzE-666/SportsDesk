// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disclosure, Field, Switch } from './index';
import { click, createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

describe('Field', () => {
  it('ties its label to the control and keeps the hint', async () => {
    await app.render(
      <Field label="Часовой пояс" htmlFor="tz" hint="Меняет время матчей.">
        <select id="tz" defaultValue="UTC">
          <option value="UTC">UTC</option>
        </select>
      </Field>,
    );
    const label = app.host.querySelector<HTMLLabelElement>('.ui-field__label')!;
    expect(label.textContent).toBe('Часовой пояс');
    expect(label.htmlFor).toBe('tz');
    expect(app.host.querySelector('.ui-field__hint')?.textContent).toBe('Меняет время матчей.');
    expect(app.host.querySelector('.ui-field--inline')).toBeNull();
  });

  it('puts the label and the control on one line when asked', async () => {
    await app.render(
      <Field inline label="Источник" htmlFor="source">
        <select id="source">
          <option>Авто</option>
        </select>
      </Field>,
    );
    expect(app.host.querySelector('.ui-field')?.className).toContain('ui-field--inline');
  });
});

describe('Switch', () => {
  it('is a native checkbox with a track and a description', async () => {
    const onChange = vi.fn();
    await app.render(
      <Switch label="Уведомления" description="Работают в трее." checked onChange={onChange} />,
    );
    const input = app.host.querySelector<HTMLInputElement>('.ui-switch__input')!;
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(true);
    expect(app.host.querySelector('.ui-switch__track')).not.toBeNull();
    expect(app.host.querySelector('.ui-switch__description')?.textContent).toBe('Работают в трее.');
    input.click();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('keeps its name and disabled state', async () => {
    await app.render(<Switch label="Игры" checked={false} disabled onChange={() => undefined} />);
    const input = app.host.querySelector<HTMLInputElement>('.ui-switch__input')!;
    expect(input.disabled).toBe(true);
    expect(input.checked).toBe(false);
    expect(app.host.querySelector('.ui-switch')?.className).toContain('ui-switch--disabled');
  });
});

describe('Disclosure', () => {
  it('starts closed and opens from its kit button', async () => {
    await app.render(
      <Disclosure label="Настройки по клубам" hint="2">
        <p>Арсенал</p>
      </Disclosure>,
    );
    const trigger = app.host.querySelector<HTMLButtonElement>('.ui-disclosure__trigger')!;
    expect(trigger.className).toContain('ui-button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    expect(app.host.querySelector('.ui-disclosure__body')).toBeNull();
    expect(app.host.querySelector('.ui-disclosure__hint')?.textContent).toBe('2');
    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const body = app.host.querySelector('.ui-disclosure__body');
    expect(body?.textContent).toBe('Арсенал');
    expect(trigger.getAttribute('aria-controls')).toBe(body?.id);
  });

  it('can start open', async () => {
    await app.render(
      <Disclosure label="Офлайн-сезоны" defaultOpen>
        <p>Сезон 2026</p>
      </Disclosure>,
    );
    expect(app.host.querySelector('.ui-disclosure__body')?.textContent).toBe('Сезон 2026');
  });
});
