import { f1SpoilerId, isResultHidden } from '../spoilers/spoilerStore';
import { celebrationsAllowed } from './atmosphereStore';
import { readCelebrated } from './celebrationRules';

/**
 * «Клетчатый флаг и подиум»: что делает интерфейс с событием Rust
 * `sportsdesk://f1-finish`.
 *
 * Rust присылает его только когда сам увидел, как итоги гонки или спринта
 * появились, и только один раз. Здесь событие дополнительно проверяется и
 * сверяется с настройками, режимом без спойлеров и уже показанным.
 */

export const FINISH_EVENT = 'sportsdesk://f1-finish';
export const FINISH_PREVIEW_EVENT = 'sportsdesk-finish-preview';

export type FinishSession = 'race' | 'sprint';

export interface PodiumPlace {
  position: 1 | 2 | 3;
  driver: string;
  team?: string;
  constructorId?: string;
}

export interface FinishPayload {
  id: string;
  season: string;
  round: string;
  session: FinishSession;
  label: string;
  raceName: string;
  podium: PodiumPlace[];
}

/** Подиум для проверки оформления в настройках: выдуманные подписи, а не настоящие пилоты. */
export const SAMPLE_FINISH: FinishPayload = {
  id: 'preview',
  season: '',
  round: '',
  session: 'race',
  label: 'Пример',
  raceName: 'Так выглядит подиум',
  podium: [
    { position: 1, driver: 'Победитель' },
    { position: 2, driver: 'Второе место' },
    { position: 3, driver: 'Третье место' },
  ],
};

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = Array.from(value)
    .filter((ch) => ch >= ' ' && ch !== '\u007f')
    .join('')
    .trim();
  return text && text.length <= max ? text : null;
}

/** Разбирает событие Rust. null — форма не та: праздника не будет. */
export function parseFinish(value: unknown): FinishPayload | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = clean(raw.id, 80);
  const season = clean(raw.season, 8);
  const round = clean(raw.round, 4);
  const label = clean(raw.label, 24);
  const raceName = clean(raw.raceName, 80);
  if (!id || !season || !round || !label || !raceName) return null;
  if (raw.session !== 'race' && raw.session !== 'sprint') return null;
  if (id !== `f1|result|${season}|${round}|${raw.session}`) return null;
  if (!Array.isArray(raw.podium) || raw.podium.length !== 3) return null;
  const podium: PodiumPlace[] = [];
  for (const [index, entry] of raw.podium.entries()) {
    if (!entry || typeof entry !== 'object') return null;
    const place = entry as Record<string, unknown>;
    const driver = clean(place.driver, 60);
    if (place.position !== index + 1 || !driver) return null;
    const team = clean(place.team, 40) ?? undefined;
    const constructorId =
      typeof place.constructorId === 'string' && /^[a-z0-9_]{1,32}$/.test(place.constructorId)
        ? place.constructorId
        : undefined;
    podium.push({ position: (index + 1) as 1 | 2 | 3, driver, team, constructorId });
  }
  return { id, season, round, session: raw.session, label, raceName, podium };
}

export type FinishDecision = 'show' | 'seen' | 'quiet';

/**
 * show — показать; seen — уже праздновали, ничего не делать; quiet — запомнить
 * как показанное, но не показывать (выключено, скрыт результат, окно скрыто).
 */
export function decideFinish(
  payload: FinishPayload,
  options: { windowHidden: boolean },
): FinishDecision {
  if (readCelebrated().includes(payload.id)) return 'seen';
  if (!celebrationsAllowed() || options.windowHidden) return 'quiet';
  if (isResultHidden('f1', f1SpoilerId(payload.season, payload.round))) return 'quiet';
  return 'show';
}
