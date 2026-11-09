// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/bridge';
import { writeAtmosphere } from '../atmosphere/atmosphereStore';
import type { MatchDetail } from '../football/types';
import { hideResult } from '../spoilers/spoilerStore';
import { PredictionPanel } from './PredictionPanel';
import { PredictionsGame } from './PredictionsGame';
import {
  readPredictions,
  savePrediction,
  type ObservedMatch,
  type Prediction,
} from './predictions';

vi.mock('../../lib/bridge', () => ({
  api: vi.fn(),
  rpc: vi.fn(),
  isTauriRuntime: () => false,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;
const PL = 'l_4WFCIZ';
let root: Root | null = null;
let host: HTMLDivElement | null = null;

const detail = (patch: Partial<MatchDetail> = {}): MatchDetail => ({
  id: 'm1',
  league: { id: PL, name: 'Premier League' },
  home_team: { id: 'a', name: 'Arsenal' },
  away_team: { id: 'c', name: 'Chelsea' },
  status: 'scheduled',
  time_utc: new Date(Date.now() + 5 * HOUR).toISOString(),
  score_home: null,
  score_away: null,
  ...patch,
});

const observedOf = (d: MatchDetail): ObservedMatch => ({
  id: d.id,
  leagueId: d.league?.id,
  status: d.status,
  timeUtc: d.time_utc,
  homeName: d.home_team.name,
  awayName: d.away_team.name,
  scoreHome: d.score_home,
  scoreAway: d.score_away,
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
}
const text = () => host?.textContent ?? '';
const inputs = () => [...(host?.querySelectorAll<HTMLInputElement>('input[type="number"]') ?? [])];
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const buttonByText = (label: string) =>
  [...(host?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(label)) as
    HTMLButtonElement | undefined;
function submit() {
  act(() => {
    host
      ?.querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('PredictionPanel', () => {
  it('is not shown for other competitions or when games are switched off', () => {
    render(<PredictionPanel detail={detail({ league: { id: 'l_0eg6C9', name: 'MLS' } })} />);
    expect(host?.querySelector('.prediction-panel')).toBeNull();
    act(() => root?.render(<PredictionPanel detail={detail({ league: undefined })} />));
    expect(host?.querySelector('.prediction-panel')).toBeNull();
    writeAtmosphere({ enabled: false });
    act(() => root?.render(<PredictionPanel detail={detail()} />));
    expect(host?.querySelector('.prediction-panel')).toBeNull();
  });

  it('saves a prediction before the match and lets you change it', () => {
    render(<PredictionPanel detail={detail()} />);
    expect(text()).toContain('основное время');
    expect(buttonByText('Сохранить прогноз')).toBeDefined();
    const [home, away] = inputs() as [HTMLInputElement, HTMLInputElement];
    type(home, '2');
    type(away, '1');
    submit();
    expect(text()).toContain('Прогноз сохранён');
    expect(readPredictions().items[0]).toMatchObject({ matchId: 'm1', home: 2, away: 1 });
    expect(buttonByText('Изменить прогноз')).toBeDefined();
    type(inputs()[0] as HTMLInputElement, '3');
    submit();
    expect(readPredictions().items).toHaveLength(1);
    expect(readPredictions().items[0]).toMatchObject({ home: 3, away: 1 });
    act(() => buttonByText('Убрать')?.click());
    expect(readPredictions().items).toEqual([]);
    expect(inputs().map((input) => input.value)).toEqual(['', '']);
  });

  it('asks for both numbers and does not save nonsense', () => {
    render(<PredictionPanel detail={detail()} />);
    type(inputs()[0] as HTMLInputElement, '2');
    submit();
    expect(text()).toContain('целые числа от 0 до 20');
    type(inputs()[1] as HTMLInputElement, '25');
    submit();
    expect(text()).toContain('целые числа от 0 до 20');
    expect(readPredictions().items).toEqual([]);
  });

  it('closes editing once the match has started and keeps showing your guess', () => {
    const upcoming = detail();
    expect(savePrediction(observedOf(upcoming), { home: 1, away: 0 })).toEqual({ ok: true });
    render(<PredictionPanel detail={detail({ status: 'live' })} />);
    expect(host?.querySelector('form')).toBeNull();
    expect(text()).toContain('Матч начался — прогноз закрыт');
    expect(text()).toContain('Ваш прогноз: 1 : 0');
    expect(text()).toContain('ждём итог');
  });

  it('does not accept a prediction while the start time is unknown', () => {
    render(<PredictionPanel detail={detail({ time_utc: undefined })} />);
    expect(host?.querySelector('form')).toBeNull();
    expect(text()).toContain('Время начала не объявлено');
  });

  it('shows the points after the match and updates them when the result is corrected', () => {
    const upcoming = detail();
    savePrediction(observedOf(upcoming), { home: 2, away: 1 });
    const done = detail({ status: 'finished', score_home: 2, score_away: 1 });
    render(<PredictionPanel detail={done} />);
    expect(text()).toContain('итог основного времени 2 : 1');
    expect(text()).toContain('3 очка (точный счёт)');
    act(() => root?.render(<PredictionPanel detail={{ ...done, score_home: 3, score_away: 0 }} />));
    expect(text()).toContain('итог основного времени 3 : 0');
    expect(text()).toContain('1 очко (верный исход)');
    expect(readPredictions().items).toHaveLength(1);
  });

  it('keeps a hidden result hidden', () => {
    savePrediction(observedOf(detail()), { home: 2, away: 1 });
    hideResult({ kind: 'football', id: 'm1' });
    render(
      <PredictionPanel detail={detail({ status: 'finished', score_home: 2, score_away: 1 })} />,
    );
    expect(text()).toContain('результат скрыт режимом без спойлеров');
    expect(text()).not.toContain('итог основного времени');
    expect(text()).not.toMatch(/очк[а-я]* \(/);
  });

  it('explains matches that do not count', () => {
    savePrediction(observedOf(detail()), { home: 1, away: 1 });
    render(<PredictionPanel detail={detail({ status: 'cancelled' })} />);
    expect(text()).toContain('Матч отменён');
    act(() =>
      root?.render(
        <PredictionPanel detail={detail({ status: 'AET', score_home: 1, score_away: 1 })} />,
      ),
    );
    expect(text()).toContain('дополнительного времени');
    act(() => root?.render(<PredictionPanel detail={detail({ status: 'postponed' })} />));
    expect(text()).toContain('Матч перенесён');
    expect(text()).toContain('сохранится');
  });
});

describe('PredictionsGame', () => {
  const seed = (id: string, guess: { home: number; away: number }, startsInHours: number) => {
    const d = detail({
      id,
      home_team: { id: `h${id}`, name: `Home ${id}` },
      away_team: { id: `a${id}`, name: `Away ${id}` },
      time_utc: new Date(Date.now() + startsInHours * HOUR).toISOString(),
    });
    // Прогноз ставится до матча; потом часы идут вперёд, а запись остаётся.
    expect(savePrediction(observedOf(d), guess, Date.now() - 20 * HOUR)).toEqual({ ok: true });
    return d;
  };

  it('starts with a friendly empty state', () => {
    render(<PredictionsGame />);
    expect(text()).toContain('Прогнозов пока нет');
    expect(text()).toContain('Пока нет оценённых прогнозов');
    expect(buttonByText('Проверить результаты')?.disabled).toBe(true);
  });

  it('shows totals, hides the score of a spoiler-hidden match and opens a match', () => {
    const a = seed('a', { home: 2, away: 1 }, -5);
    const b = seed('b', { home: 0, away: 0 }, -4);
    seed('c', { home: 1, away: 0 }, 10);
    // Итоги, увиденные приложением.
    const stored = readPredictions().items;
    const withResults: Prediction[] = stored.map((item) =>
      item.matchId === 'a'
        ? { ...item, result: { home: 2, away: 1, seenAt: new Date().toISOString() } }
        : item.matchId === 'b'
          ? { ...item, result: { home: 1, away: 1, seenAt: new Date().toISOString() } }
          : item,
    );
    localStorage.setItem(
      'sportsdesk.view.games.predictions',
      JSON.stringify({ version: 1, items: withResults }),
    );
    const opened: Array<[string, string | undefined]> = [];
    render(<PredictionsGame onOpenMatch={(id, league) => opened.push([id, league])} />);
    const points = () => host?.querySelector('dl dd')?.textContent;
    expect(points()).toBe('4'); // 3 + 1 очка
    expect(text()).toContain('Home a — Away a');
    expect(text()).toContain('итог 2 : 1 · 3 оч. (точный счёт)');
    expect(text()).toContain('итог 1 : 1 · 1 оч. (верный исход)');
    expect(text()).toContain('Ожидают итога: 1');
    act(() => {
      hideResult({ kind: 'football', id: a.id });
    });
    expect(text()).toContain('результат скрыт режимом без спойлеров');
    expect(text()).not.toContain('итог 2 : 1');
    expect(text()).toContain('Скрыто режимом без спойлеров: 1');
    expect(points()).toBe('1'); // три очка скрытого матча в итоги не входят
    act(() => buttonByText('Открыть матч')?.click());
    expect(opened[0]?.[1]).toBe(PL);
    expect(b.id).toBe('b');
  });

  it('checks finished matches on request and counts a corrected result once', async () => {
    seed('a', { home: 2, away: 1 }, -5);
    vi.mocked(api).mockResolvedValue({
      payload: {
        data: {
          id: 'a',
          league: { id: PL },
          home_team: { name: 'Home a' },
          away_team: { name: 'Away a' },
          status: 'finished',
          time_utc: new Date(Date.now() - 5 * HOUR).toISOString(),
          score_home: 2,
          score_away: 1,
        },
      },
      source: 'pitch',
      fetchedAt: '',
      stale: false,
    });
    render(<PredictionsGame />);
    const check = buttonByText('Проверить результаты') as HTMLButtonElement;
    expect(check.disabled).toBe(false);
    await act(async () => check.click());
    expect(api).toHaveBeenCalledWith('pitch', 'matches/a');
    expect(text()).toContain('Результаты проверены');
    expect(text()).toContain('3 оч. (точный счёт)');
    expect(readPredictions().items[0]?.result).toMatchObject({ home: 2, away: 1 });
  });

  it('does not trust a stale answer and says when a check failed', async () => {
    seed('a', { home: 2, away: 1 }, -5);
    vi.mocked(api).mockResolvedValue({
      payload: { data: { status: 'finished', score_home: 0, score_away: 0 } },
      source: 'pitch',
      fetchedAt: '',
      stale: true,
    });
    render(<PredictionsGame />);
    await act(async () => buttonByText('Проверить результаты')?.click());
    expect(text()).toContain('Не удалось проверить матчей: 1');
    expect(readPredictions().items[0]?.result).toBeUndefined();
    vi.mocked(api).mockRejectedValue(new Error('offline'));
    await act(async () => buttonByText('Проверить результаты')?.click());
    expect(text()).toContain('Не удалось проверить матчей: 1');
  });

  it('erases everything only after a second click', () => {
    seed('a', { home: 2, away: 1 }, 10);
    render(<PredictionsGame />);
    const erase = buttonByText('Стереть все прогнозы') as HTMLButtonElement;
    act(() => erase.click());
    expect(erase.textContent).toContain('Точно стереть');
    expect(readPredictions().items).toHaveLength(1);
    act(() => erase.click());
    expect(readPredictions().items).toEqual([]);
  });
});
