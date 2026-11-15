// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Button, Dialog } from './index';
import { click, createTestHost, pressKey } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Настройки"
        footer={
          <Button variant="primary" onClick={() => setOpen(false)}>
            Сохранить
          </Button>
        }
      >
        <p>Одна короткая фраза.</p>
      </Dialog>
    </>
  );
}

const dialog = () => app.host.querySelector<HTMLElement>('[role="dialog"]');
const opener = () => app.host.querySelector<HTMLButtonElement>('button')!;
const close = () => dialog()!.querySelector<HTMLButtonElement>('[aria-label="Закрыть"]')!;
const save = () => dialog()!.querySelector<HTMLButtonElement>('.ui-dialog__footer button')!;

describe('Dialog', () => {
  it('opens with focus inside and keeps Tab inside', async () => {
    await app.render(<Harness />);
    opener().focus();
    await click(opener());
    expect(dialog()).not.toBeNull();
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(close());

    save().focus();
    await pressKey(save(), 'Tab');
    expect(document.activeElement).toBe(close());

    close().focus();
    await pressKey(close(), 'Tab');
    await pressKey(document.activeElement!, 'Tab');
    expect(document.activeElement).toBe(close());
  });

  it('closes on Escape and returns focus to the opener', async () => {
    await app.render(<Harness />);
    opener().focus();
    await click(opener());
    expect(dialog()).not.toBeNull();
    await pressKey(document.activeElement!, 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });
});
