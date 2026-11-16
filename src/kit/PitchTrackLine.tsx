import { useId } from 'react';
import { cx } from './classes';

export type PitchTrackLineVariant = 'hero' | 'track';

export interface PitchTrackLineProps {
  /** `hero` draws the pitch and the sweeping track; `track` is the flat week rail. */
  variant?: PitchTrackLineVariant;
  /**
   * 0–1 part of the week rail that has already passed. The future part is drawn
   * red with kerbs, the past one stays muted. `null` keeps the whole rail muted.
   */
  progress?: number | null;
  className?: string;
}

const TRACK_WIDTH = 1200;
const TRACK_HEIGHT = 160;
const HERO_WIDTH = 1200;
const HERO_HEIGHT = 240;

/** A cube path shared by the hero track surface, its kerbs and its racing line. */
const HERO_TRACK = 'M 660 120 C 720 78 780 70 840 98 C 900 126 950 124 1010 108';
const WEEK_TRACK = 'M 0 80 C 200 74 400 86 600 80 C 800 74 1000 86 1200 80';

/**
 * The decorative «поле → трасса» drawing of the showcase layer: pitch markings
 * run into a curved race track with red and white kerbs. It carries no meaning
 * for a screen reader; the components around it name everything themselves.
 */
export function PitchTrackLine({
  variant = 'hero',
  progress = null,
  className,
}: PitchTrackLineProps) {
  const clipId = `ui-pitch-track-${useId().replace(/:/g, '')}`;
  const hero = variant === 'hero';
  const passed = progress == null ? null : Math.min(1, Math.max(0, progress));

  return (
    <svg
      className={cx(
        'ui-pitch-track',
        hero ? 'ui-pitch-track--hero' : 'ui-pitch-track--track',
        className,
      )}
      viewBox={`0 0 ${hero ? HERO_WIDTH : TRACK_WIDTH} ${hero ? HERO_HEIGHT : TRACK_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {passed != null && (
        <defs>
          <clipPath id={clipId}>
            <rect
              x={TRACK_WIDTH * passed}
              y="0"
              width={TRACK_WIDTH * (1 - passed)}
              height={TRACK_HEIGHT}
            />
          </clipPath>
        </defs>
      )}

      {hero ? (
        <>
          <rect className="ui-pitch-track__pitch-tint" x="410" y="34" width="250" height="172" />
          <g className="ui-pitch-track__pitch">
            <rect x="410" y="34" width="250" height="172" />
            <rect x="410" y="68" width="86" height="104" />
            <rect x="410" y="95" width="30" height="50" />
            <line x1="535" y1="34" x2="535" y2="206" />
            <circle cx="535" cy="120" r="48" />
          </g>

          <g className="ui-pitch-track__rail">
            <path className="ui-pitch-track__surface" d={HERO_TRACK} />
            <g transform="translate(0 -18)">
              <path className="ui-pitch-track__kerb-white" d={HERO_TRACK} />
              <path className="ui-pitch-track__kerb-red" d={HERO_TRACK} />
            </g>
            <g transform="translate(0 18)">
              <path className="ui-pitch-track__kerb-white" d={HERO_TRACK} />
              <path className="ui-pitch-track__kerb-red" d={HERO_TRACK} />
            </g>
            <path className="ui-pitch-track__racing" d={HERO_TRACK} />
          </g>
        </>
      ) : (
        <>
          <path className="ui-pitch-track__week-base" d={WEEK_TRACK} />
          {passed != null && passed < 1 && (
            <g clipPath={`url(#${clipId})`}>
              <path className="ui-pitch-track__week-future" d={WEEK_TRACK} />
              <path className="ui-pitch-track__kerb-white" d={WEEK_TRACK} />
              <path className="ui-pitch-track__kerb-red" d={WEEK_TRACK} />
            </g>
          )}
        </>
      )}
    </svg>
  );
}
