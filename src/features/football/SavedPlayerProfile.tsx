import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import { api } from '../../lib/bridge';
import { PersonAvatar } from '../../components/PersonAvatar';
import { Button, Panel, Skeleton } from '../../kit';
import { useFavorites } from './FavoritesProvider';
import { PlayerProfile } from './MatchPlayers';
import { SeasonPlayerPanel } from './SeasonPlayerPanel';
import { PlayerFormPanel } from './PlayerFormPanel';
import { loadSquad } from './squad';
import type { FavoritePlayer, MatchDetail, MatchSummary, PlayerMatchEntry } from './types';

export function SavedPlayerProfile({
  player,
  matches,
  onBack,
  onOpenMatch,
}: {
  player: FavoritePlayer;
  matches: MatchSummary[];
  onBack: () => void;
  onOpenMatch: (id: string) => void;
}) {
  const { togglePlayer, isPlayerFavorite } = useFavorites();
  const [state, setState] = useState<{ entry: PlayerMatchEntry; detail: MatchDetail } | null>(null);
  const [busy, setBusy] = useState(!!player.matchId);
  const [error, setError] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    top.current?.scrollIntoView?.({ block: 'start' });
  }, [player.id]);
  useEffect(() => {
    let active = true;
    setState(null);
    setError(null);
    setBusy(!!player.matchId);
    if (player.matchId)
      void Promise.all([
        api('pitch', `matches/${encodeURIComponent(player.matchId)}`),
        loadSquad(player.matchId),
      ])
        .then(([reply, squad]) => {
          if (!active) return;
          const detail = (reply.payload?.data ?? reply.payload) as MatchDetail;
          const entry = squad.entries.find(
            (e) => e.player.id === player.id && (!player.teamId || e.team_id === player.teamId),
          );
          if (!detail?.home_team?.id || !detail.away_team?.id || !entry)
            throw new Error('Индивидуальные показатели сохранённого матча недоступны.');
          setState({ entry, detail });
        })
        .catch((e) => {
          if (active) setError(e.message ?? 'Статистика матча недоступна.');
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    return () => {
      active = false;
    };
  }, [player.id, player.matchId, player.teamId]);
  return (
    <div className="players-profile" ref={top}>
      {state ? (
        <PlayerProfile entry={state.entry} detail={state.detail} onBack={onBack} />
      ) : (
        <Panel aria-label={player.name}>
          <div className="players-profile__actions">
            <Button onClick={onBack} icon={<ArrowLeft size={14} aria-hidden="true" />}>
              К игрокам
            </Button>
            <Button
              aria-pressed={isPlayerFavorite(player.id)}
              onClick={() => togglePlayer(player)}
              icon={
                <Star
                  size={14}
                  fill={isPlayerFavorite(player.id) ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
              }
            >
              {isPlayerFavorite(player.id) ? 'В избранном' : 'В избранное'}
            </Button>
          </div>
          <div className="players-profile__head">
            <PersonAvatar name={player.name} src={player.imageUrl} size={64} />
            <div>
              <h2>{player.name}</h2>
              <p className="players-note">{player.teamName}</p>
            </div>
          </div>
          {busy && (
            <div className="players-profile__loading" role="status">
              <Skeleton className="players-profile__skeleton" />
              <Skeleton className="players-profile__skeleton" />
              <span>Загружаем показатели сохранённого матча…</span>
            </div>
          )}
          {error && (
            <p role="status" className="players-note">
              {error}
            </p>
          )}
        </Panel>
      )}
      <div className="players-profile__panels">
        <PlayerFormPanel
          playerId={player.id}
          teamId={player.teamId ?? ''}
          teamName={player.teamName ?? ''}
          matches={matches}
          onOpenMatch={onOpenMatch}
        />
        <SeasonPlayerPanel
          playerId={player.id}
          teamId={player.teamId ?? ''}
          teamName={player.teamName ?? ''}
          matches={matches}
          onOpenMatch={onOpenMatch}
        />
      </div>
    </div>
  );
}
