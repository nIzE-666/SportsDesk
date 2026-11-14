/**
 * Cup competition metadata without data-layer imports: navigation, modules and
 * the search index read it without pulling the bridge into a cycle.
 */
export interface CupCompetition {
  id: string;
  /** UI title. */
  title: string;
  /** Hero eyebrow. */
  eyebrow: string;
  /** SportScore standings slug (current season only); undefined = no table. */
  sportscoreSlug?: string;
  /** Theme accent used by the app-root data-theme. */
  theme: string;
  bracketFormat?: 'two-leg' | 'single-leg';
}

export const CUP_COMPETITIONS: CupCompetition[] = [
  {
    id: 'l_0bfbkO',
    title: 'Лига чемпионов',
    eyebrow: 'CHAMPIONS LEAGUE / EUROPE',
    sportscoreSlug: 'uefa-champions-league',
    theme: 'ucl',
  },
  {
    id: 'l_38d9HA',
    title: 'Лига Европы',
    eyebrow: 'EUROPA LEAGUE / EUROPE',
    sportscoreSlug: 'uefa-europa-league',
    theme: 'ucl',
  },
  {
    id: 'l_2WZ2tt',
    title: 'Лига конференций',
    eyebrow: 'CONFERENCE LEAGUE / EUROPE',
    sportscoreSlug: 'uefa-europa-conference-league',
    theme: 'ucl',
  },
  {
    id: 'l_1XLtP0',
    title: 'Чемпионат мира',
    eyebrow: 'WORLD CUP / INTERNATIONAL',
    theme: 'ucl',
    bracketFormat: 'single-leg',
  },
];
