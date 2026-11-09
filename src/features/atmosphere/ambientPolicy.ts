import type { AmbientChoice, AmbientKind, AtmosphereSettings } from './atmosphereStore';
import { ambientAllowed } from './atmosphereStore';
import type { PlaybackContext } from './playbackContext';

/**
 * Правила фонового звука в одном месте, без Web Audio: что должно звучать
 * сейчас при данных настройках и обстановке (видео, скрытое окно).
 */

/** Общий запас громкости фона: на максимуме ползунка фон остаётся тихим. */
export const AMBIENT_LEVEL = 0.5;
/** Во сколько раз фон тише, пока звучит видео и выбрано «Приглушить». */
export const AMBIENT_DUCK = 0.2;

export type AmbientStopReason = 'disabled' | 'hidden' | 'video' | 'unsupported';

export type AmbientDecision =
  { play: true; gain: number; lowered: boolean } | { play: false; reason: AmbientStopReason };

export function decideAmbient(
  settings: AtmosphereSettings,
  context: PlaybackContext,
): AmbientDecision {
  if (!ambientAllowed(settings)) return { play: false, reason: 'disabled' };
  if (context.windowHidden && settings.ambientHidden === 'stop')
    return { play: false, reason: 'hidden' };
  if (context.videoAudible) {
    if (settings.ambientVideo === 'stop') return { play: false, reason: 'video' };
    return { play: true, gain: settings.ambientVolume * AMBIENT_DUCK, lowered: true };
  }
  return { play: true, gain: settings.ambientVolume, lowered: false };
}

/** «Автоматически»: двигатель для Формулы 1, стадион для всего футбола и кубков. */
export function resolveAmbientKind(
  choice: AmbientChoice,
  sport: string | null | undefined,
): AmbientKind {
  if (choice === 'stadium' || choice === 'engine') return choice;
  return sport === 'f1' ? 'engine' : 'stadium';
}

export const AMBIENT_LABELS: Record<AmbientKind, string> = {
  stadium: 'стадион',
  engine: 'двигатель',
};

/** Понятное объяснение, почему фон не включился или остановился сам. */
export function ambientStopMessage(reason: AmbientStopReason): string {
  switch (reason) {
    case 'video':
      return 'Идёт видео со звуком — фон не включён. Это можно изменить в настройках.';
    case 'hidden':
      return 'Окно скрыто — фон остановлен.';
    case 'unsupported':
      return 'Звук недоступен в этой среде.';
    case 'disabled':
      return 'Фоновый звук выключен в настройках.';
  }
}
