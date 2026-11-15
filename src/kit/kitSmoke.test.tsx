// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSelect as KitSearchSelect } from './index';
import { SearchSelect as ComponentSearchSelect } from '../components/SearchSelect';
import { Badge, Button, EmptyState, Panel, PanelHeader, Skeleton, Toast, Tooltip } from './index';
import { click, createTestHost } from './testHost';

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

describe('Panel', () => {
  it('renders one h2 and at most one action', async () => {
    await app.render(
      <Panel aria-labelledby="panel-title">
        <PanelHeader
          id="panel-title"
          title="Ближайшие матчи"
          action={<Button variant="quiet">Все</Button>}
        />
        <p>Текст</p>
      </Panel>,
    );
    expect(app.host.querySelectorAll('h2')).toHaveLength(1);
    expect(app.host.querySelector('.ui-panel__title')?.textContent).toBe('Ближайшие матчи');
    expect(app.host.querySelectorAll('.ui-panel__action button')).toHaveLength(1);
  });
});

describe('Badge', () => {
  it('has the five meaning variants', async () => {
    await app.render(
      <>
        <Badge>Обычная</Badge>
        <Badge variant="live">Идёт</Badge>
        <Badge variant="win">Победа</Badge>
        <Badge variant="draw">Ничья</Badge>
        <Badge variant="loss">Поражение</Badge>
        <Badge variant="warning">Предупреждение</Badge>
      </>,
    );
    const classes = [...app.host.querySelectorAll('.ui-badge')].map((badge) => badge.className);
    expect(classes).toEqual([
      'ui-badge',
      'ui-badge ui-badge--live',
      'ui-badge ui-badge--win',
      'ui-badge ui-badge--draw',
      'ui-badge ui-badge--loss',
      'ui-badge ui-badge--warning',
    ]);
  });
});

describe('EmptyState', () => {
  it('shows one sentence and one action', async () => {
    await app.render(
      <EmptyState message="На сегодня матчей нет." action={<Button>Обновить</Button>} />,
    );
    expect(app.host.querySelector('.ui-empty')?.getAttribute('role')).toBe('status');
    expect(app.host.querySelector('.ui-empty__text')?.textContent).toBe('На сегодня матчей нет.');
    expect(app.host.querySelectorAll('.ui-empty__action button')).toHaveLength(1);
  });
});

describe('Tooltip', () => {
  it('links a tooltip to its trigger', async () => {
    await app.render(
      <Tooltip label="Результат скрыт">
        <button type="button">?</button>
      </Tooltip>,
    );
    const wrapper = app.host.querySelector('.ui-tooltip')!;
    const bubble = app.host.querySelector('[role="tooltip"]')!;
    expect(wrapper.getAttribute('aria-describedby')).toBe(bubble.id);
    expect(bubble.textContent).toBe('Результат скрыт');
  });
});

describe('Toast', () => {
  it('is a status message with one dismiss action', async () => {
    const onDismiss = vi.fn();
    await app.render(<Toast message="Профиль сохранён" onDismiss={onDismiss} />);
    expect(app.host.querySelector('.ui-toast')?.getAttribute('role')).toBe('status');
    await click(app.host.querySelector('[aria-label="Закрыть"]')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is an alert for an error', async () => {
    await app.render(<Toast message="Не удалось сохранить" tone="error" />);
    expect(app.host.querySelector('.ui-toast')?.getAttribute('role')).toBe('alert');
  });
});

describe('Skeleton', () => {
  it('is hidden from the accessible tree', async () => {
    await app.render(<Skeleton />);
    const skeleton = app.host.querySelector('.ui-skeleton')!;
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('SearchSelect re-export', () => {
  it('is the existing component, groups included', () => {
    expect(KitSearchSelect).toBe(ComponentSearchSelect);
  });
});
