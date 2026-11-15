import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, StatTile } from '../../kit';
import { api } from '../../lib/bridge';
import { useNow } from '../../lib/useNow';
import { formatHumanDateTime } from '../../lib/humanDate';
import { getUserTimezone } from '../football/storage';
import { SPOILER_MASK, useSpoilerSet, spoilerKey } from '../spoilers/spoilerStore';
import {
  needsCheck,
  observeMatchResult,
  removePrediction,
  resetPredictions,
  settle,
  summarize,
  usePredictions,
  type ObservedMatch,
  type Prediction,
} from './predictions';
import './games.css';

const MAX_CHECKS = 12;
const HIT_LABEL = { exact: 'точный счёт', outcome: 'верный исход', miss: 'мимо' } as const;

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Достаёт из ответа API только то, что нужно для проверки прогноза. */
function parseMatch(payload: unknown, fallback: Prediction): ObservedMatch | null {
  const root = payload as { data?: unknown } | null;
  const data = (root && typeof root === 'object' && 'data' in root ? root.data : payload) as Record<
    string,
    unknown
  > | null;
  if (!data || typeof data !== 'object' || typeof data.status !== 'string') return null;
  const league = data.league as { id?: unknown } | undefined;
  const team = (value: unknown) => (value as { name?: unknown } | undefined)?.name;
  return {
    id: fallback.matchId,
    leagueId: typeof league?.id === 'string' ? league.id : fallback.leagueId,
    status: data.status,
    timeUtc: typeof data.time_utc === 'string' ? data.time_utc : null,
    homeName: typeof team(data.home_team) === 'string' ? (team(data.home_team) as string) : '',
    awayName: typeof team(data.away_team) === 'string' ? (team(data.away_team) as string) : '',
    scoreHome: asNumber(data.score_home),
    scoreAway: asNumber(data.score_away),
  };
}

/**
 * Вкладка «Угадай счёт»: итоги игры и список прогнозов. Результаты матчей,
 * которые уже должны были закончиться, проверяются только по кнопке.
 */
export function PredictionsGame({
  onOpenMatch,
}: {
  onOpenMatch?: (matchId: string, leagueId?: string) => void;
}) {
  const { items } = usePredictions();
  const hiddenSet = useSpoilerSet();
  const now = useNow();
  const timezone = getUserTimezone();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmReset]);
  const isHidden = (matchId: string) => hiddenSet.has(spoilerKey('football', matchId));
  const stats = summarize(items, isHidden);
  const due = needsCheck(items, now);
  const sorted = [...items].sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff));

  const check = async () => {
    setChecking(true);
    setNote(null);
    let failed = 0;
    for (const prediction of due.slice(0, MAX_CHECKS)) {
      try {
        const reply = await api('pitch', `matches/${prediction.matchId}`);
        // Устаревший ответ ничего не доказывает: итог берём только из свежего.
        const match = reply.stale ? null : parseMatch(reply.payload, prediction);
        if (match) observeMatchResult(match);
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setChecking(false);
    setNote(
      failed
        ? `Не удалось проверить матчей: ${failed}. Попробуйте позже.`
        : due.length > MAX_CHECKS
          ? `Проверено ${MAX_CHECKS} матчей, остальные — при следующей проверке.`
          : 'Результаты проверены.',
    );
  };

  const describe = (item: Prediction) => {
    const settled = settle(item);
    if (settled.state === 'pending')
      return Date.parse(item.kickoff) > now
        ? `начало ${formatHumanDateTime(item.kickoff, timezone)}`
        : 'ждём итог';
    if (settled.state === 'void')
      return settled.reason === 'cancelled'
        ? 'матч отменён — не считается'
        : settled.reason === 'extra-time'
          ? 'было дополнительное время — не считается'
          : 'изменён после начала — не считается';
    if (isHidden(item.matchId)) return 'результат скрыт режимом без спойлеров';
    return `итог ${settled.result.home} : ${settled.result.away} · ${settled.points} оч. (${
      HIT_LABEL[settled.kind]
    })`;
  };

  return (
    <div className="predictions-game">
      <div className="lights-stats" aria-label="Итоги прогнозов">
        <StatTile label="Очки" value={stats.points} />
        <StatTile label="Оценено матчей" value={stats.scored} />
        <StatTile label="Точный счёт" value={stats.exact} />
        <StatTile label="Верный исход" value={stats.outcome} />
      </div>
      <p className="muted small">
        {stats.scored > 0
          ? `Угадан исход или счёт в ${Math.round(((stats.exact + stats.outcome) / stats.scored) * 100)}% матчей, в среднем ${(
              stats.points / stats.scored
            )
              .toFixed(2)
              .replace('.', ',')} очка за матч.`
          : 'Пока нет оценённых прогнозов.'}{' '}
        Ожидают итога: {stats.pending}. Не считаются: {stats.voided}.
        {stats.hidden > 0 && ` Скрыто режимом без спойлеров: ${stats.hidden} (не входят в итоги).`}
      </p>
      <div className="settings-actions">
        <Button
          small
          icon={<RefreshCw size={14} />}
          disabled={checking || due.length === 0}
          onClick={() => void check()}
        >
          {checking ? 'Проверяем…' : `Проверить результаты (${due.length})`}
        </Button>
      </div>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="muted">
          Прогнозов пока нет. Откройте предстоящий матч Premier League, Ла Лиги, Серии A, Бундеслиги
          или Лиги 1.
        </p>
      ) : (
        <ul className="prediction-list">
          {sorted.map((item) => {
            const settled = settle(item);
            const canRemove =
              settled.state === 'void' ||
              (settled.state === 'pending' && Date.parse(item.kickoff) > now);
            return (
              <li key={item.matchId}>
                <div>
                  <b>
                    {item.homeTeam} — {item.awayTeam}
                  </b>
                  <span className="muted small">
                    Мой прогноз {item.home} : {item.away} · {describe(item)}
                    {settled.state === 'scored' && isHidden(item.matchId) && ` · ${SPOILER_MASK}`}
                  </span>
                </div>
                <div className="prediction-actions">
                  {onOpenMatch && (
                    <Button small onClick={() => onOpenMatch(item.matchId, item.leagueId)}>
                      Открыть матч
                    </Button>
                  )}
                  {canRemove && (
                    <Button small variant="quiet" onClick={() => removePrediction(item.matchId)}>
                      Убрать
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <details className="muted small">
        <summary>Правила игры</summary>
        <p>
          3 очка за точный счёт основного времени, 1 — за верный исход. Прогноз принимается до
          начала матча; отменённые матчи и матчи с дополнительным временем не считаются.
        </p>
      </details>
      <div className="settings-actions">
        <Button
          small
          variant="quiet"
          disabled={items.length === 0}
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            setConfirmReset(false);
            resetPredictions();
          }}
        >
          {confirmReset ? 'Точно стереть все прогнозы?' : 'Стереть все прогнозы'}
        </Button>
      </div>
    </div>
  );
}
