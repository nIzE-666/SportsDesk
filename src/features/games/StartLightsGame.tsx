import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { RotateCcw } from 'lucide-react';
import {
  GOAL_MS,
  LIGHT_COUNT,
  LIGHT_STEP_MS,
  MIN_REACTION_MS,
  RESULT_LOCK_MS,
  TOO_SLOW_MS,
  averageOfLast,
  classifyPress,
  holdDelay,
  readStartLights,
  recordStartLights,
  resetStartLights,
  useStartLights,
  type Outcome,
} from './startLights';
import './games.css';

type Phase = 'idle' | 'lights' | 'hold' | 'go' | 'done';
type Timer = ReturnType<typeof setTimeout>;

/** Источник времени игры; в тестах подменяется. */
export interface GameClock {
  now: () => number;
  /** Время самого нажатия: точнее момента, когда сработал обработчик. */
  pressTime: (event: { timeStamp: number }) => number;
}

export const browserClock: GameClock = {
  now: () => performance.now(),
  pressTime: (event) => {
    const now = performance.now();
    // event.timeStamp — момент нажатия в той же монотонной шкале, что и performance.now().
    return event.timeStamp > 0 && event.timeStamp <= now ? event.timeStamp : now;
  },
};

const RESET_CONFIRM_MS = 4000;

function describe(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'time':
      return `${outcome.ms} мс`;
    case 'false-start':
      return 'Фальстарт';
    case 'too-slow':
      return 'Не успели';
    case 'interrupted':
      return 'Попытка прервана';
  }
}

function explain(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'time':
      return outcome.ms <= GOAL_MS
        ? `Игровая цель — быстрее ${GOAL_MS} мс — достигнута.`
        : `До игровой цели в ${GOAL_MS} мс осталось ${outcome.ms - GOAL_MS} мс.`;
    case 'false-start':
      return outcome.reason === 'early'
        ? 'Вы нажали, пока огни ещё горели.'
        : `Нажатие раньше ${MIN_REACTION_MS / 1000} с после сигнала считается угадыванием.`;
    case 'too-slow':
      return `За ${TOO_SLOW_MS / 1000} секунды после сигнала нажатия не было.`;
    case 'interrupted':
      return 'Окно потеряло фокус, попытка не засчитана.';
  }
}

/**
 * Игра на реакцию: пять огней зажигаются по одному, затем гаснут через
 * случайное время. Нажмите после того, как они погасли. Игру запускает только
 * пользователь; время берётся от кадра, в котором огни погасли на экране,
 * удержание клавиши не считается, а потеря фокуса прерывает попытку.
 */
export function StartLights({
  clock = browserClock,
  random = Math.random,
}: {
  clock?: GameClock;
  random?: () => number;
}) {
  const stats = useStartLights();
  const [phase, setPhase] = useState<Phase>('idle');
  const [lit, setLit] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [badge, setBadge] = useState<'first' | 'best' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  const lightsOutAt = useRef<number | null>(null);
  const lockedUntil = useRef(0);
  const timers = useRef(new Set<Timer>());
  const frame = useRef(0);
  const pad = useRef<HTMLDivElement>(null);

  const stopTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    cancelAnimationFrame(frame.current);
  }, []);
  const later = useCallback((action: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      action();
    }, ms);
    timers.current.add(timer);
  }, []);

  const settle = (result: Outcome) => {
    stopTimers();
    phaseRef.current = 'done';
    lockedUntil.current = clock.now() + RESULT_LOCK_MS;
    const firstEver = readStartLights().best === null;
    const { personalBest } = recordStartLights(result);
    setBadge(personalBest ? (firstEver ? 'first' : 'best') : null);
    setOutcome(result);
    setPhase('done');
  };

  const interrupt = useCallback(() => {
    stopTimers();
    phaseRef.current = 'done';
    lockedUntil.current = 0;
    setBadge(null);
    setOutcome({ kind: 'interrupted' });
    setPhase('done');
  }, [stopTimers]);

  const goDark = () => {
    // Сначала огни гаснут в DOM, и только кадр, где это видно, даёт точку отсчёта.
    flushSync(() => {
      phaseRef.current = 'go';
      setPhase('go');
      setLit(0);
    });
    frame.current = requestAnimationFrame(() => {
      lightsOutAt.current = clock.now();
    });
    later(() => {
      if (phaseRef.current === 'go') settle({ kind: 'too-slow' });
    }, TOO_SLOW_MS);
  };

  const begin = () => {
    stopTimers();
    lightsOutAt.current = null;
    setOutcome(null);
    setBadge(null);
    setLit(0);
    phaseRef.current = 'lights';
    setPhase('lights');
    let count = 0;
    const next = () => {
      count += 1;
      setLit(count);
      if (count < LIGHT_COUNT) {
        later(next, LIGHT_STEP_MS);
      } else {
        phaseRef.current = 'hold';
        setPhase('hold');
        later(goDark, holdDelay(random()));
      }
    };
    later(next, LIGHT_STEP_MS);
  };

  const press = (time: number) => {
    switch (phaseRef.current) {
      case 'idle':
        begin();
        return;
      case 'done':
        if (clock.now() >= lockedUntil.current) begin();
        return;
      case 'lights':
      case 'hold':
        settle({ kind: 'false-start', reason: 'early' });
        return;
      case 'go':
        settle(classifyPress(time, lightsOutAt.current));
        return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    // Удержание клавиши не реакция: считается только само нажатие.
    if (event.repeat) return;
    press(clock.pressTime(event.nativeEvent));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    press(clock.pressTime(event.nativeEvent));
  };

  // Потеря фокуса или скрытое окно прерывает идущую попытку, не засчитывая её.
  useEffect(() => {
    const active = () => ['lights', 'hold', 'go'].includes(phaseRef.current);
    const onBlur = () => {
      if (active()) interrupt();
    };
    const onVisibility = () => {
      if (document.hidden && active()) interrupt();
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [interrupt]);

  // Уход с экрана останавливает всё без записи результата.
  useEffect(() => stopTimers, [stopTimers]);
  useEffect(() => {
    pad.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), RESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  const playing = phase === 'lights' || phase === 'hold' || phase === 'go';
  const average = averageOfLast(stats.history);
  const recent = stats.history.slice(-8).reverse();
  const status =
    phase === 'idle'
      ? 'Нажмите пробел или кликните по полю, чтобы начать.'
      : phase === 'lights' || phase === 'hold'
        ? 'Огни горят. Не нажимайте, пока они не погаснут.'
        : phase === 'go'
          ? 'Огни погасли! Нажимайте!'
          : outcome
            ? `${describe(outcome)}. ${explain(outcome)}`
            : '';
  return (
    <div className="start-lights">
      <div
        ref={pad}
        className={`lights-pad${phase === 'go' ? ' go' : ''}${playing ? ' playing' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Поле игры «Стартовые огни»: пробел, Enter или клик"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onBlur={() => {
          if (playing) interrupt();
        }}
      >
        <div className="lights-gantry" aria-hidden="true">
          {Array.from({ length: LIGHT_COUNT }, (_, index) => (
            <span key={index} className={`lamp${index < lit ? ' on' : ''}`} />
          ))}
        </div>
        {phase === 'done' && outcome ? (
          <div className="lights-result" aria-hidden="true">
            {describe(outcome)}
          </div>
        ) : (
          <div className="lights-result lights-hint" aria-hidden="true">
            {phase === 'go' ? 'СТАРТ!' : playing ? 'Ждите…' : 'Готовы?'}
          </div>
        )}
        <p className="lights-status" role="status" aria-live="polite">
          {status}
        </p>
        {badge && (
          <p className="lights-badge">
            {badge === 'first' ? 'Первое время записано!' : 'Новый личный рекорд!'}
          </p>
        )}
        {phase === 'done' && (
          <p className="muted small">Нажмите пробел или кликните, чтобы сыграть ещё раз.</p>
        )}
      </div>

      <dl className="lights-stats" aria-label="Личная статистика">
        <div>
          <dt>Лучшее время</dt>
          <dd>{stats.best ? `${stats.best.ms} мс` : '—'}</dd>
        </div>
        <div>
          <dt>Среднее за 5</dt>
          <dd>{average === null ? '—' : `${average} мс`}</dd>
        </div>
        <div>
          <dt>Попыток</dt>
          <dd>{stats.rounds}</dd>
        </div>
        <div>
          <dt>Фальстартов</dt>
          <dd>{stats.falseStarts}</dd>
        </div>
      </dl>
      {recent.length > 0 && (
        <p className="lights-recent muted small">
          Последние попытки: {recent.map((attempt) => `${attempt.ms} мс`).join(' · ')}
        </p>
      )}
      <p className="muted small">
        Время включает задержки экрана и устройства: сравнивайте только с собой, не с пилотами.
      </p>
      <div className="settings-actions">
        <button
          className="ghost-btn"
          disabled={playing || (stats.rounds === 0 && !stats.best)}
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            setConfirmReset(false);
            resetStartLights();
          }}
        >
          <RotateCcw size={14} />{' '}
          {confirmReset ? 'Точно сбросить статистику?' : 'Сбросить статистику'}
        </button>
      </div>
    </div>
  );
}
