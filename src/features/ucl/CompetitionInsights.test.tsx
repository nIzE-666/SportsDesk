// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { CompetitionInsights, competitionTiles, statSummaryTiles } from './CompetitionInsights';

const ids = (tiles: { id: string }[]) => tiles.map((t) => t.id);

it('shows no overview tile for a tournament with nothing to count', () => {
  expect(competitionTiles({ teams: 0, played: 0, goals: 0 })).toEqual([]);
});
it('shows the teams before the first match and the matches and goals after it', () => {
  expect(ids(competitionTiles({ teams: 36, played: 0, goals: 0 }))).toEqual(['teams']);
  expect(ids(competitionTiles({ teams: 36, played: 2, goals: 5 }))).toEqual([
    'teams',
    'played',
    'goals',
  ]);
  // Goals mean something only next to a finished match: a goalless draw keeps its zero.
  expect(competitionTiles({ teams: 0, played: 1, goals: 0 })).toEqual([
    { id: 'played', value: 1 },
    { id: 'goals', value: 0 },
  ]);
});
it('keeps the statistics tab free of zeros and dashes', () => {
  expect(statSummaryTiles({ teams: 0, played: 0, goals: 0 })).toEqual([]);
  expect(statSummaryTiles({ teams: 36, played: 0, goals: 0 })).toEqual([
    { id: 'teams', value: '36' },
  ]);
  expect(statSummaryTiles({ teams: 36, played: 4, goals: 10 })).toEqual([
    { id: 'played', value: '4' },
    { id: 'goals', value: '10' },
    { id: 'average', value: '2.50' },
    { id: 'teams', value: '36' },
  ]);
});
it('renders captions in the right form, or nothing', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const captions = () =>
    [...host.querySelectorAll('.insights-row > div')].map(
      (d) => `${d.querySelector('strong')?.textContent}${d.querySelector('small')?.textContent}`,
    );
  try {
    await act(async () => root.render(<CompetitionInsights teams={36} played={2} goals={5} />));
    expect(captions()).toEqual([
      '36команд в розыгрыше',
      '2сыгранных матча',
      '5голов в завершённых матчах',
    ]);
    await act(async () => root.render(<CompetitionInsights teams={21} played={1} goals={1} />));
    expect(captions()).toEqual([
      '21команда в розыгрыше',
      '1сыгранный матч',
      '1гол в завершённых матчах',
    ]);
    await act(async () => root.render(<CompetitionInsights teams={0} played={0} goals={0} />));
    expect(host.querySelector('.insights-row')).toBeNull();
    expect(host.textContent).toBe('');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
