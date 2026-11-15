import { useState, type CSSProperties } from 'react';
import { Trophy } from 'lucide-react';
import { Badge, EmptyState, MatchRow, type MatchRowStatus } from '../../kit';
import { cx } from '../../kit/classes';
import { countRu, MATCHES } from '../../lib/plural';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { formatHumanDateTime } from '../../lib/humanDate';
import { getUserTimezone } from '../football/storage';
import { spoilerKey, useSpoilerSet } from '../spoilers/spoilerStore';
import type {
  BracketData,
  BracketFormat,
  BracketLeg,
  BracketTie,
  UclKnockoutRound,
} from './bracket';

interface RoundDefinition {
  id: UclKnockoutRound;
  label: string;
  caption: string;
}

const TWO_LEG_ROUNDS: RoundDefinition[] = [
  { id: 'playoff', label: 'Стыковые матчи', caption: 'ПУТЬ В 1/8' },
  { id: 'r16', label: '1/8 финала', caption: '16 КОМАНД' },
  { id: 'quarter', label: '1/4 финала', caption: '8 КОМАНД' },
  { id: 'semi', label: 'Полуфиналы', caption: '4 КОМАНДЫ' },
  { id: 'final', label: 'Финал', caption: 'ГЛАВНЫЙ ВЕЧЕР' },
];

/** The World Cup keeps its 1/16 round and the third-place match. */
export function roundsForBracket(format: BracketFormat, season: string): RoundDefinition[] {
  if (format !== 'single-leg') return TWO_LEG_ROUNDS;
  const rounds: RoundDefinition[] = [];
  if (Number(season) >= 2026)
    rounds.push({ id: 'playoff', label: '1/16 финала', caption: '32 КОМАНДЫ' });
  rounds.push(
    { id: 'r16', label: '1/8 финала', caption: '16 КОМАНД' },
    { id: 'quarter', label: '1/4 финала', caption: '8 КОМАНД' },
    { id: 'semi', label: 'Полуфиналы', caption: '4 КОМАНДЫ' },
    { id: 'third', label: 'Матч за третье место', caption: 'БРОНЗОВЫЕ МЕДАЛИ' },
    { id: 'final', label: 'Финал', caption: 'ГЛАВНЫЙ ВЕЧЕР' },
  );
  return rounds;
}

function legStatus(status: string): MatchRowStatus {
  const state = classifyMatchStatus(status);
  if (state === 'finished') return 'finished';
  if (state === 'live') return 'live';
  if (state === 'postponed') return 'postponed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'unknown') return 'unknown';
  return 'scheduled';
}

function legBadge(status: MatchRowStatus) {
  if (status === 'cancelled') return <Badge variant="warning">Отменён</Badge>;
  if (status === 'unknown') return <Badge variant="warning">Статус уточняется</Badge>;
  return undefined;
}

function legRow(
  leg: BracketLeg,
  index: number,
  timezone: string,
  hidden: boolean,
  onOpen: (id: string) => void,
) {
  const date = formatHumanDateTime(leg.date, timezone);
  const status = legStatus(leg.status);
  return (
    <div className="bracket-tie__leg" key={leg.id}>
      <p className="bracket-tie__leg-date">{date}</p>
      <MatchRow
        size="compact"
        home={{ name: leg.realHome.name, imageUrl: leg.realHome.image_url }}
        away={{ name: leg.realAway.name, imageUrl: leg.realAway.image_url }}
        status={status}
        score={{ home: leg.realHomeScore, away: leg.realAwayScore }}
        hideScore={hidden}
        competition={`Матч ${index + 1}`}
        badge={legBadge(status)}
        onClick={() => onOpen(leg.id)}
        ariaLabel={`${leg.realHome.name} — ${leg.realAway.name}, матч ${index + 1}, ${date}`}
      />
    </div>
  );
}

function TieCard({ tie, onOpen }: { tie: BracketTie; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const hidden = useSpoilerSet();
  const timezone = getUserTimezone();
  const legLabel = countRu(tie.legs.length, MATCHES);
  const aggregate =
    tie.aggregateHome != null || tie.aggregateAway != null
      ? { home: tie.aggregateHome, away: tie.aggregateAway }
      : null;
  const hiddenLeg = tie.legs.some((leg) => hidden.has(spoilerKey('football', leg.id)));
  return (
    <div className={tie.round === 'final' ? 'bracket-tie final-tie' : 'bracket-tie'}>
      <MatchRow
        size="compact"
        home={{ name: tie.home.name, imageUrl: tie.home.image_url }}
        away={{ name: tie.away.name, imageUrl: tie.away.image_url }}
        status={tie.complete ? 'finished' : 'scheduled'}
        score={aggregate}
        hideScore={hiddenLeg}
        competition={legLabel}
        onClick={() => setOpen(!open)}
        ariaLabel={`${tie.home.name} — ${tie.away.name}, ${legLabel}. ${
          open ? 'Свернуть' : 'Показать'
        } матчи пары`}
        ariaExpanded={open}
      />
      {tie.complete && !tie.winnerId && (
        <em className="bracket-tie__note">Итоговый победитель не указан источником</em>
      )}
      {open && (
        <div className="bracket-tie__legs">
          {tie.legs.map((leg, index) =>
            legRow(leg, index, timezone, hidden.has(spoilerKey('football', leg.id)), onOpen),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One knockout board for the Champions League and the cups. The aggregate row
 * keeps the tie order; every leg is a kit row with its real home side and its
 * real score, never re-ordered to the tie.
 */
export function TournamentBracket({
  bracket,
  format = 'two-leg',
  season,
  onOpenMatch,
}: {
  bracket: BracketData;
  format?: BracketFormat;
  season: string;
  onOpenMatch: (id: string) => void;
}) {
  const rounds = roundsForBracket(format, season);
  return (
    <>
      <div className="knockout-scroll">
        <div
          className={cx('knockout-board', rounds.length > 5 && 'knockout-board--wrapped')}
          style={{ '--rounds': rounds.length } as CSSProperties}
        >
          {rounds.map((round, index) => (
            <section className={`knockout-stage stage-${round.id}`} key={round.id}>
              <div className="stage-heading">
                <small>{round.caption}</small>
                <h2>{round.label}</h2>
                <span>{String(index + 1).padStart(2, '0')}</span>
              </div>
              <div className="stage-ties">
                {bracket.ties
                  .filter((tie) => tie.round === round.id)
                  .map((tie) => (
                    <TieCard key={tie.id} tie={tie} onOpen={onOpenMatch} />
                  ))}
                {!bracket.ties.some((tie) => tie.round === round.id) && (
                  <EmptyState
                    className="ucl-stage-empty"
                    icon={<Trophy size={20} aria-hidden="true" />}
                    message="Пары появятся после жеребьёвки."
                  />
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
      {bracket.missingDetails > 0 && (
        <p className="muted small">
          Неполные данные: часть стадий не получена ({bracket.missingDetails}).
        </p>
      )}
    </>
  );
}
