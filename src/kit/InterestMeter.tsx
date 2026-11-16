import { cx } from './classes';

export interface InterestMeterProps {
  /** Interest from 1 to 5. `null` or a value outside the scale renders nothing. */
  value: number | null;
  className?: string;
}

const SEGMENTS = [1, 2, 3, 4, 5];

function validValue(value: number | null): value is number {
  return value != null && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Five segments of the broadcast interest mark; an unknown value shows nothing. */
export function InterestMeter({ value, className }: InterestMeterProps) {
  if (!validValue(value)) return null;

  return (
    <span className={cx('ui-interest', className)} role="img" aria-label={`Интерес: ${value} из 5`}>
      {SEGMENTS.map((segment) => (
        <span
          key={segment}
          className={cx('ui-interest__segment', segment <= value && 'ui-interest__segment--on')}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
