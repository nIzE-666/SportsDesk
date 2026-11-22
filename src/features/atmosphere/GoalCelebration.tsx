import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../kit';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import type { SportsEvent } from '../events/EventCenter';
import { getSpoilerSnapshot } from '../spoilers/spoilerStore';
import { celebrationsAllowed, motionReduced } from './atmosphereStore';
import {
  CELEBRATE_PREVIEW_EVENT,
  isCelebratableGoal,
  pickCelebrations,
  readCelebrated,
  rememberCelebrated,
} from './celebrationRules';
import { Confetti } from './Confetti';
import { getPlaybackContext } from './playbackContext';
import { playGoalHorn } from './soundEngine';
import './atmosphere.css';

interface Burst {
  key: string;
  title: string;
  detail: string;
  reduced: boolean;
}

const SHOW_MS = 4200;

/**
 * Праздник нового гола в главном окне. Источник — Центр событий
 * (sportsdesk://events-changed), без собственных запросов к API.
 */
export function GoalCelebration() {
  const [burst, setBurst] = useState<Burst | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (next: Burst) => {
    window.clearTimeout(timer.current);
    setBurst(next);
    timer.current = window.setTimeout(() => setBurst(null), SHOW_MS);
  };
  useEffect(() => {
    const onPreview = () => {
      show({
        key: `preview-${Date.now()}`,
        title: 'Гол!',
        detail: 'Так выглядит праздник нового гола.',
        reduced: motionReduced(),
      });
      playGoalHorn({ preview: true });
    };
    window.addEventListener(CELEBRATE_PREVIEW_EVENT, onPreview);
    return () => {
      window.removeEventListener(CELEBRATE_PREVIEW_EVENT, onPreview);
      window.clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true,
      busy = false,
      again = false,
      stop: (() => void) | undefined;
    const since = Date.now() - 60_000;
    const load = async (baseline: boolean) => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const list = await rpc<SportsEvent[]>('event_center_list');
        if (!active || !Array.isArray(list)) return;
        if (baseline) {
          rememberCelebrated(list.filter(isCelebratableGoal).map((e) => e.id));
          return;
        }
        const fresh = pickCelebrations(list, {
          seen: new Set(readCelebrated()),
          hidden: getSpoilerSnapshot(),
          now: Date.now(),
          since,
        });
        if (!fresh.length) return;
        rememberCelebrated(fresh.map((e) => e.id));
        if (!celebrationsAllowed() || getPlaybackContext().windowHidden) return;
        const latest = fresh.reduce((a, b) => (b.occurredAt > a.occurredAt ? b : a));
        show({
          key: latest.id,
          title: latest.title,
          detail: latest.body,
          reduced: motionReduced(),
        });
        // Рог — только вместе с праздником: скрытый результат и архивные голы сюда не доходят.
        playGoalHorn();
      } catch {
        // Праздник — необязательное оформление: ошибка списка событий не мешает работе.
      } finally {
        busy = false;
        if (again && active) {
          again = false;
          void load(false);
        }
      }
    };
    void load(true);
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const off = await listen('sportsdesk://events-changed', () => void load(false));
        if (active) stop = off;
        else off();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  if (!burst) return null;
  return (
    <div className="goal-celebration" role="status" aria-live="polite">
      {!burst.reduced && <Confetti key={burst.key} />}
      <div className={`goal-celebration-card${burst.reduced ? ' static' : ''}`}>
        <span className="goal-celebration-ball" aria-hidden="true">
          ⚽
        </span>
        <div className="goal-celebration-text">
          <b>{burst.title}</b>
          <span>{burst.detail}</span>
        </div>
        <IconButton
          small
          aria-label="Закрыть"
          icon={<X size={14} aria-hidden="true" />}
          onClick={() => setBurst(null)}
        />
      </div>
    </div>
  );
}
