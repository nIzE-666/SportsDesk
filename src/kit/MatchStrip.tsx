import { cx } from './classes';

export interface MatchStripGoal {
  /** Minute of the goal; `null` means the minute is unknown. */
  minute: number | null;
  /** Added time: 90+2 is minute 90 with extra 2. */
  extra?: number | null;
  side: 'home' | 'away';
}

export interface MatchStripProps {
  goals: MatchStripGoal[];
  /** Match length in minutes: 90 or 120. */
  length?: 90 | 120;
  className?: string;
}

interface PlacedGoal {
  minute: number;
  label: string;
  side: 'home' | 'away';
  bucket: number;
  lane: 1 | 2;
}

function place(goal: MatchStripGoal, length: number): PlacedGoal | null {
  if (goal.minute == null || !Number.isFinite(goal.minute) || goal.minute < 0) return null;
  const extra =
    goal.extra != null && Number.isFinite(goal.extra) && goal.extra > 0
      ? Math.floor(goal.extra)
      : 0;
  const minute = Math.floor(goal.minute);
  const effective = Math.min(length, minute + extra);
  return {
    minute,
    label: `${minute}${extra > 0 ? `+${extra}` : ''}′`,
    side: goal.side === 'away' ? 'away' : 'home',
    bucket: Math.round((effective / length) * 20) * 5,
    lane: 1,
  };
}

/** Close minutes are put on a second line so their labels never sit on top of each other. */
function assignLanes(placed: PlacedGoal[]): void {
  const last = {
    home: { one: -100, two: -100 },
    away: { one: -100, two: -100 },
  };
  for (const goal of placed) {
    const side = last[goal.side];
    if (goal.bucket - side.one > 10) {
      goal.lane = 1;
      side.one = goal.bucket;
    } else if (goal.bucket - side.two > 10) {
      goal.lane = 2;
      side.two = goal.bucket;
    } else {
      goal.lane = 1;
      side.one = goal.bucket;
    }
  }
}

/**
 * Goals by minute on a thin broadcast bar. Home goals sit above the line and
 * away goals below it; a goal without a minute is not drawn at all.
 */
export function MatchStrip({ goals, length = 90, className }: MatchStripProps) {
  const placed: PlacedGoal[] = [];
  for (const goal of goals) {
    const item = place(goal, length);
    if (item) placed.push(item);
  }
  placed.sort((left, right) => left.bucket - right.bucket);
  assignLanes(placed);
  const unknown = goals.length - placed.length;
  const hidden =
    unknown > 0 ? `Голов без минуты: ${unknown}` : placed.length === 0 ? 'голов нет' : null;

  return (
    <div className={cx('ui-match-strip', className)}>
      <div className="ui-match-strip__bar">
        <span className="ui-match-strip__line" aria-hidden="true" />
        {placed.map((goal, index) => (
          <span
            key={index}
            className={cx(
              'ui-match-strip__goal',
              `ui-match-strip__goal--${goal.side}`,
              `ui-match-strip__goal--p${goal.bucket}`,
              goal.lane === 2 && 'ui-match-strip__goal--lane-2',
            )}
          >
            <span className="ui-match-strip__minute">{goal.label}</span>
            <span className="ui-match-strip__dot" aria-hidden="true" />
          </span>
        ))}
      </div>
      {hidden && <span className="ui-showcase-visually-hidden">{hidden}</span>}
    </div>
  );
}
