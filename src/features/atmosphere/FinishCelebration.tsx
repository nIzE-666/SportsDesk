import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { isTauriRuntime } from '../../lib/bridge';
import { grandPrixTitle } from '../f1/calendarModel';
import { teamColor } from '../f1/teamColors';
import { motionReduced } from './atmosphereStore';
import { rememberCelebrated } from './celebrationRules';
import { Champagne } from './Champagne';
import {
  FINISH_EVENT,
  FINISH_PREVIEW_EVENT,
  SAMPLE_FINISH,
  decideFinish,
  parseFinish,
  type FinishPayload,
} from './finishRules';
import './atmosphere.css';

interface Shown {
  key: string;
  payload: FinishPayload;
  reduced: boolean;
  preview: boolean;
}

const SHOW_MS = 10_000;
const COLUMNS = 12;
const ROWS = 6;
/** Порядок подиума слева направо: второе, первое, третье место. */
const PODIUM_ORDER = [2, 1, 3] as const;
const PLACE_NAMES = { 1: 'Победитель', 2: 'Второе место', 3: 'Третье место' } as const;

/** Клетчатый флаг: колонки клеток покачиваются со сдвигом, как волна. */
function FlagWave() {
  return (
    <svg className="finish-flag" viewBox="-8 -8 256 160" aria-hidden="true">
      <rect x={-8} y={-8} width={6} height={160} rx={3} className="pole" />
      {Array.from({ length: COLUMNS }, (_, column) => (
        <g key={column} className="finish-flag-col" style={{ animationDelay: `${column * 0.07}s` }}>
          {Array.from({ length: ROWS }, (_, row) => (
            <rect
              key={row}
              x={column * 20}
              y={row * 24}
              width={20}
              height={24}
              className={(column + row) % 2 ? 'dark' : 'light'}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/**
 * Клетчатый флаг и подиум после финиша гонки или спринта. Источник —
 * событие Rust `sportsdesk://f1-finish`: оно приходит один раз и только когда
 * приложение само увидело, как итоги стали опубликованными. Своих запросов к
 * API здесь нет, победитель по расписанию или текущему лидеру не выбирается.
 */
export function FinishCelebration() {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (next: Shown) => {
    window.clearTimeout(timer.current);
    setShown(next);
    timer.current = window.setTimeout(() => setShown(null), SHOW_MS);
  };
  useEffect(() => {
    const onPreview = () =>
      show({
        key: `preview-${Date.now()}`,
        payload: SAMPLE_FINISH,
        reduced: motionReduced(),
        preview: true,
      });
    window.addEventListener(FINISH_PREVIEW_EVENT, onPreview);
    return () => {
      window.removeEventListener(FINISH_PREVIEW_EVENT, onPreview);
      window.clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let stop: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const off = await listen<unknown>(FINISH_EVENT, (event) => {
          const payload = parseFinish(event.payload);
          if (!payload) return;
          const decision = decideFinish(payload, { windowHidden: document.hidden });
          if (decision === 'seen') return;
          rememberCelebrated([payload.id]);
          if (decision !== 'show') return;
          show({ key: payload.id, payload, reduced: motionReduced(), preview: false });
        });
        if (active) stop = off;
        else off();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  if (!shown) return null;
  const { payload, reduced, preview } = shown;
  const title = grandPrixTitle(payload.raceName).title;
  return (
    <div className="finish-celebration" role="status" aria-live="polite">
      {!reduced && <FlagWave key={`flag-${shown.key}`} />}
      {!reduced && <Champagne key={`spray-${shown.key}`} />}
      <div className={`finish-card${reduced ? ' static' : ''}`}>
        <header className="finish-card-head">
          <span className="finish-strip" aria-hidden="true" />
          <div>
            <b>Клетчатый флаг</b>
            <span>
              {title} · {payload.label}
            </span>
          </div>
          <button className="ghost-btn" aria-label="Закрыть" onClick={() => setShown(null)}>
            <X size={14} />
          </button>
        </header>
        <div className="finish-podium">
          {PODIUM_ORDER.map((position) => {
            const place = payload.podium.find((entry) => entry.position === position);
            if (!place) return null;
            return (
              <div
                key={position}
                className={`finish-step place-${position}`}
                style={{ '--team': teamColor(place.constructorId) } as CSSProperties}
              >
                <span className="finish-name">
                  {position === 1 && <span aria-hidden="true">🏆 </span>}
                  <span className="sr-only">{PLACE_NAMES[position]}: </span>
                  {place.driver}
                </span>
                {place.team && <span className="finish-team">{place.team}</span>}
                <div className="finish-block" aria-hidden="true">
                  <b>{position}</b>
                </div>
              </div>
            );
          })}
        </div>
        <p className="finish-note">
          {preview
            ? 'Это пример оформления: настоящий подиум появится после публикации итогов.'
            : 'По опубликованным итогам Jolpica; возможны поправки после решений стюардов.'}
        </p>
      </div>
    </div>
  );
}
