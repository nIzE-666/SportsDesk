import { useEffect } from 'react';
import { footballNav as TABS } from '../../lib/navigationMetadata';
import { PageFrame } from '../../components/PageFrame';
import { useViewState } from '../../lib/useViewState';
import { Dashboard } from './Dashboard';
import { FavoritesProvider, useFavorites } from './FavoritesProvider';
import { LivePanel } from './LivePanel';
import { MatchDetailView } from './MatchDetailView';
import { MatchesView } from './MatchesView';
import { PlayersCenter } from './PlayersCenter';
import { StandingsView } from './StandingsView';
import { TeamView } from './TeamView';
import './football.css';
import { useFootballData } from './useFootballData';

export type FootballSection = 'dashboard' | 'matches' | 'standings' | 'live' | 'team' | 'players';

export interface FootballViewProps {
  leagueId?: string;
  onLeagueChange?: (id: string) => void;
  section: FootballSection;
  selectedTeamId?: string;
  matchId?: string | null;
  onOpenMatch: (matchId: string, leagueId?: string, season?: string) => void;
  onOpenTeam: (teamId: string, teamName?: string) => void;
  onNavigate: (section: FootballSection) => void;
  onBackFromMatch?: () => void;
}

function FootballBody({
  leagueId,
  onLeagueChange,
  section,
  selectedTeamId,
  matchId,
  onOpenMatch,
  onOpenTeam,
  onNavigate,
  onBackFromMatch,
}: FootballViewProps) {
  const raw = useFootballData(leagueId);
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
  const [localTeamId, setLocalTeamId] = useViewState<string | null>(
    'football.team',
    null,
    (v) => v === null || typeof v === 'string',
  );
  const { seedFromCatalogue } = useFavorites();
  useEffect(() => seedFromCatalogue(data.teams), [data.teams, seedFromCatalogue]);

  const activeTeamId = selectedTeamId ?? localTeamId ?? null;
  const handleOpenMatch = (id: string) => {
    const leagueId = data.matches.some((m) => m.id === id)
      ? data.selectedLeagueId
      : data.leagues.find((l) => data.matchesForLeague(l.id).some((m) => m.id === id))?.id;
    // One navigation action preserves the original league as the Back target.
    onOpenMatch(id, leagueId);
  };
  const handleOpenTeam = (id: string, name?: string) => {
    const team = data.teams.find((t) => t.id === id);
    if (team && team.leagueId !== data.selectedLeagueId) data.setSelectedLeague(team.leagueId);
    onOpenTeam(id, name);
  };

  const handlePickTeam = (teamId: string) => {
    setLocalTeamId(teamId);
    onNavigate('team');
  };

  return (
    <PageFrame
      page={`football.${data.selectedLeagueId}.${data.season}.${matchId ? `match.${matchId}` : `${section}.${activeTeamId ?? ''}`}`}
    >
      <div className="football-view">
        <div className="football-tabs" role="tablist" aria-label="Разделы футбола" hidden>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={section === tab.id}
              className={section === tab.id ? 'ftab active' : 'ftab'}
              onClick={() => onNavigate(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {matchId ? (
          <MatchDetailView
            key={matchId}
            matchId={matchId}
            seasonMatches={data.matches}
            onOpenMatch={handleOpenMatch}
            onBack={onBackFromMatch ?? (() => onNavigate('matches'))}
          />
        ) : (
          <>
            {section === 'dashboard' && (
              <Dashboard
                onOpenMatch={handleOpenMatch}
                onOpenTeam={handleOpenTeam}
                onSeeAllMatches={() => onNavigate('matches')}
                data={data}
              />
            )}
            {section === 'matches' && <MatchesView onOpenMatch={handleOpenMatch} data={data} />}
            {section === 'standings' && <StandingsView data={data} onOpenTeam={handleOpenTeam} />}
            {section === 'live' && <LivePanel />}
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
