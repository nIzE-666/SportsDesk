import type { InterfaceDesign } from '../lib/interfaceDesign';
import type { Location, Section, ShellRoute } from '../lib/navigation';
import type { SearchTarget } from '../lib/searchIndex';
import type { ReactNode } from 'react';

/** Navigation action of the shell and the header tabs. */
export type Navigate = (route: ShellRoute, overrides?: Partial<Omit<Location, 'route'>>) => void;

/** State and actions of the five-section frame. */
export interface FrameProps {
  route: ShellRoute;
  leagueId: string;
  cupId: string;
  design: InterfaceDesign;
  scheme: 'dark' | 'light';
  density: 'default' | 'compact';
  canBack: boolean;
  onBack: () => void;
  navigate: Navigate;
  changeSection: (section: Section) => void;
  setLeagueId: (id: string) => void;
  searchTarget: (target: SearchTarget) => void;
  openFootballMatch: (matchId: string, eventLeague?: string) => void;
  openWeekend: (season: string | number, round: string | number) => void;
  openMini: () => Promise<void>;
  /** Shared overlays (notifications, celebrations, dialogs) kept inside the themed root. */
  children?: ReactNode;
}
