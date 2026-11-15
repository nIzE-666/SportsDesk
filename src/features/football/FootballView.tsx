import { useEffect, useMemo } from 'react';
import { PageFrame } from '../../components/PageFrame';
import { FavoritesProvider, useFavorites } from './FavoritesProvider';
import { MatchDetailView } from './MatchDetailView';
import { MatchesView } from './MatchesView';
import { PlayersCenter } from './PlayersCenter';
import { StandingsView } from './StandingsView';
import { TeamView } from './TeamView';
import './football.css';
import { useFootballData } from './useFootballData';
import type { MatchesFilter } from '../../lib/navigation';

export type FootballSection = 'matches' | 'standings' | 'team' | 'players';

export interface FootballViewProps {
  leagueId?: string;
  onLeagueChange?: (id: string) => void;
  section: FootballSection;
  selectedTeamId?: string;
  /** A migrated «Сейчас идут» link opens «Матчи» with that filter. */
  initialMatchesFilter?: MatchesFilter;
  matchId?: string | null;
  onOpenMatch: (matchId: string, leagueId?: string, season?: string) => void;
  onOpenTeam: (teamId: string, teamName?: string, leagueId?: string) => void;
}

function FootballBody({
  leagueId,
  onLeagueChange,
  section,
  selectedTeamId,
  initialMatchesFilter,
  matchId,
  onOpenMatch,
  onOpenTeam,
}: FootballViewProps) {
  const { seedFromCatalogue, teamIds } = useFavorites();
  const raw = useFootballData(leagueId, teamIds);
  const data = {
    ...raw,
    setSelectedLeague: (id: string) => {
      raw.setSelectedLeague(id);
      onLeagueChange?.(id);
    },
  };
  useEffect(() => {
    if (leagueId && raw.selectedLeagueId !== leagueId) raw.setSelectedLeague(leagueId);
  }, [leagueId]);
  useEffect(() => seedFromCatalogue(data.teams), [data.teams, seedFromCatalogue]);

  const activeTeamId = selectedTeamId ?? null;
  const handleOpenMatch = (id: string) => {
    const leagueId = data.matches.some((m) => m.id === id)
      ? data.selectedLeagueId
      : data.leagues.find((l) => data.matchesForLeague(l.id).some((m) => m.id === id))?.id;
    // One navigation action preserves the original league as the Back target.
    onOpenMatch(id, leagueId);
  };
  const handleOpenTeam = (id: string, name?: string) => {
    const team = data.teams.find((t) => t.id === id);
    onOpenTeam(id, name, team?.leagueId);
  };

  const handlePickTeam = (teamId: string) => {
    handleOpenTeam(teamId);
  };

  // The live screen may open a match only when PitchAPI already knows the same fixture.
  const pitchMatches = useMemo(
    () =>
      data.leagues.flatMap((league) =>
        data.matchesForLeague(league.id).map((match) => ({ leagueId: league.id, match })),
      ),
    [data.leagues, data.matchesForLeague],
  );

  return (
    <PageFrame
      page={`football.${data.selectedLeagueId}.${data.season}.${matchId ? `match.${matchId}` : `${section}.${activeTeamId ?? ''}`}`}
    >
      <div className="football-view">
        {matchId ? (
          <MatchDetailView
            key={matchId}
            matchId={matchId}
            seasonMatches={data.matches}
            onOpenMatch={handleOpenMatch}
          />
        ) : (
          <>
            {section === 'matches' && (
              <MatchesView
                onOpenMatch={handleOpenMatch}
                data={data}
                pitchMatches={pitchMatches}
                initialFilter={initialMatchesFilter}
              />
            )}
            {section === 'standings' && <StandingsView data={data} onOpenTeam={handleOpenTeam} />}
            {section === 'players' && <PlayersCenter data={data} onOpenMatch={handleOpenMatch} />}
            {section === 'team' && (
              <TeamView
                teamId={activeTeamId}
                data={data}
                onSelectTeam={handlePickTeam}
                onOpenMatch={handleOpenMatch}
              />
            )}
          </>
        )}
      </div>
    </PageFrame>
  );
}

export function FootballView(props: FootballViewProps) {
  return (
    <FavoritesProvider>
      <FootballBody {...props} />
    </FavoritesProvider>
  );
}
