import { CalendarDays, Trophy } from 'lucide-react';
import { pluralRu } from '../../lib/plural';

export interface CompetitionFigures {
  teams: number;
  /** Finished matches. */
  played: number;
  goals: number;
}
export type CompetitionTileId = 'teams' | 'played' | 'goals';

/** Figures worth a tile: nothing for a tournament that has no teams or no finished match yet. */
export function competitionTiles(
  f: CompetitionFigures,
): { id: CompetitionTileId; value: number }[] {
  const tiles: { id: CompetitionTileId; value: number }[] = [];
  if (f.teams > 0) tiles.push({ id: 'teams', value: f.teams });
  if (f.played > 0) tiles.push({ id: 'played', value: f.played }, { id: 'goals', value: f.goals });
  return tiles;
}

export type StatTileId = 'played' | 'goals' | 'average' | 'teams';
/** The statistics tab: the same rule, with goals per match only once a match has been played. */
export function statSummaryTiles(f: CompetitionFigures): { id: StatTileId; value: string }[] {
  const tiles: { id: StatTileId; value: string }[] = [];
  if (f.played > 0)
    tiles.push(
      { id: 'played', value: String(f.played) },
      { id: 'goals', value: String(f.goals) },
      { id: 'average', value: (f.goals / f.played).toFixed(2) },
    );
  if (f.teams > 0) tiles.push({ id: 'teams', value: String(f.teams) });
  return tiles;
}

const caption = (id: CompetitionTileId, value: number) =>
  id === 'teams'
    ? pluralRu(value, 'команда в розыгрыше', 'команды в розыгрыше', 'команд в розыгрыше')
    : id === 'played'
      ? pluralRu(value, 'сыгранный матч', 'сыгранных матча', 'сыгранных матчей')
      : pluralRu(
          value,
          'гол в завершённых матчах',
          'гола в завершённых матчах',
          'голов в завершённых матчах',
        );

/** The overview tile row of a tournament; absent while there is nothing to count. */
export function CompetitionInsights(figures: CompetitionFigures) {
  const tiles = competitionTiles(figures);
  if (!tiles.length) return null;
  return (
    <div className="insights-row ucl-insights">
      {tiles.map(({ id, value }) => (
        <div key={id}>
          {id === 'teams' ? (
            <Trophy size={18} />
          ) : id === 'played' ? (
            <CalendarDays size={18} />
          ) : (
            <span className="metric-star">✦</span>
          )}
          <span>
            <strong>{value}</strong>
            <small>{caption(id, value)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
