import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { useNow } from '../../lib/useNow';
import { useAtmosphere } from '../atmosphere/atmosphereStore';
import type { MatchDetail } from '../football/types';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { useResultHidden } from '../spoilers/spoilerStore';
import {
  MAX_GOALS,
  PREDICTION_LEAGUES,
  availability,
  observeMatchResult,
  removePrediction,
  savePrediction,
  settle,
  usePredictions,
  type ClosedReason,
  type ObservedMatch,
  type SaveFailure,
} from './predictions';
import './games.css';

export function toObservedMatch(detail: MatchDetail): ObservedMatch {
  return {
    id: detail.id,
    leagueId: detail.league?.id,
    status: detail.status,
    timeUtc: detail.time_utc,
    homeName: detail.home_team.name,
    awayName: detail.away_team.name,
    scoreHome: detail.score_home,
    scoreAway: detail.score_away,
  };
}

export function closedMessage(reason: ClosedReason): string {
  switch (reason) {
    case 'unknown-kickoff':
      return 'Время начала не объявлено — прогноз пока закрыт.';
    case 'started':
      return 'Матч начался — прогноз закрыт.';
    case 'finished':
      return 'Матч завершён — прогноз закрыт.';
    case 'cancelled':
      return 'Матч отменён — очки не начисляются.';
    case 'postponed':
      return 'Матч перенесён — прогноз сохранится и откроется, когда назначат время.';
    case 'unknown-status':
      return 'Статус матча уточняется — прогноз пока закрыт.';
    case 'unsupported':
      return '';
  }
}

export function failureMessage(reason: SaveFailure): string {
  return reason === 'invalid-score'
    ? `Введите целые числа от 0 до ${MAX_GOALS} для обеих команд.`
    : closedMessage(reason);
}

const HIT_LABEL = { exact: 'точный счёт', outcome: 'верный исход', miss: 'мимо' } as const;

function plural(points: number): string {
  const mod100 = points % 100;
  const mod10 = points % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'очков';
  if (mod10 === 1) return 'очко';
  if (mod10 >= 2 && mod10 <= 4) return 'очка';
  return 'очков';
}

/**
 * «Угадай счёт» в карточке матча: свой прогноз на счёт основного времени до
 * начала, а после матча — игровые очки. Показывается только в чемпионатах без
 * дополнительного времени и пока включён блок «Игры и атмосфера».
 */
export function PredictionPanel({
  detail,
  compact = false,
}: {
  detail: MatchDetail;
  compact?: boolean;
}) {
  const settings = useAtmosphere();
  const { items } = usePredictions();
  const hiddenResult = useResultHidden('football', detail.id);
  const now = useNow();
  const prediction = items.find((item) => item.matchId === detail.id);
  const [home, setHome] = useState(prediction ? String(prediction.home) : '');
  const [away, setAway] = useState(prediction ? String(prediction.away) : '');
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const supported = !!detail.league?.id && PREDICTION_LEAGUES.includes(detail.league.id);

  // Свежие данные матча обновляют сохранённый прогноз: перенос, итог, отмену.
  useEffect(() => {
    if (supported) observeMatchResult(toObservedMatch(detail));
  }, [supported, detail]);
  // Поля следуют за сохранённым прогнозом (например, после «Убрать»), но не сбрасываются другими записями.
  const savedHome = prediction?.home;
  const savedAway = prediction?.away;
  const savedAt = prediction?.updatedAt;
  useEffect(() => {
    setHome(savedHome === undefined ? '' : String(savedHome));
    setAway(savedAway === undefined ? '' : String(savedAway));
  }, [savedHome, savedAway, savedAt]);

  if (!settings.enabled || !supported) return null;
  if (compact && !prediction && classifyMatchStatus(detail.status) === 'finished') return null;
  const match = toObservedMatch(detail);
  const open = availability(match, now);
  const settled = prediction ? settle(prediction) : null;

  const save = () => {
    const result = savePrediction(match, {
      home: home.trim() === '' ? Number.NaN : Number(home),
      away: away.trim() === '' ? Number.NaN : Number(away),
    });
    setMessage(result.ok ? 'Прогноз сохранён.' : failureMessage(result.reason));
  };

  return (
    <div className={compact ? 'prediction-disclosure' : undefined}>
      {compact && (
        <button
          type="button"
          className="ghost-btn"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <Target size={14} /> Мой прогноз
        </button>
      )}
      {(!compact || expanded) && (
        <section className="panel prediction-panel" aria-label="Угадай счёт">
          <div className="section-title">
            <h3>
              <Target size={14} /> Угадай счёт · мой прогноз
            </h3>
            <span className="chip">основное время</span>
          </div>
          {open.open ? (
            <form
              className="prediction-form"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <label>
                <span>{detail.home_team.name}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_GOALS}
                  step={1}
                  value={home}
                  onChange={(event) => setHome(event.target.value)}
                  aria-label={`Голы: ${detail.home_team.name}`}
                />
              </label>
              <span aria-hidden="true">:</span>
              <label>
                <span>{detail.away_team.name}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_GOALS}
                  step={1}
                  value={away}
                  onChange={(event) => setAway(event.target.value)}
                  aria-label={`Голы: ${detail.away_team.name}`}
                />
              </label>
              <button className="primary-btn" type="submit">
                {prediction ? 'Изменить прогноз' : 'Сохранить прогноз'}
              </button>
              {prediction && (
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => {
                    removePrediction(detail.id);
                    setMessage('Прогноз убран.');
                  }}
                >
                  Убрать
                </button>
              )}
            </form>
          ) : (
            <p className="muted small">{closedMessage(open.reason)}</p>
          )}
          {prediction && !open.open && (
            <p>
              Ваш прогноз:{' '}
              <b>
                {prediction.home} : {prediction.away}
              </b>
              {settled?.state === 'pending' && ' — ждём итог матча.'}
              {settled?.state === 'void' &&
                (settled.reason === 'cancelled'
                  ? ' — матч отменён, очки не начисляются.'
                  : settled.reason === 'extra-time'
                    ? ' — было дополнительное время: очки не начисляются.'
                    : ' — прогноз изменён уже после начала матча и не учитывается.')}
              {settled?.state === 'scored' &&
                (hiddenResult
                  ? ' — результат скрыт, очки появятся после показа.'
                  : ` · итог основного времени ${settled.result.home} : ${settled.result.away} · ${
                      settled.points
                    } ${plural(settled.points)} (${HIT_LABEL[settled.kind]})`)}
            </p>
          )}
          {message && (
            <p className="small" role="status">
              {message}
            </p>
          )}
          <p className="muted small">
            3 очка за точный счёт основного времени, 1 — за верный исход.
          </p>
        </section>
      )}
    </div>
  );
}
