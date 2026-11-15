// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './index';
import { click, createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

const buttons = () => [...app.host.querySelectorAll('button')];

describe('Button', () => {
  it('applies the variants and the small size', async () => {
    await app.render(
      <>
        <Button variant="primary">Главная</Button>
        <Button variant="quiet">Тихая</Button>
        <Button danger>Удалить</Button>
        <Button small>Маленькая</Button>
      </>,
    );
    const [primary, quiet, danger, small] = buttons();
    expect(primary?.className).toContain('ui-button--primary');
    expect(quiet?.className).toContain('ui-button--quiet');
    expect(danger?.className).toContain('ui-button--danger');
    expect(small?.className).toContain('ui-button--small');
  });

  it('does not call the handler when disabled', async () => {
    const onClick = vi.fn();
    await app.render(
      <Button disabled onClick={onClick}>
        Недоступно
      </Button>,
    );
    const button = buttons()[0]!;
    expect(button.disabled).toBe(true);
    await click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled and busy while the action is running', async () => {
    const onClick = vi.fn();
    await app.render(
      <Button busy onClick={onClick}>
        Сохраняем
      </Button>,
    );
    const button = buttons()[0]!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(app.host.querySelector('.ui-button__spinner')).not.toBeNull();
    await click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the pressed state of a toggle', async () => {
    await app.render(<Button aria-pressed="true">В избранном</Button>);
    expect(buttons()[0]?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('IconButton', () => {
  it('is square and keeps its accessible name', async () => {
    await app.render(<IconButton aria-label="Закрыть" icon={<span aria-hidden="true">×</span>} />);
    const button = buttons()[0]!;
    expect(button.className).toContain('ui-button--icon');
    expect(button.getAttribute('aria-label')).toBe('Закрыть');
  });
});
