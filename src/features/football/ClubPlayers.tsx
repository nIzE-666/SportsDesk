import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Star } from 'lucide-react';
import { PersonAvatar } from '../../components/PersonAvatar';
import { useViewState } from '../../lib/useViewState';
import { useDataRecovery } from '../../lib/useDataRecovery';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Panel,
  PanelHeader,
  SearchSelect,
  Skeleton,
} from '../../kit';
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

function roleLabel(role: SquadMember['role']): string {
  return role === 'start' ? 'Стартовый состав' : role === 'sub' ? 'Запасные' : 'Участники матча';
}

export function ClubPlayers({
  team,
  matches,
  onOpenMatch,
  onDetailChange,
  heading,
  groupBy = 'role',
  visibleLimit = 0,
}: {
  team: TeamRef;
  matches: MatchSummary[];
  onOpenMatch: (id: string) => void;
  onDetailChange?: (open: boolean) => void;
  /** Panel heading; the players directory keeps «Состав · {club}». */
  heading?: string;
  /** `position` groups by the provider position, `role` keeps starters and subs apart. */
  groupBy?: 'role' | 'position';
  /** Collapse a long list after this many players; 0 shows all. */
  visibleLimit?: number;
}) {
  const { isPlayerFavorite, togglePlayer } = useFavorites();
  const top = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
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
  }, [requestKey, retry, match, team.id]);
  const current = result?.key === requestKey ? result : null;
  const selected = current?.members.find((p) => p.id === selectedId);
  const detailOpen = !!(selected && match);
  useEffect(() => {
    onDetailChange?.(detailOpen);
  }, [detailOpen, onDetailChange]);
  useEffect(
    () => () => {
      onDetailChange?.(false);
    },
    [onDetailChange],
  );
  useLayoutEffect(() => {
    if (detailOpen) top.current?.scrollIntoView?.({ block: 'start' });
  }, [detailOpen]);
  if (selected && match)
    return (
      <div className="players-profile" ref={top}>
        {selected.entry ? (
          <PlayerProfile
            key={`profile.${selected.id}`}
            entry={selected.entry}
            detail={match}
            backLabel="К составу"
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <Panel aria-label={selected.name}>
            <div className="players-profile__actions">
              <Button
                onClick={() => setSelectedId(null)}
                icon={<ArrowLeft size={14} aria-hidden="true" />}
              >
                К составу
              </Button>
              <Button
                aria-pressed={isPlayerFavorite(selected.id)}
                onClick={() => togglePlayer(savedPlayer(selected, team, match))}
                icon={
                  <Star
                    size={14}
                    fill={isPlayerFavorite(selected.id) ? 'currentColor' : 'none'}
                    aria-hidden="true"
                  />
                }
              >
                {isPlayerFavorite(selected.id) ? 'В избранном' : 'В избранное'}
              </Button>
            </div>
            <div className="players-profile__head">
              <PersonAvatar name={selected.name} src={selected.imageUrl} size={64} />
              <div>
                <h2>{selected.name}</h2>
                <p className="players-note">{team.name}</p>
              </div>
            </div>
            <p className="players-note">В заявке последнего матча, но статистики нет.</p>
          </Panel>
        )}
        <div className="players-profile__panels">
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
      </div>
    );

  const members = current?.members ?? [];
  const positionGroups = groupBy === 'position' ? squadPositionGroups(members) : null;
  const positionLabelById = new Map<string, string>();
  for (const group of positionGroups ?? [])
    for (const member of group.members) positionLabelById.set(member.id, group.label);
  const playerOptions = members.map((p) => ({
    value: p.id,
    label: p.number ? `${p.name} · № ${p.number}` : p.name,
    group:
      groupBy === 'position' ? (positionLabelById.get(p.id) ?? 'Без позиции') : roleLabel(p.role),
  }));
  const limit = expanded ? 0 : visibleLimit;
  let remaining = limit;
  const shownGroups = positionGroups?.flatMap((group) => {
    if (limit > 0 && remaining <= 0) return [];
    const shown = limit > 0 ? group.members.slice(0, remaining) : group.members;
    remaining -= shown.length;
    return shown.length ? [{ ...group, members: shown, total: group.members.length }] : [];
  });
  const flatMembers = limit > 0 ? members.slice(0, limit) : members;
  const canExpand = visibleLimit > 0 && members.length > visibleLimit;
  const panelTitle = heading ?? `Состав · ${team.name}`;

  const renderRow = (p: SquadMember) => (
    <li className="players-squad__row squad-player" key={p.id}>
      <Button
        variant="quiet"
        className="players-squad__open squad-player-open"
        onClick={() => setSelectedId(p.id)}
        aria-label={`Статистика: ${p.name}`}
      >
        <PersonAvatar name={p.name} src={p.imageUrl} size={32} />
        <span className="players-squad__text">
          <strong>{p.name}</strong>
          <small>
            {p.number ? `№ ${p.number} · ` : ''}
            {roleLabel(p.role)}
            {p.captain ? ' · Капитан' : ''}
          </small>
        </span>
        <ChevronRight size={15} aria-hidden="true" />
      </Button>
      <IconButton
        aria-pressed={isPlayerFavorite(p.id)}
        aria-label={`${isPlayerFavorite(p.id) ? 'Убрать из избранного' : 'В избранное'}: ${p.name}`}
        onClick={() => match && togglePlayer(savedPlayer(p, team, match))}
        icon={<Star size={17} fill={isPlayerFavorite(p.id) ? 'currentColor' : 'none'} />}
      />
    </li>
  );

  return (
    <Panel className="players-squad club-players" aria-label={panelTitle}>
      <PanelHeader
        title={
          <span className="players-squad__title">
            {panelTitle}
            {members.length > 0 && <Badge>{countRu(members.length, PLAYERS)}</Badge>}
          </span>
        }
        action={
          match ? (
            <Button variant="quiet" disabled={!current} onClick={() => setRetry((n) => n + 1)}>
              Обновить состав
            </Button>
          ) : undefined
        }
      />
      <p className="players-note">
        {match
          ? `Заявка последнего завершённого матча: ${match.home_team.name} — ${match.away_team.name} · ${formatHumanDate(match.time_utc ?? match.date, getUserTimezone())}.`
          : 'В расписании нет завершённого матча этого клуба.'}
      </p>
      {match && !current && (
        <div className="players-squad__loading" role="status">
          <Skeleton className="players-squad__skeleton" />
          <Skeleton className="players-squad__skeleton" />
          <Skeleton className="players-squad__skeleton" />
          <span className="visually-hidden">Загружаем игроков и фотографии…</span>
        </div>
      )}
      {current?.error && (
        <EmptyState
          tone="error"
          title="Состав недоступен"
          message={current.error}
          action={
            <Button variant="quiet" onClick={() => setRetry((n) => n + 1)}>
              Повторить
            </Button>
          }
        />
      )}
      {current?.note && (
        <p role="status" className="players-note">
          {current.note}
        </p>
      )}
      {members.length > 1 && (
        <div className="players-squad__search">
          <span className="players-squad__label">Найти игрока в составе</span>
          <SearchSelect
            ariaLabel="Найти игрока в составе"
            value=""
            options={playerOptions}
            onChange={(id) => {
              if (id) setSelectedId(id);
            }}
            placeholder="Найти игрока в составе"
          />
        </div>
      )}
      {members.length > 0 &&
        (shownGroups ? (
          <div className="squad-position-groups">
            {shownGroups.map((group) => (
              <section className="squad-position-group" key={group.key}>
                <h3 className="squad-position-title">
                  {group.label}
                  <span className="muted small">{group.total}</span>
                </h3>
                <ul className="players-squad__list">{group.members.map(renderRow)}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="players-squad__list">{flatMembers.map(renderRow)}</ul>
        ))}
      {canExpand && (
        <div className="squad-more">
          <Button variant="quiet" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Свернуть' : 'Показать все'}
          </Button>
        </div>
      )}
      {current && !current.error && members.length === 0 && (
        <EmptyState
          title="Состав отсутствует"
          message="Источник не вернул игроков последнего матча."
        />
      )}
    </Panel>
  );
}
