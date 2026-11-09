// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  SPOILERS_KEY,
  SPOILER_MASK,
  SPOILER_TTL_DAYS,
  f1SpoilerId,
  hiddenFootballIds,
  hideResult,
  isResultHidden,
  isValidSpoilersValue,
  parseSpoilers,
  pruneSpoilers,
  readSpoilers,
  revealResult,
  scoreText,
  spoilerSafeBody,
  HIDDEN_EVENT_BODY,
  getSpoilerSnapshot,
} from './spoilerStore';
import { SpoilerToggle } from './SpoilerToggle';
import { SpoilerGate } from './SpoilerGate';
import { MatchRow } from '../../components/MatchRow';
import { allowedProfileKey, replaceProfile } from '../settings/profileBackup';
import type { MatchSummary } from '../football/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  localStorage.clear();
});

function render(node: ReactNode) {
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
}

const match: MatchSummary = {
  id: 'm-1',
  status: 'finished',
  time_utc: new Date().toISOString(),
  home_team: { id: 'h', name: 'Arsenal' },
  away_team: { id: 'a', name: 'Chelsea' },
  score_home: 3,
  score_away: 1,
};

it('hides and reveals a result, persisting a versioned list', () => {
  expect(isResultHidden('football', 'm-1')).toBe(false);
  hideResult({ kind: 'football', id: 'm-1', label: 'Arsenal — Chelsea' });
  expect(isResultHidden('football', 'm-1')).toBe(true);
  expect(isResultHidden('f1', 'm-1')).toBe(false);
  const stored = JSON.parse(localStorage.getItem(SPOILERS_KEY) ?? 'null');
  expect(stored.version).toBe(1);
  expect(stored.items).toHaveLength(1);
  hideResult({ kind: 'football', id: 'm-1' });
  expect(readSpoilers()).toHaveLength(1);
  expect(hiddenFootballIds()).toEqual(['m-1']);
  revealResult('football', 'm-1');
  expect(isResultHidden('football', 'm-1')).toBe(false);
});

it('ignores broken values and drops invalid or duplicate entries', () => {
  for (const raw of ['{bad', '[]', 'null', '{"items":[]}', '{"version":0,"items":[]}']) {
    localStorage.setItem(SPOILERS_KEY, raw);
    expect(readSpoilers()).toEqual([]);
    expect(isValidSpoilersValue(raw)).toBe(false);
  }
  const now = new Date().toISOString();
  const parsed = parseSpoilers({
    version: 2,
    items: [
      { kind: 'football', id: 'a', addedAt: now },
      { kind: 'football', id: 'a', addedAt: now },
      { kind: 'tennis', id: 'b', addedAt: now },
      { kind: 'f1', id: '', addedAt: now },
      { kind: 'f1', id: 'c', addedAt: 'nope' },
    ],
  });
  expect(parsed?.items.map((e) => e.id)).toEqual(['a']);
});

it('expires entries some days after the event', () => {
  const old = new Date(Date.now() - (SPOILER_TTL_DAYS + 1) * 86_400_000).toISOString();
  const now = new Date().toISOString();
  localStorage.setItem(
    SPOILERS_KEY,
    JSON.stringify({
      version: 1,
      items: [
        { kind: 'football', id: 'old', eventTime: old, addedAt: old },
        { kind: 'football', id: 'fresh', addedAt: now },
      ],
    }),
  );
  expect(isResultHidden('football', 'old')).toBe(false);
  expect(isResultHidden('football', 'fresh')).toBe(true);
  expect(pruneSpoilers()).toBe(1);
  expect(pruneSpoilers()).toBe(0);
  expect(readSpoilers().map((e) => e.id)).toEqual(['fresh']);
});

it('masks the score text', () => {
  expect(scoreText(2, 0, false)).toBe('2 : 0');
  expect(scoreText(2, 0, true)).toBe(SPOILER_MASK);
  expect(scoreText(null, 0, true)).toBe('VS');
});

it('match rows never show the score of a hidden match', () => {
  hideResult({ kind: 'football', id: 'm-1' });
  render(<MatchRow match={match} onClick={() => {}} />);
  expect(container.textContent).not.toContain('3 : 1');
  expect(container.textContent).toContain(SPOILER_MASK);
  act(() => revealResult('football', 'm-1'));
  expect(container.textContent).toContain('3 : 1');
});

it('toggle and gate keep the result closed until explicitly shown', () => {
  render(
    <>
      <SpoilerToggle kind="football" id="m-1" label="Arsenal — Chelsea" />
      <SpoilerGate kind="football" id="m-1">
        <p>Гол: Сака 12′</p>
      </SpoilerGate>
    </>,
  );
  expect(container.textContent).toContain('Гол: Сака');
  const toggle = container.querySelector('button.spoiler-toggle') as HTMLButtonElement;
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  act(() => toggle.click());
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(container.textContent).not.toContain('Гол: Сака');
  expect(container.textContent).toContain('Результат скрыт');
  const show = [...container.querySelectorAll('.spoiler-gate button')][0] as HTMLButtonElement;
  act(() => show.click());
  expect(container.textContent).toContain('Гол: Сака');
});

it('the list is part of the profile backup and validated', () => {
  expect(allowedProfileKey(SPOILERS_KEY)).toBe(true);
  expect(() => replaceProfile({ [SPOILERS_KEY]: '{broken' })).toThrow();
});

it('event feed and catch-up bodies are masked for hidden matches only', () => {
  hideResult({ kind: 'football', id: 'm-1' });
  const set = getSpoilerSnapshot();
  const goal = { sport: 'football', kind: 'goal', body: 'Arsenal 3 : 1 Chelsea', matchId: 'm-1' };
  expect(spoilerSafeBody(set, goal)).toBe(HIDDEN_EVENT_BODY);
  expect(spoilerSafeBody(set, { ...goal, kind: 'reminder' })).toBe(goal.body);
  expect(spoilerSafeBody(set, { ...goal, matchId: 'm-2' })).toBe(goal.body);
  expect(spoilerSafeBody(set, { ...goal, matchId: undefined })).toBe(goal.body);
});

it('a hidden Formula 1 weekend masks its result events but not its reminders', () => {
  hideResult({ kind: 'f1', id: f1SpoilerId('2026', '21') });
  const set = getSpoilerSnapshot();
  const result = {
    sport: 'f1',
    kind: 'result',
    body: 'Abu Dhabi Grand Prix · победитель: Max Verstappen (Red Bull)',
    season: '2026',
    round: '21',
  };
  expect(spoilerSafeBody(set, result)).toBe(HIDDEN_EVENT_BODY);
  expect(spoilerSafeBody(set, { ...result, kind: 'reminder' })).toBe(result.body);
  expect(spoilerSafeBody(set, { ...result, round: '20' })).toBe(result.body);
  expect(spoilerSafeBody(set, { ...result, season: undefined })).toBe(result.body);
  expect(isResultHidden('f1', f1SpoilerId('2026', '21'))).toBe(true);
  expect(isResultHidden('football', f1SpoilerId('2026', '21'))).toBe(false);
});
