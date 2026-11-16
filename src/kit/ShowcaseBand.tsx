import { Fragment, type ReactNode } from 'react';
import { cx } from './classes';

export interface ShowcaseBandItem {
  /** Small caps label, for example «До следующей сессии». */
  label: string;
  /** The main value: a name, or a countdown. */
  value: ReactNode;
  /** An optional line under the value. */
  sub?: ReactNode;
}

export interface ShowcaseBandProps {
  /** The plate on the left, for example «Формула 1». */
  title: string;
  items: ShowcaseBandItem[];
  /** A button on the right. */
  action?: ReactNode;
  className?: string;
}

/**
 * A slanted broadcast strip: a plate with the title and «//», a checkered
 * stripe, then a few labelled values separated by slanted lines. Used for the
 * Formula 1 weekend on the «Главное» screen.
 */
export function ShowcaseBand({ title, items, action, className }: ShowcaseBandProps) {
  return (
    <section className={cx('ui-showcase-band', className)} aria-label={title}>
      <p className="ui-showcase-band__plate">
        {title}
        <span className="ui-showcase-band__marks" aria-hidden="true">
          <span className="ui-showcase-band__mark" />
          <span className="ui-showcase-band__mark" />
        </span>
      </p>
      <span className="ui-showcase-band__checks" aria-hidden="true" />
      <div className="ui-showcase-band__items">
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {index > 0 && <span className="ui-showcase-band__sep" aria-hidden="true" />}
            <div className="ui-showcase-band__item">
              <span className="ui-showcase-band__label">{item.label}</span>
              <span className="ui-showcase-band__value">{item.value}</span>
              {item.sub != null && item.sub !== '' && (
                <span className="ui-showcase-band__sub">{item.sub}</span>
              )}
            </div>
          </Fragment>
        ))}
      </div>
      {action != null && <div className="ui-showcase-band__action">{action}</div>}
    </section>
  );
}
