import { useId } from 'react';
import { cx } from './classes';

export type PitchTrackLineVariant = 'hero' | 'track';

export interface PitchTrackLineProps {
  /** `hero` draws the pitch and the sweeping track; `track` is the flat week rail. */
  variant?: PitchTrackLineVariant;
  /**
   * 0–1 part of the week rail that has already passed. The future part is drawn
   * as a kerb, the past one stays a muted line. `null` keeps the whole rail muted.
   */
  progress?: number | null;
  className?: string;
}

const TRACK_WIDTH = 1200;
const TRACK_HEIGHT = 40;
const TRACK_Y = 20;

/** The touchline of the pitch runs on into this curve of the race track. */
const HERO_TRACK = 'M560 268C720 268 850 262 960 246C1070 230 1140 206 1230 172';
const HERO_BED = `${HERO_TRACK}V330H560Z`;

/**
 * The decorative «поле → трасса» drawing of the showcase layer: the markings of
 * a pitch whose touchline turns into the kerb of a race track. It carries no
 * meaning for a screen reader; the components around it name everything.
 */
export function PitchTrackLine({
  variant = 'hero',
  progress = null,
  className,
}: PitchTrackLineProps) {
  const id = `ui-pitch-track-${useId().replace(/:/g, '')}`;
  const passed = progress == null ? null : Math.min(1, Math.max(0, progress));

  if (variant === 'track') {
    return (
      <svg
        className={cx('ui-pitch-track', 'ui-pitch-track--track', className)}
        viewBox={`0 0 ${TRACK_WIDTH} ${TRACK_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {passed != null && (
          <defs>
            <clipPath id={`${id}-future`}>
              <rect
                x={TRACK_WIDTH * passed}
                y="0"
                width={TRACK_WIDTH * (1 - passed)}
                height={TRACK_HEIGHT}
              />
            </clipPath>
          </defs>
        )}
        <path
          className="ui-pitch-track__week-base"
          d={`M0 ${TRACK_Y}H${TRACK_WIDTH}`}
          vectorEffect="non-scaling-stroke"
        />
        {passed != null && passed < 1 && (
          <g className="ui-pitch-track__week-future" clipPath={`url(#${id}-future)`}>
            <path
              className="ui-pitch-track__kerb-base"
              d={`M0 ${TRACK_Y}H${TRACK_WIDTH}`}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="ui-pitch-track__kerb-stripe"
              d={`M0 ${TRACK_Y}H${TRACK_WIDTH}`}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
      </svg>
    );
  }

  return (
    <svg
      className={cx('ui-pitch-track', 'ui-pitch-track--hero', className)}
      viewBox="0 0 1200 300"
      preserveAspectRatio="xMinYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-streak`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="ui-pitch-track__glow-stop" stopOpacity="0" />
          <stop offset="0.6" className="ui-pitch-track__glow-stop" stopOpacity="0.85" />
          <stop offset="1" className="ui-pitch-track__glow-stop" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={`${id}-fade`}
          gradientUnits="userSpaceOnUse"
          x1="560"
          y1="0"
          x2="720"
          y2="0"
        >
          <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="1300" height="340">
          <rect width="1300" height="340" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>

      <g className="ui-pitch-track__pitch">
        <path d="M-20 24H560V268H-20" />
        <path d="M250 24V268" />
        <circle cx="250" cy="146" r="56" />
        <path d="M560 82H470V210H560M560 116H528V176H560M470 126.6A40 40 0 0 0 470 165.4" />
        <circle className="ui-pitch-track__spot" cx="250" cy="146" r="3" />
        <circle className="ui-pitch-track__spot" cx="505" cy="146" r="2.5" />
      </g>

      <g className="ui-pitch-track__streaks" fill={`url(#${id}-streak)`}>
        <rect x="520" y="74" width="440" height="1.4" />
        <rect x="610" y="100" width="540" height="1" />
        <rect x="480" y="196" width="380" height="1.2" />
        <rect x="700" y="214" width="300" height="1" />
      </g>

      <g className="ui-pitch-track__rail" mask={`url(#${id}-mask)`}>
        <path className="ui-pitch-track__surface" d={HERO_BED} />
        <path className="ui-pitch-track__edge" d={HERO_TRACK} transform="translate(0 42)" />
        <path className="ui-pitch-track__kerb-shadow" d={HERO_TRACK} />
        <path className="ui-pitch-track__kerb-base" d={HERO_TRACK} />
        <path className="ui-pitch-track__kerb-stripe" d={HERO_TRACK} />
      </g>
    </svg>
  );
}
