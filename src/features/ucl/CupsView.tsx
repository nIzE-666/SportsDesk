import type { CupTab } from './TournamentView';
import { TournamentView } from './TournamentView';

export type { CupTab } from './TournamentView';

/** The same tournament screen, with the three tabs a cup has. */
export function CupsView({
  competitionId,
  tab,
  onTabChange,
}: {
  competitionId: string;
  tab: CupTab;
  onTabChange: (tab: CupTab) => void;
}) {
  return (
    <TournamentView
      key={competitionId}
      competitionId={competitionId}
      tab={tab}
      onTabChange={(next) => {
        if (next === 'matches' || next === 'table' || next === 'bracket') onTabChange(next);
      }}
    />
  );
}

export default CupsView;
