// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchRow } from './index';
import { click, createTestHost } from './testHost';

const HOME = { name: 'Арсенал' };
const AWAY = { name: 'Челси' };

let app: ReturnType<typeof createTestHost>;

beforeEach(() => {
  app = createTestHost();
});

afterEach(async () => {
  await app.unmount();
});

const score = () => app.host.querySelector('.ui-match-row__score')?.textContent;

describe('MatchRow', () => {
  it('shows the time, both teams and the score', async () => {
    await app.render(
      <MatchRow
        home={HOME}
        away={AWAY}
        time="21:30"
        status="scheduled"
        score={{ home: 2, away: 1 }}
        competition="Премьер-лига"
      />,
    );
    expect(app.host.querySelector('.ui-match-row__time')?.textContent).toBe('21:30');
    expect(app.host.querySelectorAll('.ui-match-row__team-name')[0]?.textContent).toBe('Арсенал');
    expect(app.host.querySelectorAll('.ui-match-row__team-name')[1]?.textContent).toBe('Челси');
    expect(score()).toBe('2 : 1');
    expect(app.host.querySelector('.ui-match-row__competition')?.textContent).toBe('Премьер-лига');
  });

  it('shows a dash for an unknown value', async () => {
    await app.render(<MatchRow home={HOME} away={AWAY} score={{ home: null, away: null }} />);
    expect(score()).toBe('—');
    expect(app.host.querySelector('.ui-match-row__time')?.textContent).toBe('—');

    await app.render(<MatchRow home={HOME} away={AWAY} score={{ home: 2, away: null }} />);
    expect(score()).toBe('2 : —');
  });

  it('hides the score in the spoiler mode', async () => {
    await app.render(
      <MatchRow home={HOME} away={AWAY} score={{ home: 2, away: 1 }} hideScore time="21:30" />,
    );
    expect(score()).toBe('? : ?');
    expect(app.host.querySelector('.ui-match-row__score')?.className).toContain(
      'ui-match-row__score--hidden',
    );
    expect(app.host.querySelector('.ui-match-row__score')?.getAttribute('title')).toBe(
      'Результат скрыт',
    );
  });

  it('does not mask a score that is missing altogether', async () => {
    await app.render(<MatchRow home={HOME} away={AWAY} hideScore />);
    expect(score()).toBe('—');
  });

  it('shows the live minute and the postponed state', async () => {
    await app.render(
      <MatchRow home={HOME} away={AWAY} status="live" minute={67} score={{ home: 1, away: 0 }} />,
    );
    expect(app.host.querySelector('.ui-match-row__time')?.textContent).toBe('67′');
    expect(app.host.querySelector('.ui-match-row__state')?.textContent).toBe('Идёт');

    await app.render(<MatchRow home={HOME} away={AWAY} status="postponed" />);
    expect(app.host.querySelector('.ui-match-row__time')?.textContent).toBe('Перенесён');

    await app.render(
      <MatchRow home={HOME} away={AWAY} status="finished" score={{ home: 0, away: 0 }} />,
    );
    expect(app.host.querySelector('.ui-match-row__time')?.textContent).toBe('Завершён');
    expect(score()).toBe('0 : 0');
  });

  it('uses the three sizes and the actions slot', async () => {
    await app.render(
      <>
        <MatchRow home={HOME} away={AWAY} size="compact" />
        <MatchRow home={HOME} away={AWAY} size="large" />
        <MatchRow
          home={HOME}
          away={AWAY}
          actions={
            <button type="button" aria-label="Открыть матч">
              Открыть
            </button>
          }
        />
      </>,
    );
    const rows = [...app.host.querySelectorAll('.ui-match-row')];
    expect(rows[0]?.className).toContain('ui-match-row--compact');
    expect(rows[1]?.className).toContain('ui-match-row--large');
    expect(rows[2]?.querySelector('.ui-match-row__actions button')?.textContent).toBe('Открыть');
    expect(rows[2]?.tagName).toBe('DIV');
  });

  it('is a button when the whole row is clickable', async () => {
    const onClick = vi.fn();
    await app.render(<MatchRow home={HOME} away={AWAY} onClick={onClick} ariaLabel="Открыть" />);
    const row = app.host.querySelector('button.ui-match-row')!;
    expect(row.getAttribute('aria-label')).toBe('Открыть');
    await click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
