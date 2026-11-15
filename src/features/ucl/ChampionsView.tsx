import { CHAMPIONS_LEAGUE_ID } from '../../lib/navigation';
import type { UclTab } from './TournamentView';
import { TournamentView } from './TournamentView';

export type { UclTab } from './TournamentView';

/** The Champions League is the tournament screen with the full set of tabs. */
export function ChampionsView({
  tab,
  onTabChange,
}: {
  tab: UclTab;
  onTabChange: (tab: UclTab) => void;
}) {
  return <TournamentView competitionId={CHAMPIONS_LEAGUE_ID} tab={tab} onTabChange={onTabChange} />;
}
