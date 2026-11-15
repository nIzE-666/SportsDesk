import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Search, Star } from 'lucide-react';
import { PersonAvatar } from '../../components/PersonAvatar';
import { useViewState } from '../../lib/useViewState';
import { useDataRecovery } from '../../lib/useDataRecovery';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/StateViews';
import { Button, IconButton } from '../../kit';
import { useFavorites } from './FavoritesProvider';
import { PlayerProfile } from './MatchPlayers';
import { SeasonPlayerPanel } from './SeasonPlayerPanel';
import { PlayerFormPanel } from './PlayerFormPanel';
import { loadSquad, mergeSquad, squadPositionGroups, type SquadMember } from './squad';
import { formatHumanDate } from '../../lib/humanDate';
import { countRu, PLAYERS } from '../../lib/plural';
import { getUserTimezone } from './storage';
import type { FavoritePlayer, MatchSummary, TeamRef } from './types';
import './players.css';

export function savedPlayer(p: SquadMember, team: TeamRef, match: MatchSummary): FavoritePlayer {
  return {
    id: p.id,
    name: p.name,
    teamId: team.id,
    teamName: team.name,
    imageUrl: p.imageUrl,
    matchId: match.id,
    matchLabel: `${match.home_team.name} — ${match.away_team.name}`,
    savedAt: new Date().toISOString(),
  };
}

export function ClubPlayers({
  team,
  matches,
  onOpenMatch,
  heading,
  groupBy = 'role',
  visibleLimit = 0,
}: {
  team: TeamRef;
  matches: MatchSummary[];
  onOpenMatch: (id: string) => void;
  /** Panel heading; the players directory keeps «Состав · {club}». */
  heading?: string;
  /** `position` groups by the provider position, `role` keeps starters and subs apart. */
  groupBy?: 'role' | 'position';
  /** Collapse a long position list after this many players; 0 shows all. */
  visibleLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { isPlayerFavorite, togglePlayer } = useFavorites();
  const match = useMemo(
    () =>
      matches
        .filter(
          (m) =>
            m.status === 'finished' && (m.home_team.id === team.id || m.away_team.id === team.id),
        )
        .sort((a, b) =>
          (b.time_utc ?? b.date ?? '').localeCompare(a.time_utc ?? a.date ?? ''),
        )[0] ?? null,
    [matches, team.id],
  );
  const requestKey = `${team.id}:${match?.id ?? ''}`;
  const [result, setResult] = useState<{
    key: string;
    members: SquadMember[];
    error?: string;
    note?: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useDataRecovery(
    (key) =>
      !!match &&
      (key === `pitch:matches/${encodeURIComponent(match.id)}/lineups` ||
        key === `pitch:matches/${encodeURIComponent(match.id)}/players`),
    () => setRetry((n) => n + 1),
  );
  const [query, setQuery] = useViewState<string>(
    `squad.${requestKey}.query`,
    '',
    (v) => typeof v === 'string',
  );
  const [selectedId, setSelectedId] = useViewState<string | null>(
    `squad.${requestKey}.player`,
    null,
    (v) => v === null || typeof v === 'string',
  );
  useEffect(() => {
    if (!match) return;
    let active = true;
    setResult(null);
    void loadSquad(match.id, retry > 0)
      .then((data) => {
        if (active)
          setResult({
            key: requestKey,
            members: mergeSquad(team.id, data.lineup, data.entries),
            note: data.note,
          });
      })
      .catch((error) => {
        if (active)
          setResult({ key: requestKey, members: [], error: String(error.message ?? error) });
      });
    return () => {
      active = false;
    };
  }, [requestKey, retry]);
  const current = result?.key === requestKey ? result : null;
  const selected = current?.members.find((p) => p.id === selectedId);
  if (selected && match)
    return (
      <div className="club-player-detail">
        {selected.entry ? (
          <PlayerProfile
            key={`profile.${selected.id}`}
            entry={selected.entry}
            detail={match}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <section className="panel">
            <Button onClick={() => setSelectedId(null)}>
              <ArrowLeft size={14} /> К составу
            </Button>
            <div className="player-profile-head">
              <PersonAvatar name={selected.name} src={selected.imageUrl} size={64} />
              <div>
                <h2>{selected.name}</h2>
                <p>{team.name}</p>
              </div>
            </div>
            <p className="muted small">В заявке последнего матча, но статистики нет.</p>
            <Button
              aria-pressed={isPlayerFavorite(selected.id)}
              onClick={() => togglePlayer(savedPlayer(selected, team, match))}
            >
              <Star size={14} /> {isPlayerFavorite(selected.id) ? 'В избранном' : 'В избранное'}
            </Button>
          </section>
        )}
        <PlayerFormPanel
          playerId={selected.id}
          teamId={team.id}
          teamName={team.name}
          matches={matches}
          onOpenMatch={onOpenMatch}
        />
        <SeasonPlayerPanel
          key={`season.${selected.id}`}
          playerId={selected.id}
          teamId={team.id}
          teamName={team.name}
          matches={matches}
          onOpenMatch={onOpenMatch}
        />
      </div>
    );
  const renderPlayerCard = (p: SquadMember) => (
    <div className="squad-player" key={p.id}>
      <Button
        variant="quiet"
        className="squad-player-open"
        onClick={() => setSelectedId(p.id)}
        aria-label={`Статистика: ${p.name}`}
      >
        <PersonAvatar name={p.name} src={p.imageUrl} />
        <span className="squad-player-text">
          <strong>{p.name}</strong>
          <small>
            {p.number ? `№ ${p.number} · ` : ''}
            {p.role === 'start'
              ? 'Стартовый состав'
              : p.role === 'sub'
                ? 'Запасной'
                : 'Участник матча'}
            {p.captain ? ' · Капитан' : ''}
          </small>
        </span>
        <ChevronRight size={15} />
      </Button>
      <IconButton
        className={isPlayerFavorite(p.id) ? 'is-active' : undefined}
        aria-pressed={isPlayerFavorite(p.id)}
        aria-label={`${isPlayerFavorite(p.id) ? 'Убрать из избранного' : 'В избранное'}: ${p.name}`}
        onClick={() => match && togglePlayer(savedPlayer(p, team, match))}
        icon={<Star size={17} fill={isPlayerFavorite(p.id) ? 'currentColor' : 'none'} />}
      />
    </div>
  );
  const filtered = (current?.members ?? []).filter((p) =>
    p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const searching = query.trim().length > 0;
  const positionGroups =
    groupBy === 'position' && !searching ? squadPositionGroups(filtered) : null;
  const limit = searching || expanded ? 0 : visibleLimit;
  let remaining = limit;
  const shownGroups =
    positionGroups?.flatMap((group) => {
      if (remaining <= 0 && limit > 0) return [];
      const members = limit > 0 ? group.members.slice(0, remaining) : group.members;
      remaining -= members.length;
      return members.length ? [{ ...group, members, total: group.members.length }] : [];
    }) ?? null;
  const canExpand = !searching && visibleLimit > 0 && filtered.length > visibleLimit;
  return (
    <section className="panel club-players">
      <div className="section-title">
        <h2>{heading ?? `Состав · ${team.name}`}</h2>
        {!!current?.members.length && (
          <span className="muted small">{countRu(current.members.length, PLAYERS)}</span>
        )}
        <Button disabled={!!match && !current} onClick={() => setRetry((n) => n + 1)}>
          Обновить состав
        </Button>
      </div>
      <p className="muted small">
        {match
          ? `Заявка последнего завершённого матча: ${match.home_team.name} — ${match.away_team.name} · ${formatHumanDate(match.time_utc ?? match.date, getUserTimezone())}.`
          : 'В расписании нет завершённого матча этого клуба.'}
      </p>
      {match && !current && <LoadingBlock label="Загружаем игроков и фотографии…" rows={3} />}
      {current?.error && (
        <ErrorBlock
          title="Состав недоступен"
          message={current.error}
          onRetry={() => setRetry((n) => n + 1)}
        />
      )}
      {current?.note && (
        <p role="status" className="muted small">
          {current.note}
        </p>
      )}
      {!!current?.members.length && (
        <>
          {(current.members.length > 1 || query !== '') && (
            <label className="player-search">
              <Search size={16} />
              <input
                aria-label="Поиск игрока в составе"
                placeholder="Найти игрока в составе"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          {shownGroups ? (
            <div className="squad-position-groups">
              {shownGroups.map((group) => (
                <section className="squad-position-group" key={group.key}>
                  <h3 className="squad-position-title">
                    {group.label}
                    <span className="muted small">{group.total}</span>
                  </h3>
                  <div className="squad-player-grid">
                    {group.members.map((p) => renderPlayerCard(p))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="squad-player-grid">{filtered.map((p) => renderPlayerCard(p))}</div>
          )}
          {canExpand && (
            <div className="squad-more">
              <Button variant="quiet" onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Свернуть' : 'Показать все'}
              </Button>
            </div>
          )}
          {!filtered.length && (
            <EmptyBlock title="Таких игроков в составе нет">
              <Button variant="quiet" onClick={() => setQuery('')}>
                Очистить поиск
              </Button>
            </EmptyBlock>
          )}
        </>
      )}
      {current && !current.error && !current.members.length && (
        <EmptyBlock
          title="Состав отсутствует"
          message="Источник не вернул игроков последнего матча."
        />
      )}
    </section>
  );
}
