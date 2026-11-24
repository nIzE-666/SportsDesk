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
  type PitchPlayerEvents,
  type PitchTeam,
} from './lineupModel';
import type { LineupsPayload, MatchDetail, MatchEvent, PlayerMatchEntry } from './types';
import './matchLineups.css';

interface Props {
  detail: MatchDetail;
  payload: LineupsPayload | null;
  entries: PlayerMatchEntry[];
  events?: MatchEvent[];
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

function SoccerBallIcon({ ownGoal = false }: { ownGoal?: boolean }) {
  return (
    <svg
      className={`pitch-ball-svg${ownGoal ? ' own-goal' : ''}`}
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="7"
        fill={ownGoal ? '#f87171' : '#f8fafc'}
        stroke="#0f172a"
        strokeWidth="1.2"
      />
      <polygon points="8,4.3 10.9,6.4 9.8,9.8 6.2,9.8 5.1,6.4" fill="#0f172a" />
      <path
        d="M8 1.2V4.3M10.9 6.4L14.2 5.4M9.8 9.8L12.1 13.1M6.2 9.8L3.9 13.1M5.1 6.4L1.8 5.4"
        stroke="#0f172a"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function playerEventSummary(ev: PitchPlayerEvents): string {
  const parts: string[] = [];
  if (ev.goals > 0) {
    parts.push(
      ev.goals === 1
        ? ev.penaltyGoals > 0
          ? 'гол (пен.)'
          : 'гол'
        : `голов: ${ev.goals}${ev.penaltyGoals > 0 ? ` (пен.: ${ev.penaltyGoals})` : ''}`,
    );
  }
  if (ev.ownGoals > 0) parts.push(ev.ownGoals === 1 ? 'автогол' : `автоголы: ${ev.ownGoals}`);
  if (ev.assists > 0) parts.push(ev.assists === 1 ? 'голевая передача' : `голевых: ${ev.assists}`);
  if (ev.yellowCards >= 2 || (ev.yellowCards >= 1 && ev.redCards > 0)) {
    parts.push('вторая жёлтая (удаление)');
  } else if (ev.redCards > 0) {
    parts.push('красная карточка');
  } else if (ev.yellowCards === 1) {
    parts.push('жёлтая карточка');
  }
  if (ev.subbedOffMinute !== null) parts.push(`заменён на ${ev.subbedOffMinute}′`);
  if (ev.subbedOnMinute !== null) parts.push(`вышел на ${ev.subbedOnMinute}′`);
  return parts.join(', ');
}

function isSecondYellow(ev: PitchPlayerEvents): boolean {
  return ev.yellowCards >= 2 || (ev.yellowCards >= 1 && ev.redCards > 0);
}

function hasAnyPitchEvents(ev: PitchPlayerEvents): boolean {
  return (
    ev.goals > 0 ||
    ev.ownGoals > 0 ||
    ev.assists > 0 ||
    ev.yellowCards > 0 ||
    ev.redCards > 0 ||
    ev.subbedOffMinute !== null ||
    ev.subbedOnMinute !== null
  );
}

export function MatchLineups({
  detail,
  payload,
  entries,
  events = [],
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
  const home = buildPitchTeam(detail.home_team, payload.home, entries, false, events);
  const away = buildPitchTeam(detail.away_team, payload.away, entries, true, events);
  const teams = [home, away];
  const anyPitchEvents = teams.some((team) =>
    [...team.starters, ...team.subs].some((p) => hasAnyPitchEvents(p.events)),
  );
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
              {positioned.map(({ team, p }) => {
                const ev = p.events;
                const evSummary = playerEventSummary(ev);
                const labelBase = `${p.player.name}, ${team.team.name}, оценка ${ratingText(p.rating)}${evSummary ? `, ${evSummary}` : ''}`;
                return (
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
                    aria-label={`${labelBase}${p.entry ? ', открыть статистику' : ', показатели недоступны'}`}
                    title={`${p.player.name} · ${team.team.name}${evSummary ? ` · ${evSummary}` : ''} · ${p.entry ? 'Открыть статистику' : 'Показатели пока недоступны'}`}
                  >
                    <span className="pitch-player-portrait">
                      <PersonAvatar
                        name={p.player.name}
                        src={p.entry?.player.image_url}
                        size={38}
                      />
                      <small>{p.player.shirt_number ?? '—'}</small>
                      {p.player.is_captain && <i title="Капитан">К</i>}
                      {(ev.goals > 0 || ev.ownGoals > 0) && (
                        <span
                          className="pitch-ev-goals"
                          title={[
                            ev.goals > 0
                              ? `Голы: ${ev.goals}${ev.penaltyGoals > 0 ? ` (пен.: ${ev.penaltyGoals})` : ''}`
                              : null,
                            ev.ownGoals > 0 ? `Автоголы: ${ev.ownGoals}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          {ev.goals > 0 && (
                            <span className="pitch-ev-ball">
                              <SoccerBallIcon />
                              {ev.goals > 1 && <em>{ev.goals}</em>}
                            </span>
                          )}
                          {ev.ownGoals > 0 && (
                            <span className="pitch-ev-ball own">
                              <SoccerBallIcon ownGoal />
                              {ev.ownGoals > 1 && <em>{ev.ownGoals}</em>}
                            </span>
                          )}
                        </span>
                      )}
                      {(ev.yellowCards > 0 || ev.redCards > 0 || ev.assists > 0) && (
                        <span className="pitch-ev-corner">
                          {ev.assists > 0 && (
                            <span
                              className="pitch-ev-assist"
                              title={
                                ev.assists === 1
                                  ? 'Голевая передача'
                                  : `Голевых передач: ${ev.assists}`
                              }
                            >
                              А{ev.assists > 1 ? ev.assists : ''}
                            </span>
                          )}
                          {isSecondYellow(ev) ? (
                            <span
                              className="pitch-ev-card second-yellow"
                              title="Вторая жёлтая (удаление)"
                            />
                          ) : ev.redCards > 0 ? (
                            <span className="pitch-ev-card red" title="Красная карточка" />
                          ) : ev.yellowCards === 1 ? (
                            <span className="pitch-ev-card yellow" title="Жёлтая карточка" />
                          ) : null}
                        </span>
                      )}
                    </span>
                    <span className="pitch-player-name">{pitchName(p.player.name)}</span>
                    <span className={`lineup-rating ${ratingTone(p.rating)}`}>
                      {ratingText(p.rating)}
                    </span>
                  </Button>
                );
              })}
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
          <span className="pitch-legend-item">
            <span className="lineup-rating unknown">—</span>
            <span className="muted small">оценка отсутствует</span>
          </span>
          {anyPitchEvents && (
            <>
              <span className="pitch-legend-sep" aria-hidden="true" />
              <span className="pitch-legend-item">
                <SoccerBallIcon />
                <span className="muted small">гол</span>
              </span>
              <span className="pitch-legend-item">
                <span className="pitch-ev-assist inline">А</span>
                <span className="muted small">пас</span>
              </span>
              <span className="pitch-legend-item">
                <span className="pitch-ev-card yellow inline" />
                <span className="pitch-ev-card red inline" />
                <span className="muted small">карточка</span>
              </span>
            </>
          )}
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
            <span className="rated-lineup-title">
              <span>{p.player.name}</span>
              {hasAnyPitchEvents(p.events) && (
                <span className="rated-lineup-badges" aria-label={playerEventSummary(p.events)}>
                  {p.events.goals > 0 && (
                    <span className="rated-ev-goal" title={`Голы: ${p.events.goals}`}>
                      <SoccerBallIcon />
                      {p.events.goals > 1 && <span>×{p.events.goals}</span>}
                    </span>
                  )}
                  {p.events.ownGoals > 0 && (
                    <span className="rated-ev-goal own" title={`Автоголы: ${p.events.ownGoals}`}>
                      <SoccerBallIcon ownGoal />
                      {p.events.ownGoals > 1 && <span>×{p.events.ownGoals}</span>}
                    </span>
                  )}
                  {p.events.assists > 0 && (
                    <span className="pitch-ev-assist inline" title={`Голевых: ${p.events.assists}`}>
                      А{p.events.assists > 1 ? p.events.assists : ''}
                    </span>
                  )}
                  {isSecondYellow(p.events) ? (
                    <span
                      className="pitch-ev-card inline second-yellow"
                      title="Вторая жёлтая (удаление)"
                    />
                  ) : p.events.redCards > 0 ? (
                    <span className="pitch-ev-card inline red" title="Красная карточка" />
                  ) : p.events.yellowCards === 1 ? (
                    <span className="pitch-ev-card yellow inline" title="Жёлтая карточка" />
                  ) : null}
                  {p.events.subbedOffMinute !== null && (
                    <span
                      className="rated-ev-sub off"
                      title={`Заменён на ${p.events.subbedOffMinute}′`}
                    >
                      ↓{p.events.subbedOffMinute}′
                    </span>
                  )}
                  {p.events.subbedOnMinute !== null && (
                    <span
                      className="rated-ev-sub on"
                      title={`Вышел на ${p.events.subbedOnMinute}′`}
                    >
                      ↑{p.events.subbedOnMinute}′
                    </span>
                  )}
                </span>
              )}
            </span>
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
