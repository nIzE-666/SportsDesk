// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { viewState } from '../../lib/viewState';
import { LivePanel, minuteLabel, type LivePanelProps } from './LivePanel';

vi.mock('../../lib/bridge', () => ({
  api: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock('./FavoritesProvider', () => ({
  useFavorites: () => ({ favoriteTeamNames: ['Arsenal'] }),
  matchInvolvesFavorite: () => false,
}));

const LIVE_DAY = {
  Stages: [
    {
      CompN: 'Premier League',
      CompD: 'England',
      Cnm: 'England',
      Events: [
        {
          Eid: 'live',
          T1: [{ Nm: 'Arsenal' }],
          T2: [{ Nm: 'Visitor' }],
          Eps: "67'",
          Esd: 20261108200000,
          Tr1: '1',
          Tr2: '0',
        },
        {
          Eid: 'finished',
          T1: [{ Nm: 'Everton' }],
          T2: [{ Nm: 'Chelsea' }],
          Eps: 'FT',
          Esd: 20261108203000,
          Tr1: '2',
          Tr2: '1',
        },
        {
          Eid: 'scheduled',
          T1: [{ Nm: 'Aston Villa' }],
          T2: [{ Nm: 'Brentford' }],
          Eps: 'NS',
          Esd: 20261108223000,
        },
      ],
    },
    {
      CompN: 'Jamaica Premier League',
      CompD: 'Jamaica',
      Cnm: 'Jamaica',
      Events: [
        {
          Eid: 'other',
          T1: [{ Nm: 'Other' }],
          T2: [{ Nm: 'Teams' }],
          Eps: 'FT',
          Esd: 20261108200000,
          Tr1: '0',
          Tr2: '0',
        },
      ],
    },
    {
      CompN: 'International Friendly',
      CompD: 'World',
      Cnm: 'World',
      Events: [
        {
          Eid: 'unknown',
          T1: [{ Nm: 'Unknown' }],
          T2: [{ Nm: 'Sides' }],
          Eps: 'FT',
          Esd: 20261108200000,
          Tr1: '0',
          Tr2: '0',
        },
      ],
    },
  ],
};

function reply(payload: unknown, stale = false) {
  return {
    payload,
    source: 'livescore',
    fetchedAt: '2026-11-08T12:00:00.000Z',
    stale,
  };
}

function rowFor(host: HTMLElement, text: string): HTMLElement | null {
  return (
    [...host.querySelectorAll<HTMLElement>('.ui-match-row')].find((row) =>
      row.textContent?.includes(text),
    ) ?? null
  );
}

describe('LivePanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    sessionStorage.clear();
    viewState.reset();
    vi.mocked(api).mockReset();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function render(props: LivePanelProps = {}) {
    await act(async () => root.render(<LivePanel {...props} />));
    await act(async () => {});
  }

  it('limits every filter to followed competitions or favourite clubs', async () => {
    vi.mocked(api).mockResolvedValue(reply(LIVE_DAY));
    await render();
    expect(host.textContent).toContain('Arsenal');
    expect(host.textContent).toContain('Everton');
    expect(host.textContent).not.toContain('Jamaica Premier League');
    expect(host.textContent).not.toContain('International Friendly');
    expect(host.textContent).toContain('Все (3)');
    expect(host.textContent).toContain('Live (1)');
    expect(host.textContent).toContain('Избранные (1)');
    expect(host.querySelectorAll('.source-foot')).toHaveLength(1);
    expect(host.querySelector('.source-foot')?.textContent).toContain('Данные: LiveScore');
    expect(host.querySelector('.source-foot')?.textContent).toContain('обновлено');
    expect(host.textContent).not.toContain('Powered by SportScore');

    const live = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Live (1)'),
    )!;
    await act(async () => live.click());
    expect(host.querySelectorAll('.ui-match-row')).toHaveLength(1);
    expect(rowFor(host, 'Arsenal')?.textContent).toContain("67'");
    expect(rowFor(host, 'Everton')).toBeNull();

    const finished = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Завершённые'),
    )!;
    await act(async () => finished.click());
    expect(host.querySelectorAll('.ui-match-row')).toHaveLength(1);
    expect(rowFor(host, 'Everton')?.textContent).toContain('2 : 1');

    const favorites = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Избранные (1)'),
    )!;
    await act(async () => favorites.click());
    expect(host.querySelectorAll('.ui-match-row')).toHaveLength(1);
    expect(rowFor(host, 'Arsenal')).not.toBeNull();
    expect(vi.mocked(api).mock.calls.some(([source]) => source === 'sportscore')).toBe(false);
  });

  it('shows the minute only live, a dash for an unknown score and the kickoff when scheduled', async () => {
    vi.mocked(api).mockResolvedValue(reply(LIVE_DAY));
    await render();
    const live = rowFor(host, 'Arsenal');
    const finished = rowFor(host, 'Everton');
    const scheduled = rowFor(host, 'Aston Villa');
    expect(live?.textContent).toContain("67'");
    expect(live?.textContent).toContain('1 : 0');
    expect(finished?.textContent).not.toContain("67'");
    expect(finished?.textContent).toContain('2 : 1');
    expect(scheduled?.textContent).toContain('—');
    expect(scheduled?.textContent).toContain('22:30');
    expect(scheduled?.textContent).not.toContain("67'");
  });

  it('shows half-time in words and hides unfamiliar live labels', async () => {
    vi.mocked(api).mockResolvedValue(
      reply({
        Stages: [
          {
            CompN: 'Premier League',
            CompD: 'England',
            Cnm: 'England',
            Events: [
              {
                Eid: 'half',
                T1: [{ Nm: 'Arsenal' }],
                T2: [{ Nm: 'Visitor' }],
                Eps: 'HT',
                Esd: 20261108200000,
              },
              {
                Eid: 'added',
                T1: [{ Nm: 'Everton' }],
                T2: [{ Nm: 'Chelsea' }],
                Eps: "90+3'",
                Esd: 20261108200000,
                Tr1: '1',
                Tr2: '0',
              },
            ],
          },
        ],
      }),
    );
    await render();
    expect(rowFor(host, 'Arsenal')?.textContent).toContain('Перерыв');
    expect(rowFor(host, 'Arsenal')?.textContent).not.toContain('HT');
    expect(rowFor(host, 'Everton')?.textContent).toContain("90+3'");
    expect(minuteLabel('HT')).toBe('Перерыв');
    expect(minuteLabel("45+2'")).toBe("45+2'");
    expect(minuteLabel("90'+6'")).toBe("90'+6'");
    expect(minuteLabel('PEN')).toBeNull();
  });

  it('uses the app name for a known competition and the source name for an unknown one', async () => {
    vi.mocked(api).mockResolvedValue(
      reply({
        Stages: [
          {
            CompN: 'LaLiga',
            CompD: 'Spain',
            Cnm: 'Spain',
            Events: [
              {
                Eid: 'laliga',
                T1: [{ Nm: 'Real Madrid' }],
                T2: [{ Nm: 'Barcelona' }],
                Eps: 'FT',
                Esd: 20261108200000,
                Tr1: '1',
                Tr2: '0',
              },
            ],
          },
          {
            CompN: 'Jamaica Premier League',
            CompD: 'Jamaica',
            Cnm: 'Jamaica',
            Events: [
              {
                Eid: 'favorite-unknown',
                T1: [{ Nm: 'Arsenal' }],
                T2: [{ Nm: 'Visitor' }],
                Eps: 'FT',
                Esd: 20261108200000,
                Tr1: '0',
                Tr2: '0',
              },
            ],
          },
        ],
      }),
    );
    await render();
    expect(host.textContent).toContain('Ла Лига');
    expect(host.textContent).not.toContain('LaLiga');
    expect(host.textContent).toContain('Jamaica Premier League');
  });

  it('opens only a row that matches a loaded PitchAPI fixture', async () => {
    vi.mocked(api).mockResolvedValue(reply(LIVE_DAY));
    const onOpenMatch = vi.fn();
    await render({
      onOpenMatch,
      pitchMatches: [
        {
          leagueId: 'l_4WFCIZ',
          match: {
            id: 'pitch-live',
            status: 'live',
            home_team: { id: 'arsenal', name: 'Arsenal' },
            away_team: { id: 'visitor', name: 'Visitor' },
            time_utc: '2026-11-08T11:30:00Z',
            score_home: 1,
            score_away: 0,
          },
        },
      ],
    });
    const buttons = host.querySelectorAll('button.ui-match-row');
    expect(buttons).toHaveLength(1);
    await act(async () => (buttons[0] as HTMLButtonElement).click());
    expect(onOpenMatch).toHaveBeenCalledWith('pitch-live');
    expect(rowFor(host, 'Everton')?.tagName).toBe('DIV');
  });

  it('explains an empty list instead of asking to change the filter', async () => {
    vi.mocked(api).mockResolvedValue(
      reply({
        Stages: [
          {
            CompN: 'Jamaica Premier League',
            CompD: 'Jamaica',
            Cnm: 'Jamaica',
            Events: [
              {
                Eid: 'other',
                T1: [{ Nm: 'Other' }],
                T2: [{ Nm: 'Teams' }],
                Eps: 'FT',
                Esd: 20261108200000,
              },
            ],
          },
        ],
      }),
    );
    await render();
    expect(host.textContent).toContain('Нет матчей ваших клубов и турниров');
    expect(host.textContent).not.toContain('50 первых матчей дня');
    expect(host.textContent).not.toContain('Попробуйте другой фильтр');
    expect(host.textContent).not.toContain('Jamaica Premier League');
  });

  it('keeps the last matches and marks the source line when a refresh returns saved data', async () => {
    vi.mocked(api).mockResolvedValue(reply(LIVE_DAY, true));
    await render();
    expect(host.querySelectorAll('.ui-match-row')).toHaveLength(3);
    expect(host.querySelector('.source-foot')?.textContent).toContain('устаревшими');
  });
});
