import { ArrowLeftRight, Map, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import { PersonAvatar } from '../../components/PersonAvatar';
import TeamBadge from '../../components/TeamBadge';
import { Badge, Button, EmptyState, Panel, PanelHeader } from '../../kit';
import { useViewState } from '../../lib/useViewState';
import { PlayerProfile } from './MatchPlayers';
import {
  buildPitchTeam,
  lineupPlayerKey,
  ratingText,
  ratingTone,
  type PitchPlayer,
  type PitchTeam,
} from './lineupModel';
import type { LineupsPayload, MatchDetail, PlayerMatchEntry } from './types';
import './matchLineups.css';

interface Props {
  detail: MatchDetail;
  payload: LineupsPayload | null;
  entries: PlayerMatchEntry[];
  error?: string;
  playersError?: string;
  playersLoading?: boolean;
  onOpenTactics?: () => void;
}
function pitchName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 2 &&
    ['de', 'da', 'do', 'dos', 'le', 'van', 'von'].includes(parts.at(-2)!.toLowerCase())
    ? parts.slice(-2).join(' ')
    : (parts.at(-1) ?? name);
}

export function MatchLineups({
  detail,
  payload,
  entries,
  error,
  playersError,
  playersLoading,
  onOpenTactics,
}: Props) {
  const [selectedId, setSelectedId] = useViewState<string | null>(
    `match.${detail.id}.lineup.player`,
    null,
    (v) => v === null || typeof v === 'string',
  );
  const heading = (
    <div className="pitch-card-head">
      <PanelHeader
        title={
          <>
            <Map size={18} /> Поле и оценки
          </>
        }
        action={onOpenTactics ? <Button onClick={onOpenTactics}>На доску</Button> : undefined}
      />
    </div>
  );
  if (
    !payload ||
    (payload.match_id && payload.match_id !== detail.id) ||
    (payload.home_team?.id && payload.home_team.id !== detail.home_team.id) ||
    (payload.away_team?.id && payload.away_team.id !== detail.away_team.id)
  ) {
    return (
      <div className="match-lineups">
        <Panel className="pitch-card">
          {heading}
          <EmptyState
            title={error ? 'Составы недоступны' : 'Составы пока не опубликованы'}
            message={error ?? 'Игроки появятся, когда состав будет опубликован.'}
          />
        </Panel>
      </div>
    );
  }
  const home = buildPitchTeam(detail.home_team, payload.home, entries);
  const away = buildPitchTeam(detail.away_team, payload.away, entries, true);
  const teams = [home, away];
  const selected = teams
    .flatMap((t) => [...t.starters, ...t.subs].map((p) => ({ ...p, team: t.team })))
    .find((p) => p.entry && lineupPlayerKey(p.team.id, p.player.player_id) === selectedId);
  if (selected?.entry)
    return (
      <PlayerProfile
        entry={selected.entry}
        detail={detail}
        onBack={() => setSelectedId(null)}
        backLabel="К расстановке"
      />
    );
  const open = (team: PitchTeam, player: PitchPlayer) => {
    if (player.entry) setSelectedId(lineupPlayerKey(team.team.id, player.player.player_id));
  };
  const positioned = teams.flatMap((team) =>
    team.starters.filter((p) => p.point).map((p) => ({ team, p })),
  );
  const unpositioned = teams.some((team) => team.starters.some((p) => !p.point));
  return (
    <div className="match-lineups">
      <Panel className="pitch-card">
        {heading}
        <div className="pitch-card-sub">
          <span className="analysis-subtitle">Стартовая расстановка</span>
          <Badge>Оценки 0–10</Badge>
        </div>
        {(error || playersError) && (
          <p className="lineup-notice" role="status">
            {error ?? playersError} · Показаны доступные данные.
          </p>
        )}
        {playersLoading && (
          <p className="muted small" role="status">
            Загружаем оценки и фотографии игроков…
          </p>
        )}
        <div className="pitch-team-headings">
          {teams.map((team) => (
            <div key={team.team.id} className={team === home ? 'home' : 'away'}>
              <TeamBadge
                name={team.team.name}
                imageUrl={team.team.image_url}
                size={34}
                side={team === home ? 'home' : 'away'}
              />
              <div>
                <h3>{team.team.name}</h3>
                <p>
                  {team.formation ?? 'Схема не указана'} ·{' '}
                  {team.confirmed ? 'Состав подтверждён' : 'Состав предварительный'}
                </p>
                <small>
                  Средняя оценка: {ratingText(team.average)} ({team.rated} из {team.starters.length}
                  )
                </small>
              </div>
            </div>
          ))}
        </div>
        {positioned.length ? (
          <div
            className="lineup-pitch-scroll"
            tabIndex={0}
            role="region"
            aria-label="Футбольное поле: расстановка и оценки"
          >
            <div className="lineup-pitch">
              <span className="pitch-side-label home">{home.team.name} →</span>
              <span className="pitch-side-label away">← {away.team.name}</span>
              <svg
                className="pitch-markings"
                viewBox="0 0 1000 620"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect x="25" y="25" width="950" height="570" rx="3" />
                <path d="M500 25V595" />
                <circle cx="500" cy="310" r="78" />
                <circle cx="500" cy="310" r="3" className="pitch-spot" />
                <path d="M25 168H172V452H25M975 168H828V452H975M25 244H77V376H25M975 244H923V376H975" />
                <circle cx="132" cy="310" r="3" className="pitch-spot" />
                <circle cx="868" cy="310" r="3" className="pitch-spot" />
                <path d="M172 250Q216 310 172 370M828 250Q784 310 828 370" />
              </svg>
              {positioned.map(({ team, p }) => (
                <Button
                  variant="quiet"
                  className={`pitch-player ${team === home ? 'home' : 'away'}`}
                  key={lineupPlayerKey(team.team.id, p.player.player_id)}
                  style={
                    {
                      '--pitch-x': `${p.point!.left}%`,
                      '--pitch-y': `${p.point!.top}%`,
                    } as CSSProperties
                  }
                  disabled={!p.entry}
                  onClick={() => open(team, p)}
                  aria-label={`${p.player.name}, ${team.team.name}, оценка ${ratingText(p.rating)}${p.entry ? ', открыть статистику' : ', показатели недоступны'}`}
                  title={`${p.player.name} · ${team.team.name} · ${p.entry ? 'Открыть статистику' : 'Показатели пока недоступны'}`}
                >
                  <span className="pitch-player-portrait">
                    <PersonAvatar name={p.player.name} src={p.entry?.player.image_url} size={38} />
                    <small>{p.player.shirt_number ?? '—'}</small>
                    {p.player.is_captain && <i title="Капитан">К</i>}
                  </span>
                  <span className="pitch-player-name">{pitchName(p.player.name)}</span>
                  <span className={`lineup-rating ${ratingTone(p.rating)}`}>
                    {ratingText(p.rating)}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            title="Координаты расстановки пока недоступны"
            message="Игроки перечислены ниже."
          />
        )}
        <div className="pitch-legend">
          <span className="lineup-rating excellent">8–10</span>
          <span className="lineup-rating good">7–7,99</span>
          <span className="lineup-rating average">6–6,99</span>
          <span className="lineup-rating low">0–5,99</span>
          <span className="muted small">— оценка отсутствует</span>
        </div>
        <p className="pitch-caption">
          <ArrowLeftRight size={14} /> Хозяева атакуют вправо, гости — влево.
        </p>
        {unpositioned && (
          <p className="muted small">У части игроков нет позиции на поле — они в списках ниже.</p>
        )}
      </Panel>
      <div className="lineup-team-lists">
        {teams.map((team) => (
          <Panel key={team.team.id}>
            <PanelHeader
              title={
                <>
                  <TeamBadge
                    name={team.team.name}
                    imageUrl={team.team.image_url}
                    size={24}
                    side={team === home ? 'home' : 'away'}
                  />
                  {team.team.name}
                </>
              }
              action={<Badge>{team.formation ?? 'Схема —'}</Badge>}
            />
            {team.coach && <p className="muted small">Тренер: {team.coach}</p>}
            <PlayerList title="Стартовый состав" players={team.starters} team={team} open={open} />
            <PlayerList title="Запасные" players={team.subs} team={team} open={open} />
          </Panel>
        ))}
      </div>
    </div>
  );
}

function PlayerList({
  title,
  players,
  team,
  open,
}: {
  title: string;
  players: PitchPlayer[];
  team: PitchTeam;
  open: (team: PitchTeam, p: PitchPlayer) => void;
}) {
  return (
    <div className="rated-lineup-list">
      <h3>
        <Users size={14} />
        {title}
        <span>{players.length}</span>
      </h3>
      {!players.length && <p className="muted small">Источник пока не указал игроков.</p>}
      {players.map((p) => (
        <Button
          key={p.player.player_id}
          variant="quiet"
          className="rated-lineup-row"
          onClick={() => open(team, p)}
          disabled={!p.entry}
          aria-label={`${title}: ${p.player.name}, оценка ${ratingText(p.rating)}${p.entry ? ', открыть статистику' : ', показатели недоступны'}`}
        >
          <span className="shirt">{p.player.shirt_number ?? '—'}</span>
          <PersonAvatar name={p.player.name} src={p.entry?.player.image_url} size={32} />
          <span className="rated-lineup-name">
            {p.player.name}
            {p.player.is_captain && <small>Капитан</small>}
          </span>
          <small className="rated-lineup-minutes">
            {p.minutes === null ? '—' : `${p.minutes}′`}
          </small>
          <span className={`lineup-rating ${ratingTone(p.rating)}`}>{ratingText(p.rating)}</span>
        </Button>
      ))}
    </div>
  );
}
